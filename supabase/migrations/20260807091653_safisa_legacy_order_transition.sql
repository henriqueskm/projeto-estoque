-- Preserve the pre-Safisa pickup behavior for supplier orders that have never
-- entered the Safisa lifecycle. The existence of an authorization row is the
-- irreversible regime marker; is_authorized controls visibility only.

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
  v_is_safisa_managed boolean;
  v_effective_ready_quantity integer;
begin
  if p_supplier_order_item_id is null
    or p_picked_quantity is null
    or p_picked_quantity < 0
    or p_idempotency_key is null then
    raise exception using
      errcode = '22023',
      message = 'Line, nonnegative picked quantity, and idempotency key are required.';
  end if;

  v_description := nullif(btrim(p_description), '');

  if v_description is not null and char_length(v_description) > 2000 then
    raise exception using
      errcode = '22023',
      message = 'p_description must contain at most 2000 characters.';
  end if;

  v_request := jsonb_build_object(
    'supplier_order_item_id', p_supplier_order_item_id,
    'picked_quantity', p_picked_quantity,
    'description', v_description
  );

  v_existing_result := private.supplier_order_existing_result(
    p_user_id,
    p_idempotency_key,
    'PICKED_QUANTITY_CHANGED',
    v_request
  );

  if v_existing_result is not null then
    return v_existing_result;
  end if;

  select supplier_order_id
  into v_order_id
  from public.supplier_order_items
  where id = p_supplier_order_item_id;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'The supplier-order line does not exist.';
  end if;

  -- Keep the canonical lock order: parent order, then the requested line.
  select cancelled_at
  into v_order_cancelled_at
  from public.supplier_orders
  where id = v_order_id
  for update;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'The supplier order does not exist.';
  end if;

  select *
  into v_line
  from public.supplier_order_items
  where id = p_supplier_order_item_id
    and supplier_order_id = v_order_id
  for update;

  if v_order_cancelled_at is not null then
    raise exception using
      errcode = '22023',
      message = 'A cancelled supplier order cannot change picked quantities.';
  end if;

  if p_picked_quantity < v_line.stocked_quantity then
    raise exception using
      errcode = '22023',
      message = 'picked_quantity cannot be lower than stocked_quantity.';
  end if;

  if p_picked_quantity + v_line.cancelled_quantity
    > v_line.ordered_quantity then
    raise exception using
      errcode = '22023',
      message = 'picked plus cancelled quantity cannot exceed ordered quantity.';
  end if;

  -- The order lock serializes this regime check with publication/revocation.
  select exists (
    select 1
    from public.safisa_order_authorizations as order_authorization
    where order_authorization.supplier_order_id = v_order_id
  )
  into v_is_safisa_managed;

  if v_is_safisa_managed
    and p_picked_quantity > v_line.ready_quantity then
    raise exception using
      errcode = '22023',
      message = 'picked_quantity cannot exceed ready_quantity.';
  end if;

  v_previous_quantity := v_line.picked_quantity;
  v_effective_ready_quantity := case
    when v_is_safisa_managed then v_line.ready_quantity
    else greatest(v_line.ready_quantity, p_picked_quantity)
  end;

  update public.supplier_order_items
  set
    picked_quantity = p_picked_quantity,
    ready_quantity = v_effective_ready_quantity
  where id = p_supplier_order_item_id;

  update public.supplier_orders
  set updated_at = now()
  where id = v_order_id;

  v_result := private.supplier_order_result(v_order_id)
    || jsonb_build_object(
      'supplier_order_item_id', p_supplier_order_item_id,
      'previous_picked_quantity', v_previous_quantity,
      'new_picked_quantity', p_picked_quantity,
      'picked_quantity_delta', p_picked_quantity - v_previous_quantity,
      'ready_quantity', v_effective_ready_quantity,
      'ready_waiting_pickup_quantity',
        v_effective_ready_quantity - p_picked_quantity
    );

  insert into public.supplier_order_events (
    supplier_order_id,
    supplier_order_item_id,
    event_type,
    user_id,
    user_name_snapshot,
    idempotency_key,
    previous_quantity,
    new_quantity,
    quantity_delta,
    description,
    details
  )
  values (
    v_order_id,
    p_supplier_order_item_id,
    'PICKED_QUANTITY_CHANGED',
    p_user_id,
    p_user_name,
    p_idempotency_key,
    v_previous_quantity,
    p_picked_quantity,
    p_picked_quantity - v_previous_quantity,
    v_description,
    jsonb_build_object(
      'request', v_request,
      'result', v_result
    )
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
  v_is_safisa_managed boolean;
begin
  if p_supplier_order_id is null or p_idempotency_key is null then
    raise exception using
      errcode = '22023',
      message = 'Order and idempotency key are required.';
  end if;

  v_description := nullif(btrim(p_description), '');

  if v_description is not null and char_length(v_description) > 2000 then
    raise exception using
      errcode = '22023',
      message = 'p_description must contain at most 2000 characters.';
  end if;

  v_request := jsonb_build_object(
    'supplier_order_id', p_supplier_order_id,
    'description', v_description
  );

  v_existing_result := private.supplier_order_existing_result(
    p_user_id,
    p_idempotency_key,
    'ALL_ITEMS_MARKED_PICKED',
    v_request
  );

  if v_existing_result is not null then
    return v_existing_result;
  end if;

  select cancelled_at
  into v_cancelled_at
  from public.supplier_orders
  where id = p_supplier_order_id
  for update;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'The supplier order does not exist.';
  end if;

  if v_cancelled_at is not null then
    raise exception using
      errcode = '22023',
      message = 'A cancelled supplier order cannot change picked quantities.';
  end if;

  perform 1
  from public.supplier_order_items
  where supplier_order_id = p_supplier_order_id
  order by id
  for update;

  -- The order lock serializes this irreversible transition marker with
  -- publication. Revocation leaves the row in place and cannot restore legacy.
  select exists (
    select 1
    from public.safisa_order_authorizations as order_authorization
    where order_authorization.supplier_order_id = p_supplier_order_id
  )
  into v_is_safisa_managed;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'supplier_order_item_id', order_item.id,
        'previous_picked_quantity', order_item.picked_quantity,
        'new_picked_quantity', case
          when v_is_safisa_managed then order_item.ready_quantity
          else order_item.ordered_quantity - order_item.cancelled_quantity
        end
      )
      order by order_item.id
    ),
    '[]'::jsonb
  )
  into v_changes
  from public.supplier_order_items as order_item
  where order_item.supplier_order_id = p_supplier_order_id
    and order_item.picked_quantity is distinct from case
      when v_is_safisa_managed then order_item.ready_quantity
      else order_item.ordered_quantity - order_item.cancelled_quantity
    end;

  update public.supplier_order_items
  set
    picked_quantity = case
      when v_is_safisa_managed then ready_quantity
      else ordered_quantity - cancelled_quantity
    end,
    ready_quantity = case
      when v_is_safisa_managed then ready_quantity
      else greatest(ready_quantity, ordered_quantity - cancelled_quantity)
    end
  where supplier_order_id = p_supplier_order_id
    and picked_quantity is distinct from case
      when v_is_safisa_managed then ready_quantity
      else ordered_quantity - cancelled_quantity
    end;

  update public.supplier_orders
  set updated_at = now()
  where id = p_supplier_order_id;

  v_result := private.supplier_order_result(p_supplier_order_id)
    || jsonb_build_object(
      'changed_line_count', jsonb_array_length(v_changes)
    );

  insert into public.supplier_order_events (
    supplier_order_id,
    event_type,
    user_id,
    user_name_snapshot,
    idempotency_key,
    description,
    details
  )
  values (
    p_supplier_order_id,
    'ALL_ITEMS_MARKED_PICKED',
    p_user_id,
    p_user_name,
    p_idempotency_key,
    v_description,
    jsonb_build_object(
      'request', v_request,
      'result', v_result,
      'changes', v_changes,
      'ready_only', v_is_safisa_managed
    )
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
  v_is_safisa_managed boolean;
begin
  if p_supplier_order_id is null
    or p_expected_order_updated_at is null
    or p_idempotency_key is null
    or p_user_id is null
    or nullif(btrim(p_user_name), '') is null then
    raise exception using
      errcode = '22023',
      message = 'Order, expected order version, idempotency key, and authenticated user are required.';
  end if;

  v_description := nullif(btrim(p_description), '');

  if v_description is not null and char_length(v_description) > 2000 then
    raise exception using
      errcode = '22023',
      message = 'p_description must contain at most 2000 characters.';
  end if;

  v_request := jsonb_build_object(
    'supplier_order_id', p_supplier_order_id,
    'description', v_description
  );

  v_existing_result := private.supplier_order_existing_result(
    p_user_id,
    p_idempotency_key,
    'ALL_ITEMS_MARKED_PICKED',
    v_request
  );

  if v_existing_result is not null then
    select coalesce(
      sum(
        (change.value ->> 'new_picked_quantity')::bigint
          - (change.value ->> 'previous_picked_quantity')::bigint
      ),
      0
    )
    into v_added_picked_quantity
    from public.supplier_order_events as event
    cross join lateral jsonb_array_elements(
      coalesce(event.details -> 'changes', '[]'::jsonb)
    ) as change(value)
    where event.user_id = p_user_id
      and event.idempotency_key = p_idempotency_key
      and event.event_type = 'ALL_ITEMS_MARKED_PICKED';

    return v_existing_result || jsonb_build_object(
      'added_picked_quantity', v_added_picked_quantity,
      'idempotent_replay', true
    );
  end if;

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
  from public.supplier_order_items as order_item
  where order_item.supplier_order_id = p_supplier_order_id
  order by order_item.id
  for update;

  if v_order.updated_at is distinct from p_expected_order_updated_at then
    raise exception using
      errcode = '40001',
      message = 'supplier_order_version_conflict';
  end if;

  select exists (
    select 1
    from public.safisa_order_authorizations as order_authorization
    where order_authorization.supplier_order_id = p_supplier_order_id
  )
  into v_is_safisa_managed;

  select coalesce(
    sum(
      case
        when v_is_safisa_managed
          then order_item.ready_quantity - order_item.picked_quantity
        else order_item.ordered_quantity
          - order_item.cancelled_quantity
          - order_item.picked_quantity
      end
    ),
    0
  )
  into v_added_picked_quantity
  from public.supplier_order_items as order_item
  where order_item.supplier_order_id = p_supplier_order_id;

  v_result := private.mark_supplier_order_all_picked(
    p_supplier_order_id,
    v_description,
    p_idempotency_key,
    p_user_id,
    btrim(p_user_name)
  );

  return v_result || jsonb_build_object(
    'added_picked_quantity', v_added_picked_quantity,
    'idempotent_replay', false
  );
end;
$$;

comment on function private.set_supplier_order_item_picked_quantity(
  uuid, integer, text, uuid, uuid, text
) is 'Canonical pickup worker. Orders without a Safisa authorization retain legacy pickup behavior and atomically advance ready_quantity; authorization existence permanently enables Safisa readiness enforcement.';

comment on function private.mark_supplier_order_all_picked(
  uuid, text, uuid, uuid, text
) is 'Canonical bulk pickup worker. Legacy orders pick the valid uncancelled remainder and advance readiness; Safisa-managed orders pick ready units only.';

comment on function private.mark_supplier_order_all_picked_checked(
  uuid, text, timestamptz, uuid, uuid, text
) is 'Optimistic-concurrency bulk pickup worker with irreversible authorization-based legacy-to-Safisa regime selection.';
