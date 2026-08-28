-- Marking every remaining unit ready must be one operation. A client-side loop
-- over line RPCs could leave a supplier order partially updated if any later
-- line failed.

alter table public.safisa_portal_events
  drop constraint safisa_portal_events_type_check,
  drop constraint safisa_portal_events_target_check,
  drop constraint safisa_portal_events_quantities_check;

alter table public.safisa_portal_events
  add constraint safisa_portal_events_type_check check (
    event_type in (
      'MEMBER_STATUS_CHANGED',
      'ORDER_PUBLISHED',
      'ORDER_REVOKED',
      'READY_QUANTITY_INCREMENTED',
      'READY_QUANTITY_CORRECTED',
      'READY_QUANTITIES_ALL_MARKED'
    )
  ),
  add constraint safisa_portal_events_target_check check (
    (
      event_type = 'MEMBER_STATUS_CHANGED'
      and actor_kind = 'INTERNAL'
      and target_user_id is not null
      and supplier_order_id is null
      and supplier_order_item_id is null
    )
    or
    (
      event_type in ('ORDER_PUBLISHED', 'ORDER_REVOKED')
      and actor_kind = 'INTERNAL'
      and target_user_id is null
      and supplier_order_id is not null
      and supplier_order_item_id is null
    )
    or
    (
      event_type in (
        'READY_QUANTITY_INCREMENTED',
        'READY_QUANTITY_CORRECTED'
      )
      and target_user_id is null
      and supplier_order_id is not null
      and supplier_order_item_id is not null
    )
    or
    (
      event_type = 'READY_QUANTITIES_ALL_MARKED'
      and actor_kind = 'SAFISA'
      and target_user_id is null
      and supplier_order_id is not null
      and supplier_order_item_id is null
    )
  ),
  add constraint safisa_portal_events_quantities_check check (
    (
      event_type in (
        'MEMBER_STATUS_CHANGED',
        'ORDER_PUBLISHED',
        'ORDER_REVOKED'
      )
      and previous_quantity is null
      and quantity_delta is null
      and new_quantity is null
    )
    or
    (
      event_type in (
        'READY_QUANTITY_INCREMENTED',
        'READY_QUANTITY_CORRECTED',
        'READY_QUANTITIES_ALL_MARKED'
      )
      and previous_quantity is not null
      and quantity_delta is not null
      and new_quantity is not null
      and previous_quantity >= 0
      and new_quantity >= 0
      and quantity_delta = new_quantity - previous_quantity
    )
  );

create function private.mark_safisa_order_remaining_ready(
  p_supplier_order_id uuid,
  p_idempotency_key uuid,
  p_actor_user_id uuid,
  p_actor_name text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request jsonb;
  v_existing_result jsonb;
  v_order public.supplier_orders%rowtype;
  v_previous_ready_quantity bigint;
  v_increment_quantity bigint;
  v_new_ready_quantity bigint;
  v_changes jsonb;
  v_changed_line_count integer;
  v_result jsonb;
begin
  if p_supplier_order_id is null
    or p_idempotency_key is null
    or p_actor_user_id is null
    or nullif(btrim(p_actor_name), '') is null then
    raise exception using
      errcode = '22023',
      message = 'Order, idempotency key, and Safisa actor are required.';
  end if;

  v_request := jsonb_build_object(
    'supplier_order_id', p_supplier_order_id
  );

  v_existing_result := private.safisa_portal_existing_result(
    p_actor_user_id,
    p_idempotency_key,
    'READY_QUANTITIES_ALL_MARKED',
    v_request
  );

  if v_existing_result is not null then
    return v_existing_result;
  end if;

  -- Lock in the same order as the per-line readiness worker: parent,
  -- authorization, then every line in deterministic order.
  select supplier_order.*
  into v_order
  from public.supplier_orders as supplier_order
  where supplier_order.id = p_supplier_order_id
  for update;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'The supplier order does not exist.';
  end if;

  perform 1
  from public.safisa_order_authorizations as order_authorization
  where order_authorization.supplier_order_id = v_order.id
    and order_authorization.is_authorized
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'The supplier order is not authorized for the Safisa portal.';
  end if;

  if v_order.finalized_at is not null or v_order.cancelled_at is not null then
    raise exception using
      errcode = '22023',
      message = 'A closed supplier order cannot change ready quantities.';
  end if;

  perform 1
  from public.supplier_order_items as order_item
  where order_item.supplier_order_id = v_order.id
  order by order_item.id
  for update;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'The supplier order has no lines.';
  end if;

  select
    coalesce(sum(order_item.ready_quantity), 0),
    coalesce(
      sum(
        order_item.ordered_quantity
          - order_item.cancelled_quantity
          - order_item.ready_quantity
      ),
      0
    )
  into
    v_previous_ready_quantity,
    v_increment_quantity
  from public.supplier_order_items as order_item
  where order_item.supplier_order_id = v_order.id;

  if v_increment_quantity <= 0 then
    raise exception using
      errcode = '22023',
      message = 'All remaining supplier-order units are already ready.';
  end if;

  v_new_ready_quantity := v_previous_ready_quantity + v_increment_quantity;

  if v_previous_ready_quantity > 2147483647
    or v_increment_quantity > 2147483647
    or v_new_ready_quantity > 2147483647 then
    raise exception using
      errcode = '22023',
      message = 'The aggregate ready quantity exceeds the audited operation limit.';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'supplier_order_item_id', order_item.id,
        'previous_ready_quantity', order_item.ready_quantity,
        'increment_quantity',
          order_item.ordered_quantity
            - order_item.cancelled_quantity
            - order_item.ready_quantity,
        'new_ready_quantity',
          order_item.ordered_quantity - order_item.cancelled_quantity
      )
      order by order_item.id
    ),
    '[]'::jsonb
  )
  into v_changes
  from public.supplier_order_items as order_item
  where order_item.supplier_order_id = v_order.id
    and order_item.ready_quantity
      < order_item.ordered_quantity - order_item.cancelled_quantity;

  v_changed_line_count := jsonb_array_length(v_changes);

  update public.supplier_order_items
  set ready_quantity = ordered_quantity - cancelled_quantity
  where supplier_order_id = v_order.id
    and ready_quantity < ordered_quantity - cancelled_quantity;

  update public.supplier_orders
  set updated_at = now()
  where id = v_order.id;

  v_result := jsonb_build_object(
    'supplier_order_id', v_order.id,
    'negotiation_number', v_order.negotiation_number,
    'changed_line_count', v_changed_line_count,
    'previous_ready_quantity', v_previous_ready_quantity::integer,
    'increment_quantity', v_increment_quantity::integer,
    'new_ready_quantity', v_new_ready_quantity::integer,
    'changes', v_changes,
    'idempotent_replay', false
  );

  insert into public.safisa_portal_events (
    event_type,
    actor_user_id,
    actor_name_snapshot,
    actor_kind,
    supplier_order_id,
    idempotency_key,
    previous_quantity,
    quantity_delta,
    new_quantity,
    request_payload,
    result_payload
  )
  values (
    'READY_QUANTITIES_ALL_MARKED',
    p_actor_user_id,
    btrim(p_actor_name),
    'SAFISA',
    v_order.id,
    p_idempotency_key,
    v_previous_ready_quantity::integer,
    v_increment_quantity::integer,
    v_new_ready_quantity::integer,
    v_request,
    v_result
  );

  return v_result;
end;
$$;

create function public.mark_safisa_order_remaining_ready(
  p_supplier_order_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
begin
  select *
  into v_actor
  from private.require_active_safisa_member();

  return private.mark_safisa_order_remaining_ready(
    p_supplier_order_id,
    p_idempotency_key,
    v_actor.user_id,
    v_actor.user_name
  );
end;
$$;

revoke all on function private.mark_safisa_order_remaining_ready(
  uuid,
  uuid,
  uuid,
  text
) from public, anon, authenticated;

revoke all on function public.mark_safisa_order_remaining_ready(
  uuid,
  uuid
) from public, anon, authenticated;

grant execute on function public.mark_safisa_order_remaining_ready(
  uuid,
  uuid
) to authenticated;

comment on function public.mark_safisa_order_remaining_ready(
  uuid,
  uuid
) is 'Safisa-only atomic and idempotent operation that marks every remaining valid unit of one authorized open supplier order as ready.';
