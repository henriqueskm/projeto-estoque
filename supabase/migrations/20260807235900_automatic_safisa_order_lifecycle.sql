-- MIG-SAF-004: Safisa is the sole supplier. Every non-cancelled supplier order
-- participates in the portal lifecycle without requiring a publication row.
-- Historical safisa_order_authorizations are intentionally retained only for
-- audit compatibility and are no longer an operational gate.

create function public.list_safisa_orders(
  p_state text default 'ACTIVE',
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor record;
  v_normalized_state text;
  v_orders jsonb;
  v_total integer;
begin
  select * into v_actor from private.require_active_safisa_member();

  v_normalized_state := upper(nullif(btrim(p_state), ''));
  if v_normalized_state not in ('ACTIVE', 'COMPLETED') then
    raise exception using
      errcode = '22023',
      message = 'p_state must be ACTIVE or COMPLETED.';
  end if;

  if p_limit is null or p_limit not between 1 and 100
    or p_offset is null or p_offset < 0 then
    raise exception using
      errcode = '22023',
      message = 'p_limit must be between 1 and 100 and p_offset must be nonnegative.';
  end if;

  select count(*)::integer
  into v_total
  from public.supplier_order_summaries as summary
  where summary.cancelled_at is null
    and (
      (v_normalized_state = 'ACTIVE' and summary.waiting_pickup_quantity > 0)
      or (v_normalized_state = 'COMPLETED' and summary.waiting_pickup_quantity = 0)
    );

  select coalesce(
    jsonb_agg(
      row_data.payload
      order by row_data.sort_updated_at desc, row_data.supplier_order_id desc
    ),
    '[]'::jsonb
  )
  into v_orders
  from (
    select
      summary.id as supplier_order_id,
      coalesce(summary.closed_at, summary.updated_at, summary.created_at)
        as sort_updated_at,
      jsonb_build_object(
        'supplier_order_id', summary.id,
        'negotiation_number', summary.negotiation_number,
        'order_date', summary.order_date,
        'line_count', summary.line_count,
        'ordered_quantity', summary.ordered_quantity,
        'ready_quantity', summary.ready_quantity,
        'picked_quantity', summary.picked_quantity,
        'waiting_ready_quantity', summary.waiting_ready_quantity,
        'ready_waiting_pickup_quantity', summary.ready_waiting_pickup_quantity,
        'waiting_pickup_quantity', summary.waiting_pickup_quantity,
        'readiness_status', summary.readiness_status,
        'closure_kind', summary.closure_kind,
        'portal_state', v_normalized_state,
        'is_read_only', v_normalized_state = 'COMPLETED',
        'updated_at', summary.updated_at
      ) as payload
    from public.supplier_order_summaries as summary
    where summary.cancelled_at is null
      and (
        (v_normalized_state = 'ACTIVE' and summary.waiting_pickup_quantity > 0)
        or (v_normalized_state = 'COMPLETED' and summary.waiting_pickup_quantity = 0)
      )
    order by coalesce(summary.closed_at, summary.updated_at, summary.created_at) desc,
      summary.id desc
    limit p_limit
    offset p_offset
  ) as row_data;

  return jsonb_build_object(
    'orders', v_orders,
    'total', v_total,
    'state', v_normalized_state,
    'limit', p_limit,
    'offset', p_offset
  );
end;
$$;

create function public.get_safisa_order(p_supplier_order_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor record;
  v_summary public.supplier_order_summaries%rowtype;
  v_lines jsonb;
  v_events jsonb;
  v_portal_state text;
begin
  select * into v_actor from private.require_active_safisa_member();

  if p_supplier_order_id is null then
    raise exception using errcode = '22023', message = 'p_supplier_order_id is required.';
  end if;

  select summary.*
  into v_summary
  from public.supplier_order_summaries as summary
  where summary.id = p_supplier_order_id
    and summary.cancelled_at is null;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'The supplier order is not available in the Safisa portal.';
  end if;

  v_portal_state := case
    when v_summary.waiting_pickup_quantity > 0 then 'ACTIVE'
    else 'COMPLETED'
  end;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'supplier_order_item_id', detail.id,
        'code', detail.code_snapshot,
        'description', detail.description_snapshot,
        'model', detail.model_snapshot,
        'item_type', detail.item_type_snapshot,
        'commercial_code', detail.commercial_code_snapshot,
        'ordered_quantity', detail.ordered_quantity,
        'ready_quantity', detail.ready_quantity,
        'picked_quantity', detail.picked_quantity,
        'waiting_ready_quantity', detail.waiting_ready_quantity,
        'ready_waiting_pickup_quantity', detail.ready_waiting_pickup_quantity,
        'readiness_status', detail.readiness_status,
        'position', detail.position,
        'updated_at', detail.updated_at
      ) order by detail.position, detail.id
    ),
    '[]'::jsonb
  ) into v_lines
  from public.supplier_order_item_details as detail
  where detail.supplier_order_id = p_supplier_order_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'event_type', event.event_type,
        'actor_name', event.actor_name_snapshot,
        'supplier_order_item_id', event.supplier_order_item_id,
        'previous_quantity', event.previous_quantity,
        'quantity_delta', event.quantity_delta,
        'new_quantity', event.new_quantity,
        'justification', event.justification,
        'created_at', event.created_at
      ) order by event.created_at desc, event.id desc
    ),
    '[]'::jsonb
  ) into v_events
  from (
    select portal_event.*
    from public.safisa_portal_events as portal_event
    where portal_event.supplier_order_id = p_supplier_order_id
      and portal_event.event_type in ('READY_QUANTITY_INCREMENTED', 'READY_QUANTITY_CORRECTED')
    order by portal_event.created_at desc, portal_event.id desc
    limit 100
  ) as event;

  return jsonb_build_object(
    'supplier_order_id', v_summary.id,
    'negotiation_number', v_summary.negotiation_number,
    'order_date', v_summary.order_date,
    'ordered_quantity', v_summary.ordered_quantity,
    'ready_quantity', v_summary.ready_quantity,
    'picked_quantity', v_summary.picked_quantity,
    'waiting_ready_quantity', v_summary.waiting_ready_quantity,
    'ready_waiting_pickup_quantity', v_summary.ready_waiting_pickup_quantity,
    'waiting_pickup_quantity', v_summary.waiting_pickup_quantity,
    'readiness_status', v_summary.readiness_status,
    'closure_kind', v_summary.closure_kind,
    'portal_state', v_portal_state,
    'is_read_only', v_portal_state = 'COMPLETED',
    'updated_at', v_summary.updated_at,
    'lines', v_lines,
    'events', v_events
  );
end;
$$;

create or replace function public.list_safisa_ready_pickup_alerts(
  p_limit integer default 100
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor record;
  v_alerts jsonb;
  v_total integer;
begin
  select * into v_actor from private.require_supplier_order_user();

  if p_limit is null or p_limit not between 1 and 500 then
    raise exception using errcode = '22023', message = 'p_limit must be between 1 and 500.';
  end if;

  select count(*)::integer
  into v_total
  from public.supplier_orders as supplier_order
  join public.supplier_order_items as order_item
    on order_item.supplier_order_id = supplier_order.id
  where supplier_order.cancelled_at is null
    and order_item.ready_quantity > order_item.picked_quantity;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'supplier_order_id', alert.supplier_order_id,
        'supplier_order_item_id', alert.supplier_order_item_id,
        'negotiation_number', alert.negotiation_number,
        'order_date', alert.order_date,
        'code', alert.code_snapshot,
        'description', alert.description_snapshot,
        'model', alert.model_snapshot,
        'item_type', alert.item_type_snapshot,
        'commercial_code', alert.commercial_code_snapshot,
        'ready_quantity', alert.ready_quantity,
        'picked_quantity', alert.picked_quantity,
        'ready_waiting_pickup_quantity', alert.ready_waiting_pickup_quantity,
        'readiness_status', alert.readiness_status,
        'updated_at', alert.updated_at
      ) order by alert.order_date, alert.position, alert.supplier_order_item_id
    ),
    '[]'::jsonb
  ) into v_alerts
  from (
    select
      supplier_order.id as supplier_order_id,
      order_item.id as supplier_order_item_id,
      supplier_order.negotiation_number,
      supplier_order.order_date,
      order_item.code_snapshot,
      order_item.description_snapshot,
      order_item.model_snapshot,
      order_item.item_type_snapshot,
      order_item.commercial_code_snapshot,
      order_item.ready_quantity,
      order_item.picked_quantity,
      order_item.ready_quantity - order_item.picked_quantity as ready_waiting_pickup_quantity,
      case when order_item.ready_quantity + order_item.cancelled_quantity = order_item.ordered_quantity
        then 'COMPLETELY_READY' else 'PARTIALLY_READY' end as readiness_status,
      order_item.updated_at,
      order_item.position
    from public.supplier_orders as supplier_order
    join public.supplier_order_items as order_item
      on order_item.supplier_order_id = supplier_order.id
    where supplier_order.cancelled_at is null
      and order_item.ready_quantity > order_item.picked_quantity
    order by supplier_order.order_date, order_item.position, order_item.id
    limit p_limit
  ) as alert;

  return jsonb_build_object('alerts', v_alerts, 'total', v_total, 'limit', p_limit);
end;
$$;

revoke all on function public.list_safisa_orders(text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.get_safisa_order(uuid)
  from public, anon, authenticated;
grant execute on function public.list_safisa_orders(text, integer, integer) to authenticated;
grant execute on function public.get_safisa_order(uuid) to authenticated;

comment on function public.list_safisa_authorized_orders(integer, integer)
  is 'Deprecated compatibility reader. Use public.list_safisa_orders; Safisa visibility is automatic for all non-cancelled supplier orders.';
comment on function public.get_safisa_authorized_order(uuid)
  is 'Deprecated compatibility reader. Use public.get_safisa_order; Safisa visibility is automatic for all non-cancelled supplier orders.';
comment on function public.publish_supplier_order_to_safisa(uuid, uuid)
  is 'Deprecated compatibility mutation retained for historical callers. Supplier orders are automatically Safisa-managed.';
comment on function public.revoke_supplier_order_from_safisa(uuid, uuid)
  is 'Deprecated compatibility mutation retained for historical callers. Supplier orders are automatically Safisa-managed.';

-- A membership is still mandatory, but a per-order authorization is no longer
-- required to report readiness for an automatically managed supplier order.
create or replace function private.increment_safisa_ready_quantity(
  p_supplier_order_item_id uuid,
  p_increment_quantity integer,
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
  v_line public.supplier_order_items%rowtype;
  v_previous_quantity integer;
  v_new_quantity_bigint bigint;
  v_new_quantity integer;
  v_line_updated_at timestamptz;
  v_result jsonb;
begin
  if p_supplier_order_item_id is null or p_increment_quantity is null
    or p_increment_quantity <= 0 or p_idempotency_key is null
    or p_actor_user_id is null or nullif(btrim(p_actor_name), '') is null then
    raise exception using errcode = '22023', message = 'Line, positive increment, idempotency key, and actor are required.';
  end if;
  v_request := jsonb_build_object('supplier_order_item_id', p_supplier_order_item_id, 'increment_quantity', p_increment_quantity);
  v_existing_result := private.safisa_portal_existing_result(
    p_actor_user_id, p_idempotency_key, 'READY_QUANTITY_INCREMENTED', v_request
  );
  if v_existing_result is not null then return v_existing_result; end if;

  select supplier_order.* into v_order
  from public.supplier_order_items as order_item
  join public.supplier_orders as supplier_order on supplier_order.id = order_item.supplier_order_id
  where order_item.id = p_supplier_order_item_id for update of supplier_order;
  if not found then
    raise exception using errcode = '22023', message = 'The supplier-order line does not exist.';
  end if;
  if v_order.finalized_at is not null or v_order.cancelled_at is not null then
    raise exception using errcode = '22023', message = 'A closed supplier order cannot change ready quantities.';
  end if;
  select order_item.* into v_line from public.supplier_order_items as order_item
  where order_item.id = p_supplier_order_item_id and order_item.supplier_order_id = v_order.id for update;
  if not found then
    raise exception using errcode = '22023', message = 'The supplier-order line does not exist.';
  end if;
  v_previous_quantity := v_line.ready_quantity;
  v_new_quantity_bigint := v_line.ready_quantity::bigint + p_increment_quantity::bigint;
  if v_new_quantity_bigint > 2147483647
    or v_new_quantity_bigint + v_line.cancelled_quantity > v_line.ordered_quantity then
    raise exception using errcode = '22023', message = 'The ready quantity cannot exceed the valid ordered quantity.';
  end if;
  v_new_quantity := v_new_quantity_bigint::integer;
  update public.supplier_order_items set ready_quantity = v_new_quantity where id = p_supplier_order_item_id;
  update public.supplier_orders set updated_at = now() where id = v_order.id;
  select order_item.updated_at into v_line_updated_at from public.supplier_order_items as order_item where order_item.id = p_supplier_order_item_id;
  v_result := jsonb_build_object(
    'supplier_order_id', v_order.id, 'supplier_order_item_id', p_supplier_order_item_id,
    'negotiation_number', v_order.negotiation_number, 'previous_ready_quantity', v_previous_quantity,
    'increment_quantity', p_increment_quantity, 'new_ready_quantity', v_new_quantity,
    'picked_quantity', v_line.picked_quantity,
    'ready_waiting_pickup_quantity', v_new_quantity - v_line.picked_quantity,
    'line_updated_at', v_line_updated_at, 'idempotent_replay', false
  );
  insert into public.safisa_portal_events (
    event_type, actor_user_id, actor_name_snapshot, actor_kind, supplier_order_id,
    supplier_order_item_id, idempotency_key, previous_quantity, quantity_delta,
    new_quantity, request_payload, result_payload
  ) values (
    'READY_QUANTITY_INCREMENTED', p_actor_user_id, btrim(p_actor_name), 'SAFISA',
    v_order.id, p_supplier_order_item_id, p_idempotency_key, v_previous_quantity,
    p_increment_quantity, v_new_quantity, v_request, v_result
  );
  return v_result;
end;
$$;

create or replace function private.correct_safisa_ready_quantity(
  p_supplier_order_item_id uuid,
  p_new_ready_quantity integer,
  p_justification text,
  p_confirmed boolean,
  p_expected_updated_at timestamptz,
  p_idempotency_key uuid,
  p_actor_user_id uuid,
  p_actor_name text,
  p_actor_kind text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_justification text;
  v_request jsonb;
  v_existing_result jsonb;
  v_order public.supplier_orders%rowtype;
  v_line public.supplier_order_items%rowtype;
  v_previous_quantity integer;
  v_line_updated_at timestamptz;
  v_result jsonb;
begin
  v_justification := nullif(btrim(p_justification), '');
  if p_supplier_order_item_id is null or p_new_ready_quantity is null
    or p_new_ready_quantity < 0 or v_justification is null
    or char_length(v_justification) > 500 or p_confirmed is distinct from true
    or p_expected_updated_at is null or p_idempotency_key is null
    or p_actor_user_id is null or nullif(btrim(p_actor_name), '') is null
    or p_actor_kind not in ('INTERNAL', 'SAFISA') then
    raise exception using errcode = '22023', message = 'Line, nonnegative total, short justification, explicit confirmation, expected version, idempotency key, and actor are required.';
  end if;
  v_request := jsonb_build_object(
    'supplier_order_item_id', p_supplier_order_item_id, 'new_ready_quantity', p_new_ready_quantity,
    'justification', v_justification, 'confirmed', true, 'expected_updated_at', p_expected_updated_at
  );
  v_existing_result := private.safisa_portal_existing_result(
    p_actor_user_id, p_idempotency_key, 'READY_QUANTITY_CORRECTED', v_request
  );
  if v_existing_result is not null then return v_existing_result; end if;

  select supplier_order.* into v_order from public.supplier_order_items as order_item
  join public.supplier_orders as supplier_order on supplier_order.id = order_item.supplier_order_id
  where order_item.id = p_supplier_order_item_id for update of supplier_order;
  if not found then
    raise exception using errcode = '22023', message = 'The supplier-order line does not exist.';
  end if;
  if v_order.finalized_at is not null or v_order.cancelled_at is not null then
    raise exception using errcode = '22023', message = 'A closed supplier order cannot change ready quantities.';
  end if;
  select order_item.* into v_line from public.supplier_order_items as order_item
  where order_item.id = p_supplier_order_item_id and order_item.supplier_order_id = v_order.id for update;
  if not found then
    raise exception using errcode = '22023', message = 'The supplier-order line does not exist.';
  end if;
  if v_line.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = '40001', message = 'safisa_ready_quantity_version_conflict';
  end if;
  if p_new_ready_quantity < v_line.picked_quantity then
    raise exception using errcode = '22023', message = 'ready_quantity cannot be lower than picked_quantity.';
  end if;
  if p_new_ready_quantity + v_line.cancelled_quantity > v_line.ordered_quantity then
    raise exception using errcode = '22023', message = 'The ready quantity cannot exceed the valid ordered quantity.';
  end if;
  v_previous_quantity := v_line.ready_quantity;
  update public.supplier_order_items set ready_quantity = p_new_ready_quantity where id = p_supplier_order_item_id;
  update public.supplier_orders set updated_at = now() where id = v_order.id;
  select order_item.updated_at into v_line_updated_at from public.supplier_order_items as order_item where order_item.id = p_supplier_order_item_id;
  v_result := jsonb_build_object(
    'supplier_order_id', v_order.id, 'supplier_order_item_id', p_supplier_order_item_id,
    'negotiation_number', v_order.negotiation_number, 'previous_ready_quantity', v_previous_quantity,
    'ready_quantity_delta', p_new_ready_quantity - v_previous_quantity,
    'new_ready_quantity', p_new_ready_quantity, 'picked_quantity', v_line.picked_quantity,
    'ready_waiting_pickup_quantity', p_new_ready_quantity - v_line.picked_quantity,
    'line_updated_at', v_line_updated_at, 'idempotent_replay', false
  );
  insert into public.safisa_portal_events (
    event_type, actor_user_id, actor_name_snapshot, actor_kind, supplier_order_id,
    supplier_order_item_id, idempotency_key, previous_quantity, quantity_delta,
    new_quantity, justification, request_payload, result_payload
  ) values (
    'READY_QUANTITY_CORRECTED', p_actor_user_id, btrim(p_actor_name), p_actor_kind,
    v_order.id, p_supplier_order_item_id, p_idempotency_key, v_previous_quantity,
    p_new_ready_quantity - v_previous_quantity, p_new_ready_quantity, v_justification,
    v_request, v_result
  );
  return v_result;
end;
$$;

-- Replace the temporary legacy compatibility branch from MIG-SAF-003. Pickup
-- readiness is universal after this migration, including existing orders.
create or replace function private.set_supplier_order_item_picked_quantity(
  p_supplier_order_item_id uuid,
  p_picked_quantity integer,
  p_description text,
  p_idempotency_key uuid,
  p_user_id uuid,
  p_user_name text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_description text;
  v_request jsonb;
  v_existing_result jsonb;
  v_result jsonb;
  v_order_id uuid;
  v_order_cancelled_at timestamptz;
  v_line public.supplier_order_items%rowtype;
  v_previous_quantity integer;
begin
  if p_supplier_order_item_id is null or p_picked_quantity is null
    or p_picked_quantity < 0 or p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'Line, nonnegative picked quantity, and idempotency key are required.';
  end if;

  v_description := nullif(btrim(p_description), '');
  if v_description is not null and char_length(v_description) > 2000 then
    raise exception using errcode = '22023', message = 'p_description must contain at most 2000 characters.';
  end if;

  v_request := jsonb_build_object(
    'supplier_order_item_id', p_supplier_order_item_id,
    'picked_quantity', p_picked_quantity,
    'description', v_description
  );
  v_existing_result := private.supplier_order_existing_result(
    p_user_id, p_idempotency_key, 'PICKED_QUANTITY_CHANGED', v_request
  );
  if v_existing_result is not null then return v_existing_result; end if;

  select supplier_order_id into v_order_id
  from public.supplier_order_items where id = p_supplier_order_item_id;
  if not found then
    raise exception using errcode = '22023', message = 'The supplier-order line does not exist.';
  end if;

  select cancelled_at into v_order_cancelled_at
  from public.supplier_orders where id = v_order_id for update;
  if not found then
    raise exception using errcode = '22023', message = 'The supplier order does not exist.';
  end if;

  select * into v_line from public.supplier_order_items
  where id = p_supplier_order_item_id and supplier_order_id = v_order_id for update;
  if v_order_cancelled_at is not null then
    raise exception using errcode = '22023', message = 'A cancelled supplier order cannot change picked quantities.';
  end if;
  if p_picked_quantity < v_line.stocked_quantity then
    raise exception using errcode = '22023', message = 'picked_quantity cannot be lower than stocked_quantity.';
  end if;
  if p_picked_quantity > v_line.ready_quantity then
    raise exception using errcode = '22023', message = 'picked_quantity cannot exceed ready_quantity.';
  end if;
  if p_picked_quantity + v_line.cancelled_quantity > v_line.ordered_quantity then
    raise exception using errcode = '22023', message = 'picked plus cancelled quantity cannot exceed ordered quantity.';
  end if;

  v_previous_quantity := v_line.picked_quantity;
  update public.supplier_order_items set picked_quantity = p_picked_quantity
  where id = p_supplier_order_item_id;
  update public.supplier_orders set updated_at = now() where id = v_order_id;

  v_result := private.supplier_order_result(v_order_id) || jsonb_build_object(
    'supplier_order_item_id', p_supplier_order_item_id,
    'previous_picked_quantity', v_previous_quantity,
    'new_picked_quantity', p_picked_quantity,
    'picked_quantity_delta', p_picked_quantity - v_previous_quantity,
    'ready_quantity', v_line.ready_quantity,
    'ready_waiting_pickup_quantity', v_line.ready_quantity - p_picked_quantity
  );

  insert into public.supplier_order_events (
    supplier_order_id, supplier_order_item_id, event_type, user_id,
    user_name_snapshot, idempotency_key, previous_quantity, new_quantity,
    quantity_delta, description, details
  ) values (
    v_order_id, p_supplier_order_item_id, 'PICKED_QUANTITY_CHANGED', p_user_id,
    p_user_name, p_idempotency_key, v_previous_quantity, p_picked_quantity,
    p_picked_quantity - v_previous_quantity, v_description,
    jsonb_build_object('request', v_request, 'result', v_result)
  );
  return v_result;
end;
$$;

create or replace function private.mark_supplier_order_all_picked(
  p_supplier_order_id uuid,
  p_description text,
  p_idempotency_key uuid,
  p_user_id uuid,
  p_user_name text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_description text;
  v_request jsonb;
  v_existing_result jsonb;
  v_result jsonb;
  v_cancelled_at timestamptz;
  v_changes jsonb;
begin
  if p_supplier_order_id is null or p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'Order and idempotency key are required.';
  end if;
  v_description := nullif(btrim(p_description), '');
  if v_description is not null and char_length(v_description) > 2000 then
    raise exception using errcode = '22023', message = 'p_description must contain at most 2000 characters.';
  end if;
  v_request := jsonb_build_object('supplier_order_id', p_supplier_order_id, 'description', v_description);
  v_existing_result := private.supplier_order_existing_result(
    p_user_id, p_idempotency_key, 'ALL_ITEMS_MARKED_PICKED', v_request
  );
  if v_existing_result is not null then return v_existing_result; end if;

  select cancelled_at into v_cancelled_at from public.supplier_orders
  where id = p_supplier_order_id for update;
  if not found then
    raise exception using errcode = '22023', message = 'The supplier order does not exist.';
  end if;
  if v_cancelled_at is not null then
    raise exception using errcode = '22023', message = 'A cancelled supplier order cannot change picked quantities.';
  end if;
  perform 1 from public.supplier_order_items where supplier_order_id = p_supplier_order_id order by id for update;

  select coalesce(jsonb_agg(jsonb_build_object(
    'supplier_order_item_id', order_item.id,
    'previous_picked_quantity', order_item.picked_quantity,
    'new_picked_quantity', order_item.ready_quantity
  ) order by order_item.id), '[]'::jsonb)
  into v_changes
  from public.supplier_order_items as order_item
  where order_item.supplier_order_id = p_supplier_order_id
    and order_item.picked_quantity is distinct from order_item.ready_quantity;

  update public.supplier_order_items set picked_quantity = ready_quantity
  where supplier_order_id = p_supplier_order_id
    and picked_quantity is distinct from ready_quantity;
  update public.supplier_orders set updated_at = now() where id = p_supplier_order_id;

  v_result := private.supplier_order_result(p_supplier_order_id)
    || jsonb_build_object('changed_line_count', jsonb_array_length(v_changes));
  insert into public.supplier_order_events (
    supplier_order_id, event_type, user_id, user_name_snapshot, idempotency_key,
    description, details
  ) values (
    p_supplier_order_id, 'ALL_ITEMS_MARKED_PICKED', p_user_id, p_user_name,
    p_idempotency_key, v_description,
    jsonb_build_object('request', v_request, 'result', v_result, 'changes', v_changes, 'ready_only', true)
  );
  return v_result;
end;
$$;

create or replace function private.mark_supplier_order_all_picked_checked(
  p_supplier_order_id uuid,
  p_description text,
  p_expected_order_updated_at timestamptz,
  p_idempotency_key uuid,
  p_user_id uuid,
  p_user_name text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_description text;
  v_request jsonb;
  v_existing_result jsonb;
  v_result jsonb;
  v_order public.supplier_orders%rowtype;
  v_added_picked_quantity bigint := 0;
begin
  if p_supplier_order_id is null or p_expected_order_updated_at is null
    or p_idempotency_key is null or p_user_id is null
    or nullif(btrim(p_user_name), '') is null then
    raise exception using errcode = '22023', message = 'Order, expected order version, idempotency key, and authenticated user are required.';
  end if;
  v_description := nullif(btrim(p_description), '');
  if v_description is not null and char_length(v_description) > 2000 then
    raise exception using errcode = '22023', message = 'p_description must contain at most 2000 characters.';
  end if;
  v_request := jsonb_build_object('supplier_order_id', p_supplier_order_id, 'description', v_description);
  v_existing_result := private.supplier_order_existing_result(
    p_user_id, p_idempotency_key, 'ALL_ITEMS_MARKED_PICKED', v_request
  );
  if v_existing_result is not null then
    select coalesce(sum((change.value ->> 'new_picked_quantity')::bigint - (change.value ->> 'previous_picked_quantity')::bigint), 0)
    into v_added_picked_quantity
    from public.supplier_order_events as event
    cross join lateral jsonb_array_elements(coalesce(event.details -> 'changes', '[]'::jsonb)) as change(value)
    where event.user_id = p_user_id and event.idempotency_key = p_idempotency_key
      and event.event_type = 'ALL_ITEMS_MARKED_PICKED';
    return v_existing_result || jsonb_build_object('added_picked_quantity', v_added_picked_quantity, 'idempotent_replay', true);
  end if;

  select supplier_order.* into v_order from public.supplier_orders as supplier_order
  where supplier_order.id = p_supplier_order_id for update;
  if not found then
    raise exception using errcode = '22023', message = 'The supplier order does not exist.';
  end if;
  perform 1 from public.supplier_order_items as order_item
  where order_item.supplier_order_id = p_supplier_order_id order by order_item.id for update;
  if v_order.updated_at is distinct from p_expected_order_updated_at then
    raise exception using errcode = '40001', message = 'supplier_order_version_conflict';
  end if;
  select coalesce(sum(order_item.ready_quantity - order_item.picked_quantity), 0)
  into v_added_picked_quantity from public.supplier_order_items as order_item
  where order_item.supplier_order_id = p_supplier_order_id;
  v_result := private.mark_supplier_order_all_picked(
    p_supplier_order_id, v_description, p_idempotency_key, p_user_id, btrim(p_user_name)
  );
  return v_result || jsonb_build_object('added_picked_quantity', v_added_picked_quantity, 'idempotent_replay', false);
end;
$$;

comment on function private.set_supplier_order_item_picked_quantity(uuid, integer, text, uuid, uuid, text)
  is 'Canonical pickup worker. Every supplier order is Safisa-managed; picked quantity can never exceed ready quantity.';
comment on function private.mark_supplier_order_all_picked(uuid, text, uuid, uuid, text)
  is 'Canonical bulk pickup worker. Every supplier order picks ready units only.';
comment on function private.mark_supplier_order_all_picked_checked(uuid, text, timestamptz, uuid, uuid, text)
  is 'Optimistic-concurrency bulk pickup worker. Every supplier order picks ready units only.';

-- Cancellation is logical and remains fully auditable. It must never silently
-- discard units Safisa has already reported as ready but that remain unpicked.
create or replace function private.cancel_supplier_order(
  p_supplier_order_id uuid,
  p_cancellation_note text,
  p_idempotency_key uuid,
  p_user_id uuid,
  p_user_name text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_cancellation_note text;
  v_request jsonb;
  v_existing_result jsonb;
  v_result jsonb;
  v_cancelled_at timestamptz;
begin
  if p_supplier_order_id is null or p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'Order and idempotency key are required.';
  end if;
  v_cancellation_note := nullif(btrim(p_cancellation_note), '');
  if v_cancellation_note is null then
    raise exception using errcode = '22023', message = 'A cancellation reason is required.';
  end if;
  if char_length(v_cancellation_note) > 2000 then
    raise exception using errcode = '22023', message = 'p_cancellation_note must contain at most 2000 characters.';
  end if;
  v_request := jsonb_build_object('supplier_order_id', p_supplier_order_id, 'cancellation_note', v_cancellation_note);
  v_existing_result := private.supplier_order_existing_result(
    p_user_id, p_idempotency_key, 'ORDER_CANCELLED', v_request
  );
  if v_existing_result is not null then return v_existing_result; end if;

  select cancelled_at into v_cancelled_at from public.supplier_orders
  where id = p_supplier_order_id for update;
  if not found then
    raise exception using errcode = '22023', message = 'The supplier order does not exist.';
  end if;
  if v_cancelled_at is not null then
    raise exception using errcode = '22023', message = 'The supplier order is already cancelled.';
  end if;
  perform 1 from public.supplier_order_items
  where supplier_order_id = p_supplier_order_id order by id for update;
  if exists (
    select 1 from public.supplier_order_items
    where supplier_order_id = p_supplier_order_id
      and ready_quantity > picked_quantity
  ) then
    raise exception using errcode = '22023', message = 'The supplier order has ready quantities still awaiting pickup. Resolve ready quantities before cancelling.';
  end if;
  if exists (
    select 1 from public.supplier_order_items
    where supplier_order_id = p_supplier_order_id
      and (picked_quantity > 0 or stocked_quantity > 0)
  ) then
    raise exception using errcode = '22023', message = 'An order with picked or stocked quantities cannot be fully cancelled.';
  end if;

  update public.supplier_order_items set cancelled_quantity = ordered_quantity
  where supplier_order_id = p_supplier_order_id;
  update public.supplier_orders
  set cancelled_at = now(), cancelled_by = p_user_id,
    cancelled_by_name_snapshot = p_user_name, cancellation_note = v_cancellation_note
  where id = p_supplier_order_id;
  v_result := private.supplier_order_result(p_supplier_order_id);
  insert into public.supplier_order_events (
    supplier_order_id, event_type, user_id, user_name_snapshot, idempotency_key,
    description, details
  ) values (
    p_supplier_order_id, 'ORDER_CANCELLED', p_user_id, p_user_name,
    p_idempotency_key, v_cancellation_note,
    jsonb_build_object('request', v_request, 'result', v_result)
  );
  return v_result;
end;
$$;

create or replace function private.cancel_supplier_order_remaining(
  p_supplier_order_id uuid,
  p_cancellation_note text,
  p_idempotency_key uuid,
  p_user_id uuid,
  p_user_name text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_cancellation_note text;
  v_request jsonb;
  v_existing_result jsonb;
  v_result jsonb;
  v_cancelled_at timestamptz;
begin
  if p_supplier_order_id is null or p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'Order and idempotency key are required.';
  end if;
  v_cancellation_note := nullif(btrim(p_cancellation_note), '');
  if v_cancellation_note is null then
    raise exception using errcode = '22023', message = 'A cancellation reason is required.';
  end if;
  if char_length(v_cancellation_note) > 2000 then
    raise exception using errcode = '22023', message = 'p_cancellation_note must contain at most 2000 characters.';
  end if;
  v_request := jsonb_build_object('supplier_order_id', p_supplier_order_id, 'cancellation_note', v_cancellation_note);
  v_existing_result := private.supplier_order_existing_result(
    p_user_id, p_idempotency_key, 'REMAINING_QUANTITY_CANCELLED', v_request
  );
  if v_existing_result is not null then return v_existing_result; end if;

  select cancelled_at into v_cancelled_at from public.supplier_orders
  where id = p_supplier_order_id for update;
  if not found then
    raise exception using errcode = '22023', message = 'The supplier order does not exist.';
  end if;
  if v_cancelled_at is not null then
    raise exception using errcode = '22023', message = 'The supplier order is already cancelled.';
  end if;
  perform 1 from public.supplier_order_items
  where supplier_order_id = p_supplier_order_id order by id for update;
  if exists (
    select 1 from public.supplier_order_items
    where supplier_order_id = p_supplier_order_id
      and ready_quantity > picked_quantity
  ) then
    raise exception using errcode = '22023', message = 'The supplier order has ready quantities still awaiting pickup. Resolve ready quantities before cancelling.';
  end if;
  if not exists (
    select 1 from public.supplier_order_items
    where supplier_order_id = p_supplier_order_id
      and (picked_quantity > 0 or stocked_quantity > 0)
  ) then
    raise exception using errcode = '22023', message = 'Use full cancellation when no quantity has been picked.';
  end if;
  if not exists (
    select 1 from public.supplier_order_items
    where supplier_order_id = p_supplier_order_id
      and ordered_quantity - picked_quantity - cancelled_quantity > 0
  ) then
    raise exception using errcode = '22023', message = 'The supplier order has no remaining pickup quantity to cancel.';
  end if;

  update public.supplier_order_items
  set cancelled_quantity = ordered_quantity - picked_quantity
  where supplier_order_id = p_supplier_order_id;
  update public.supplier_orders
  set cancelled_at = now(), cancelled_by = p_user_id,
    cancelled_by_name_snapshot = p_user_name, cancellation_note = v_cancellation_note
  where id = p_supplier_order_id;
  v_result := private.supplier_order_result(p_supplier_order_id);
  insert into public.supplier_order_events (
    supplier_order_id, event_type, user_id, user_name_snapshot, idempotency_key,
    description, details
  ) values (
    p_supplier_order_id, 'REMAINING_QUANTITY_CANCELLED', p_user_id, p_user_name,
    p_idempotency_key, v_cancellation_note,
    jsonb_build_object('request', v_request, 'result', v_result)
  );
  return v_result;
end;
$$;

comment on function private.cancel_supplier_order(uuid, text, uuid, uuid, text)
  is 'Logical, audited cancellation. It requires a reason and rejects orders with Safisa-ready quantities awaiting pickup.';
comment on function private.cancel_supplier_order_remaining(uuid, text, uuid, uuid, text)
  is 'Logical, audited remaining-quantity cancellation. It requires a reason and rejects Safisa-ready quantities awaiting pickup.';
