-- MIG-ORD-007A: every newly picked supplier-order unit enters stock in the
-- same PostgreSQL transaction. Historical picked/stocked backlog is preserved.

create function private.apply_supplier_order_stock_entry(
  p_supplier_order_id uuid,
  p_lines jsonb,
  p_note text,
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
  v_note text;
  v_lines jsonb;
  v_order public.supplier_orders%rowtype;
  v_order_line record;
  v_requested_line_count integer;
  v_locked_line_count integer := 0;
  v_total_quantity bigint := 0;
  v_available_quantity integer;
  v_stock_code_id uuid;
  v_stock_lines jsonb := '[]'::jsonb;
  v_resolved_lines jsonb := '[]'::jsonb;
  v_movement_description text;
  v_stock_result jsonb;
  v_movement_batch_id uuid;
  v_stock_entry_id uuid;
  v_created_at timestamptz;
  v_inserted_lines integer := 0;
  v_updated_lines integer := 0;
begin
  if p_supplier_order_id is null
    or p_idempotency_key is null
    or p_user_id is null
    or nullif(btrim(p_user_name), '') is null then
    raise exception using
      errcode = '22023',
      message = 'Order, idempotency key, and authenticated user are required.';
  end if;

  v_note := nullif(btrim(p_note), '');

  if v_note is not null and char_length(v_note) > 500 then
    raise exception using
      errcode = '22023',
      message = 'p_note must contain at most 500 characters.';
  end if;

  v_lines := private.normalize_supplier_order_stock_entry_lines(p_lines);
  v_requested_line_count := jsonb_array_length(v_lines);

  -- The supplier-order event is the external idempotency ledger. A movement
  -- batch without that event must never be adopted by this operation.
  if exists (
    select 1
    from public.movement_batches as batch
    where batch.user_id = p_user_id
      and batch.idempotency_key = p_idempotency_key
  ) then
    raise exception using
      errcode = '22023',
      message = 'p_idempotency_key has already been used by another stock operation.';
  end if;

  -- Re-locking a row already locked by the canonical caller is harmless and
  -- makes this primitive safe for the standalone stock-entry worker too.
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

  for v_order_line in
    select
      order_item.id,
      order_item.item_id,
      order_item.commercial_configuration_id,
      order_item.commercial_configuration_code_id,
      order_item.picked_quantity,
      order_item.stocked_quantity,
      requested_line.quantity
    from jsonb_to_recordset(v_lines) as requested_line(
      supplier_order_item_id uuid,
      quantity integer
    )
    join public.supplier_order_items as order_item
      on order_item.id = requested_line.supplier_order_item_id
     and order_item.supplier_order_id = p_supplier_order_id
    order by order_item.id
    for update of order_item
  loop
    v_locked_line_count := v_locked_line_count + 1;
    v_available_quantity :=
      v_order_line.picked_quantity - v_order_line.stocked_quantity;

    if v_order_line.quantity > v_available_quantity then
      raise exception using
        errcode = '22023',
        message = 'The stock-entry quantity cannot exceed the quantity already picked and still awaiting stock entry.';
    end if;

    v_total_quantity := v_total_quantity + v_order_line.quantity;

    if v_total_quantity > 2147483647 then
      raise exception using
        errcode = '22003',
        message = 'The total stock-entry quantity exceeds the PostgreSQL integer range.';
    end if;

    if v_order_line.item_id is not null then
      v_stock_lines := v_stock_lines || jsonb_build_array(
        jsonb_build_object(
          'kind', 'ITEM',
          'item_id', v_order_line.item_id,
          'quantity', v_order_line.quantity
        )
      );

      v_resolved_lines := v_resolved_lines || jsonb_build_array(
        jsonb_build_object(
          'supplier_order_item_id', v_order_line.id,
          'quantity', v_order_line.quantity,
          'item_id', v_order_line.item_id,
          'commercial_configuration_id', null,
          'stock_commercial_code_id', null
        )
      );
    else
      v_stock_code_id := v_order_line.commercial_configuration_code_id;

      if v_stock_code_id is null then
        select commercial_code.id
        into v_stock_code_id
        from public.commercial_configuration_codes as commercial_code
        where commercial_code.configuration_id =
          v_order_line.commercial_configuration_id
          and commercial_code.is_active
        order by commercial_code.code, commercial_code.id
        limit 1
        for share;

        if not found then
          raise exception using
            errcode = '22023',
            message = 'A commercial configuration awaiting stock entry must have an active commercial code.';
        end if;
      end if;

      v_stock_lines := v_stock_lines || jsonb_build_array(
        jsonb_build_object(
          'kind', 'COMMERCIAL_CODE',
          'commercial_code_id', v_stock_code_id,
          'quantity', v_order_line.quantity
        )
      );

      v_resolved_lines := v_resolved_lines || jsonb_build_array(
        jsonb_build_object(
          'supplier_order_item_id', v_order_line.id,
          'quantity', v_order_line.quantity,
          'item_id', null,
          'commercial_configuration_id',
            v_order_line.commercial_configuration_id,
          'stock_commercial_code_id', v_stock_code_id
        )
      );
    end if;
  end loop;

  if v_locked_line_count <> v_requested_line_count then
    raise exception using
      errcode = '22023',
      message = 'Every stock-entry line must belong to the informed supplier order.';
  end if;

  v_movement_description :=
    'Entrada pelo pedido ' || v_order.negotiation_number;

  if v_note is not null then
    v_movement_description := v_movement_description || ' - ' || v_note;
  end if;

  v_stock_result := private.stock_inbound_lines(
    v_stock_lines,
    p_idempotency_key,
    p_user_id,
    btrim(p_user_name),
    v_movement_description
  );

  v_movement_batch_id :=
    (v_stock_result ->> 'movement_batch_id')::uuid;

  insert into public.supplier_order_stock_entries (
    supplier_order_id,
    movement_batch_id,
    note,
    created_by,
    created_by_name_snapshot
  )
  values (
    p_supplier_order_id,
    v_movement_batch_id,
    v_note,
    p_user_id,
    btrim(p_user_name)
  )
  returning id, created_at
  into v_stock_entry_id, v_created_at;

  insert into public.supplier_order_stock_entry_lines (
    supplier_order_stock_entry_id,
    supplier_order_item_id,
    inbound_batch_line_id,
    quantity,
    item_id,
    commercial_configuration_id
  )
  select
    v_stock_entry_id,
    resolved_line.supplier_order_item_id,
    inbound_line.id,
    resolved_line.quantity,
    resolved_line.item_id,
    resolved_line.commercial_configuration_id
  from jsonb_to_recordset(v_resolved_lines) as resolved_line(
    supplier_order_item_id uuid,
    quantity integer,
    item_id uuid,
    commercial_configuration_id uuid,
    stock_commercial_code_id uuid
  )
  join public.inbound_batch_lines as inbound_line
    on inbound_line.batch_id = v_movement_batch_id
   and (
     (
       resolved_line.item_id is not null
       and inbound_line.item_id = resolved_line.item_id
     )
     or
     (
       resolved_line.commercial_configuration_id is not null
       and inbound_line.commercial_configuration_code_id =
         resolved_line.stock_commercial_code_id
     )
   )
  order by resolved_line.supplier_order_item_id;

  get diagnostics v_inserted_lines = row_count;

  if v_inserted_lines <> v_requested_line_count then
    raise exception using
      errcode = '23514',
      message = 'Could not link every supplier-order line to its real inbound batch line.';
  end if;

  update public.supplier_order_items as order_item
  set stocked_quantity =
    order_item.stocked_quantity + resolved_line.quantity
  from jsonb_to_recordset(v_resolved_lines) as resolved_line(
    supplier_order_item_id uuid,
    quantity integer,
    item_id uuid,
    commercial_configuration_id uuid,
    stock_commercial_code_id uuid
  )
  where order_item.id = resolved_line.supplier_order_item_id
    and order_item.supplier_order_id = p_supplier_order_id;

  get diagnostics v_updated_lines = row_count;

  if v_updated_lines <> v_requested_line_count then
    raise exception using
      errcode = '23514',
      message = 'Could not update every supplier-order stocked quantity.';
  end if;

  return jsonb_build_object(
    'supplier_order_stock_entry_id', v_stock_entry_id,
    'movement_batch_id', v_movement_batch_id,
    'stock_entry_line_count', v_requested_line_count,
    'stock_entry_quantity', v_total_quantity,
    'stock_entry_created_at', v_created_at
  );
end;
$$;

create or replace function private.create_supplier_order_stock_entry(
  p_supplier_order_id uuid,
  p_lines jsonb,
  p_note text,
  p_expected_updated_at timestamptz,
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
  v_note text;
  v_lines jsonb;
  v_request jsonb;
  v_existing_result jsonb;
  v_order public.supplier_orders%rowtype;
  v_stock_receipt jsonb;
  v_result jsonb;
begin
  if p_supplier_order_id is null
    or p_expected_updated_at is null
    or p_idempotency_key is null
    or p_user_id is null
    or nullif(btrim(p_user_name), '') is null then
    raise exception using
      errcode = '22023',
      message = 'Order, expected updated_at, idempotency key, and authenticated user are required.';
  end if;

  v_note := nullif(btrim(p_note), '');

  if v_note is not null and char_length(v_note) > 500 then
    raise exception using
      errcode = '22023',
      message = 'p_note must contain at most 500 characters.';
  end if;

  v_lines := private.normalize_supplier_order_stock_entry_lines(p_lines);
  v_request := jsonb_build_object(
    'supplier_order_id', p_supplier_order_id,
    'lines', v_lines,
    'note', v_note,
    'expected_updated_at', p_expected_updated_at
  );

  v_existing_result := private.supplier_order_existing_result(
    p_user_id,
    p_idempotency_key,
    'STOCK_ENTRY_CREATED',
    v_request
  );

  if v_existing_result is not null then
    return v_existing_result;
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

  if v_order.updated_at is distinct from p_expected_updated_at then
    raise exception using
      errcode = '40001',
      message = 'The supplier order changed after it was loaded. Reload it before creating the stock entry.';
  end if;

  v_stock_receipt := private.apply_supplier_order_stock_entry(
    p_supplier_order_id,
    v_lines,
    v_note,
    p_idempotency_key,
    p_user_id,
    btrim(p_user_name)
  );

  update public.supplier_orders
  set updated_at = now()
  where id = p_supplier_order_id;

  v_result := private.supplier_order_result(p_supplier_order_id)
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
    'STOCK_ENTRY_CREATED',
    p_user_id,
    btrim(p_user_name),
    p_idempotency_key,
    v_note,
    jsonb_build_object(
      'request', v_request,
      'result', v_result,
      'movement_batch_id', v_stock_receipt -> 'movement_batch_id',
      'supplier_order_stock_entry_id',
        v_stock_receipt -> 'supplier_order_stock_entry_id',
      'line_count', v_stock_receipt -> 'stock_entry_line_count',
      'total_quantity', v_stock_receipt -> 'stock_entry_quantity'
    )
  );

  return v_result;
end;
$$;

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

revoke all on function private.apply_supplier_order_stock_entry(
  uuid,
  jsonb,
  text,
  uuid,
  uuid,
  text
) from public, anon, authenticated;

comment on function private.apply_supplier_order_stock_entry(
  uuid,
  jsonb,
  text,
  uuid,
  uuid,
  text
) is
  'Shared physical supplier-order inbound primitive. Callers own the supplier-order event and external idempotency contract.';

comment on function private.create_supplier_order_stock_entry(
  uuid,
  jsonb,
  text,
  timestamptz,
  uuid,
  uuid,
  text
) is
  'Standalone backlog stock entry. Reuses the shared physical primitive and keeps STOCK_ENTRY_CREATED as its idempotency ledger.';

comment on function private.set_supplier_order_item_picked_quantity(
  uuid,
  integer,
  text,
  uuid,
  uuid,
  text
) is
  'Canonical atomic pickup worker. A positive newly picked delta enters stock in the same transaction; reductions are rejected.';

comment on function private.mark_supplier_order_all_picked(
  uuid,
  text,
  uuid,
  uuid,
  text
) is
  'Canonical atomic bulk pickup worker. Ready deltas enter through one batch and one supplier-order stock entry.';
