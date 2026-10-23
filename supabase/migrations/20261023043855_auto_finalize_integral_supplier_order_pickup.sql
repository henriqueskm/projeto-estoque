begin;

-- No backfill: invoked only by a positive canonical pickup in this transaction,
-- AFTER its automatic stock entry and BEFORE the immutable pickup receipt.
create function private.auto_finalize_integral_supplier_order_pickup(
  p_supplier_order_id uuid, p_user_id uuid, p_user_name text
)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_order public.supplier_orders%rowtype;
begin
  -- Caller already holds parent -> ALL lines -> stock locks in that order.
  select * into v_order from public.supplier_orders
    where id = p_supplier_order_id for update;
  if not found or v_order.cancelled_at is not null or v_order.finalized_at is not null then
    return;
  end if;
  if not exists (select 1 from public.supplier_order_items where supplier_order_id = p_supplier_order_id)
    or exists (select 1 from public.supplier_order_items where supplier_order_id = p_supplier_order_id
      and (picked_quantity <> ordered_quantity or cancelled_quantity <> 0)) then
    return;
  end if;
  -- Canonical metadata, eligibility, name snapshot and ORDER_FINALIZED audit.
  -- Separate internal event key, never the pickup/stock idempotency key. Replay
  -- returns the stored pickup receipt before reaching this function again.
  perform private.finalize_supplier_order(p_supplier_order_id, v_order.updated_at,
    'Finalização automática após retirada integral', gen_random_uuid(), p_user_id, btrim(p_user_name));
end;
$$;
revoke all on function private.auto_finalize_integral_supplier_order_pickup(uuid, uuid, text)
  from public, anon, authenticated, service_role;

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
  v_order public.supplier_orders%rowtype;
  v_line public.supplier_order_items%rowtype;
  v_previous_quantity integer;
  v_delta integer;
  v_stock_receipt jsonb := '{}'::jsonb;
begin
  if p_supplier_order_item_id is null
    or p_picked_quantity is null
    or p_picked_quantity < 0
    or p_idempotency_key is null
    or p_user_id is null
    or nullif(btrim(p_user_name), '') is null then
    raise exception using
      errcode = '22023',
      message = 'Line, nonnegative picked quantity, idempotency key, and authenticated user are required.';
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
    return v_existing_result
      || jsonb_build_object('idempotent_replay', true);
  end if;

  select supplier_order.*
  into v_order
  from public.supplier_order_items as order_item
  join public.supplier_orders as supplier_order
    on supplier_order.id = order_item.supplier_order_id
  where order_item.id = p_supplier_order_item_id
  for update of supplier_order;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'The supplier-order line does not exist.';
  end if;

  if v_order.finalized_at is not null then
    raise exception using
      errcode = '22023',
      message = 'A finalized supplier order cannot be changed.';
  end if;

  -- Lock every line before stock targets. Finalization reuses these locks.
  perform 1 from public.supplier_order_items
  where supplier_order_id = v_order.id order by id for update;

  select order_item.*
  into v_line
  from public.supplier_order_items as order_item
  where order_item.id = p_supplier_order_item_id
    and order_item.supplier_order_id = v_order.id
  for update;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'The supplier-order line does not exist.';
  end if;

  if v_order.cancelled_at is not null then
    raise exception using
      errcode = '22023',
      message = 'A cancelled supplier order cannot change picked quantities.';
  end if;

  if p_picked_quantity < v_line.picked_quantity then
    raise exception using
      errcode = '22023',
      message = 'picked_quantity cannot be reduced by the pickup operation.';
  end if;

  if p_picked_quantity > v_line.ready_quantity then
    raise exception using
      errcode = '22023',
      message = 'picked_quantity cannot exceed ready_quantity.';
  end if;

  if p_picked_quantity + v_line.cancelled_quantity > v_line.ordered_quantity then
    raise exception using
      errcode = '22023',
      message = 'picked plus cancelled quantity cannot exceed ordered quantity.';
  end if;

  v_previous_quantity := v_line.picked_quantity;
  v_delta := p_picked_quantity - v_previous_quantity;

  if v_delta > 0 then
    update public.supplier_order_items
    set picked_quantity = p_picked_quantity
    where id = p_supplier_order_item_id;

    v_stock_receipt := private.apply_supplier_order_stock_entry(
      v_order.id,
      jsonb_build_array(
        jsonb_build_object(
          'supplier_order_item_id', p_supplier_order_item_id,
          'quantity', v_delta
        )
      ),
      null,
      p_idempotency_key,
      p_user_id,
      btrim(p_user_name)
    );
  end if;

  update public.supplier_orders
  set updated_at = now()
  where id = v_order.id;

  if v_delta > 0 then
    perform private.auto_finalize_integral_supplier_order_pickup(v_order.id, p_user_id, p_user_name);
  end if;

  v_result := private.supplier_order_result(v_order.id)
    || jsonb_build_object(
      'supplier_order_item_id', p_supplier_order_item_id,
      'previous_picked_quantity', v_previous_quantity,
      'new_picked_quantity', p_picked_quantity,
      'picked_quantity_delta', v_delta,
      'ready_quantity', v_line.ready_quantity,
      'ready_waiting_pickup_quantity',
        v_line.ready_quantity - p_picked_quantity,
      'idempotent_replay', false
    )
    || v_stock_receipt;

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
    v_order.id,
    p_supplier_order_item_id,
    'PICKED_QUANTITY_CHANGED',
    p_user_id,
    btrim(p_user_name),
    p_idempotency_key,
    v_previous_quantity,
    p_picked_quantity,
    v_delta,
    v_description,
    jsonb_build_object(
      'request', v_request,
      'result', v_result,
      'automatic_stock_entry', v_stock_receipt
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
  v_order public.supplier_orders%rowtype;
  v_changes jsonb;
  v_stock_lines jsonb;
  v_added_picked_quantity bigint := 0;
  v_stock_receipt jsonb := '{}'::jsonb;
begin
  if p_supplier_order_id is null
    or p_idempotency_key is null
    or p_user_id is null
    or nullif(btrim(p_user_name), '') is null then
    raise exception using
      errcode = '22023',
      message = 'Order, idempotency key, and authenticated user are required.';
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
    return v_existing_result
      || jsonb_build_object('idempotent_replay', true);
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

  if v_order.finalized_at is not null then
    raise exception using
      errcode = '22023',
      message = 'A finalized supplier order cannot be changed.';
  end if;

  if v_order.cancelled_at is not null then
    raise exception using
      errcode = '22023',
      message = 'A cancelled supplier order cannot change picked quantities.';
  end if;

  perform 1
  from public.supplier_order_items as order_item
  where order_item.supplier_order_id = p_supplier_order_id
  order by order_item.id
  for update;

  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'supplier_order_item_id', order_item.id,
          'previous_picked_quantity', order_item.picked_quantity,
          'new_picked_quantity', order_item.ready_quantity,
          'picked_quantity_delta',
            order_item.ready_quantity - order_item.picked_quantity
        )
        order by order_item.id
      ) filter (
        where order_item.ready_quantity > order_item.picked_quantity
      ),
      '[]'::jsonb
    ),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'supplier_order_item_id', order_item.id,
          'quantity', order_item.ready_quantity - order_item.picked_quantity
        )
        order by order_item.id
      ) filter (
        where order_item.ready_quantity > order_item.picked_quantity
      ),
      '[]'::jsonb
    ),
    coalesce(
      sum(order_item.ready_quantity - order_item.picked_quantity)
        filter (where order_item.ready_quantity > order_item.picked_quantity),
      0
    )
  into v_changes, v_stock_lines, v_added_picked_quantity
  from public.supplier_order_items as order_item
  where order_item.supplier_order_id = p_supplier_order_id;

  if v_added_picked_quantity > 0 then
    update public.supplier_order_items
    set picked_quantity = ready_quantity
    where supplier_order_id = p_supplier_order_id
      and ready_quantity > picked_quantity;

    v_stock_receipt := private.apply_supplier_order_stock_entry(
      p_supplier_order_id,
      v_stock_lines,
      null,
      p_idempotency_key,
      p_user_id,
      btrim(p_user_name)
    );
  end if;

  update public.supplier_orders
  set updated_at = now()
  where id = p_supplier_order_id;

  if v_added_picked_quantity > 0 then
    perform private.auto_finalize_integral_supplier_order_pickup(p_supplier_order_id, p_user_id, p_user_name);
  end if;

  v_result := private.supplier_order_result(p_supplier_order_id)
    || jsonb_build_object(
      'changed_line_count', jsonb_array_length(v_changes),
      'added_picked_quantity', v_added_picked_quantity,
      'idempotent_replay', false
    )
    || v_stock_receipt;

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
    btrim(p_user_name),
    p_idempotency_key,
    v_description,
    jsonb_build_object(
      'request', v_request,
      'result', v_result,
      'changes', v_changes,
      'ready_only', true,
      'automatic_stock_entry', v_stock_receipt
    )
  );

  return v_result;
end;
$$;

commit;
