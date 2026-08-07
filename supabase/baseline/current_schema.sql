


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "private";


ALTER SCHEMA "private" OWNER TO "postgres";


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "private"."adjust_inventory_stock"("p_target_type" "text", "p_target_id" "uuid", "p_counted_quantity" integer, "p_reason" "text", "p_idempotency_key" "uuid", "p_user_id" "uuid", "p_user_name" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_request_id uuid;
  v_normalized_reason text;
  v_item_type text;
  v_quantity_before integer;
  v_quantity_change integer;
  v_batch_id uuid;
  v_existing_target_type text;
  v_existing_item_id uuid;
  v_existing_configuration_id uuid;
  v_existing_counted_quantity integer;
  v_existing_reason text;
  v_existing_batch_id uuid;
  v_existing_quantity_before integer;
  v_existing_quantity_change integer;
  v_existing_quantity_after integer;
  v_existing_completed_at timestamptz;
  v_other_batch_id uuid;
begin
  if p_user_id is null then
    raise exception using
      errcode = '22023',
      message = 'p_user_id is required for a stock adjustment.';
  end if;

  if p_target_type not in ('ITEM', 'CONFIGURATION') then
    raise exception using
      errcode = '22023',
      message = 'p_target_type must be ITEM or CONFIGURATION.';
  end if;

  if p_target_id is null then
    raise exception using
      errcode = '22023',
      message = 'p_target_id is required for a stock adjustment.';
  end if;

  if p_counted_quantity is null or p_counted_quantity < 0 then
    raise exception using
      errcode = '22023',
      message = 'p_counted_quantity must be a non-negative PostgreSQL integer.';
  end if;

  v_normalized_reason := btrim(p_reason);

  if v_normalized_reason is null
    or v_normalized_reason = ''
    or char_length(v_normalized_reason) > 500 then
    raise exception using
      errcode = '22023',
      message = 'p_reason must contain between 1 and 500 characters.';
  end if;

  if p_idempotency_key is null then
    raise exception using
      errcode = '22023',
      message = 'p_idempotency_key is required for a stock adjustment.';
  end if;

  insert into private.stock_adjustment_requests (
    user_id,
    user_name_snapshot,
    idempotency_key,
    target_type,
    item_id,
    configuration_id,
    counted_quantity,
    reason
  )
  values (
    p_user_id,
    p_user_name,
    p_idempotency_key,
    p_target_type,
    case when p_target_type = 'ITEM' then p_target_id end,
    case when p_target_type = 'CONFIGURATION' then p_target_id end,
    p_counted_quantity,
    v_normalized_reason
  )
  on conflict (user_id, idempotency_key)
    where user_id is not null
  do nothing
  returning id into v_request_id;

  if not found then
    select
      request.target_type,
      request.item_id,
      request.configuration_id,
      request.counted_quantity,
      request.reason,
      request.movement_batch_id,
      request.quantity_before,
      request.quantity_change,
      request.quantity_after,
      request.completed_at
    into
      v_existing_target_type,
      v_existing_item_id,
      v_existing_configuration_id,
      v_existing_counted_quantity,
      v_existing_reason,
      v_existing_batch_id,
      v_existing_quantity_before,
      v_existing_quantity_change,
      v_existing_quantity_after,
      v_existing_completed_at
    from private.stock_adjustment_requests as request
    where request.user_id = p_user_id
      and request.idempotency_key = p_idempotency_key
    for share;

    if not found or v_existing_completed_at is null then
      raise exception using
        errcode = '23505',
        message = 'The existing stock adjustment request could not be resolved.';
    end if;

    if v_existing_target_type is distinct from p_target_type
      or v_existing_item_id is distinct from (
        case when p_target_type = 'ITEM' then p_target_id end
      )
      or v_existing_configuration_id is distinct from (
        case when p_target_type = 'CONFIGURATION' then p_target_id end
      )
      or v_existing_counted_quantity is distinct from p_counted_quantity
      or v_existing_reason is distinct from v_normalized_reason then
      raise exception using
        errcode = '22023',
        message = 'p_idempotency_key has already been used with a different stock adjustment request.';
    end if;

    select batch.id
    into v_other_batch_id
    from public.movement_batches as batch
    where batch.user_id = p_user_id
      and batch.idempotency_key = p_idempotency_key;

    if found and v_other_batch_id is distinct from v_existing_batch_id then
      raise exception using
        errcode = '22023',
        message = 'p_idempotency_key has already been used by another stock operation.';
    end if;

    return jsonb_build_object(
      'movement_batch_id', v_existing_batch_id,
      'adjustment_applied', v_existing_quantity_change <> 0,
      'quantity_before', v_existing_quantity_before,
      'quantity_change', v_existing_quantity_change,
      'quantity_after', v_existing_quantity_after
    );
  end if;

  perform 1
  from public.movement_batches as batch
  where batch.user_id = p_user_id
    and batch.idempotency_key = p_idempotency_key
  for share;

  if found then
    raise exception using
      errcode = '22023',
      message = 'p_idempotency_key has already been used by another stock operation.';
  end if;

  if p_target_type = 'ITEM' then
    select item.item_type
    into v_item_type
    from public.items as item
    where item.id = p_target_id
    for share;

    if not found then
      raise exception using
        errcode = '22023',
        message = format('Item %s does not exist.', p_target_id);
    end if;

    if v_item_type not in (
      'SERVO',
      'INSTALLATION_KIT',
      'REPAIR_KIT',
      'LOOSE_PART'
    ) then
      raise exception using
        errcode = '22023',
        message = format(
          'Item %s has unsupported item_type %s.',
          p_target_id,
          v_item_type
        );
    end if;

    insert into public.stock_balances (item_id, quantity)
    values (p_target_id, 0)
    on conflict (item_id) do nothing;

    select balance.quantity
    into v_quantity_before
    from public.stock_balances as balance
    where balance.item_id = p_target_id
    for update;
  else
    perform 1
    from public.commercial_configurations as configuration
    where configuration.id = p_target_id
    for share;

    if not found then
      raise exception using
        errcode = '22023',
        message = format(
          'Commercial configuration %s does not exist.',
          p_target_id
        );
    end if;

    insert into public.configuration_stock_balances (
      configuration_id,
      quantity
    )
    values (p_target_id, 0)
    on conflict (configuration_id) do nothing;

    select balance.quantity
    into v_quantity_before
    from public.configuration_stock_balances as balance
    where balance.configuration_id = p_target_id
    for update;
  end if;

  if v_quantity_before is null then
    raise exception using
      errcode = '23514',
      message = 'The stock balance could not be locked for adjustment.';
  end if;

  v_quantity_change := p_counted_quantity - v_quantity_before;

  if v_quantity_change = 0 then
    update private.stock_adjustment_requests
    set quantity_before = v_quantity_before,
        quantity_change = 0,
        quantity_after = p_counted_quantity,
        completed_at = now()
    where id = v_request_id;

    return jsonb_build_object(
      'movement_batch_id', null,
      'adjustment_applied', false,
      'quantity_before', v_quantity_before,
      'quantity_change', 0,
      'quantity_after', p_counted_quantity
    );
  end if;

  begin
    insert into public.movement_batches (
      movement_type,
      source,
      user_id,
      user_name_snapshot,
      description,
      idempotency_key
    )
    values (
      'ADJUSTMENT',
      'MANUAL',
      p_user_id,
      p_user_name,
      v_normalized_reason,
      p_idempotency_key
    )
    returning id into v_batch_id;
  exception
    when unique_violation then
      raise exception using
        errcode = '22023',
        message = 'p_idempotency_key has already been used by another stock operation.';
  end;

  if p_target_type = 'ITEM' then
    update public.stock_balances
    set quantity = p_counted_quantity,
        updated_at = now()
    where item_id = p_target_id;

    insert into public.stock_movements (
      batch_id,
      item_id,
      quantity_change,
      quantity_before,
      quantity_after
    )
    values (
      v_batch_id,
      p_target_id,
      v_quantity_change,
      v_quantity_before,
      p_counted_quantity
    );
  else
    update public.configuration_stock_balances
    set quantity = p_counted_quantity,
        updated_at = now()
    where configuration_id = p_target_id;

    insert into public.configuration_stock_movements (
      batch_id,
      configuration_id,
      quantity_change,
      quantity_before,
      quantity_after
    )
    values (
      v_batch_id,
      p_target_id,
      v_quantity_change,
      v_quantity_before,
      p_counted_quantity
    );
  end if;

  update private.stock_adjustment_requests
  set movement_batch_id = v_batch_id,
      quantity_before = v_quantity_before,
      quantity_change = v_quantity_change,
      quantity_after = p_counted_quantity,
      completed_at = now()
  where id = v_request_id;

  return jsonb_build_object(
    'movement_batch_id', v_batch_id,
    'adjustment_applied', true,
    'quantity_before', v_quantity_before,
    'quantity_change', v_quantity_change,
    'quantity_after', p_counted_quantity
  );
end;
$$;


ALTER FUNCTION "private"."adjust_inventory_stock"("p_target_type" "text", "p_target_id" "uuid", "p_counted_quantity" integer, "p_reason" "text", "p_idempotency_key" "uuid", "p_user_id" "uuid", "p_user_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."assemble_commercial_configuration"("p_configuration_id" "uuid", "p_quantity" integer, "p_user_id" "uuid", "p_source" "text", "p_description" "text") RETURNS "uuid"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_batch_id uuid;
  v_servo_id uuid;
  v_installation_kit_id uuid;
  v_servo_is_active boolean;
  v_installation_kit_is_active boolean;
  v_servo_quantity_before integer;
  v_servo_quantity_after integer;
  v_installation_kit_quantity_before integer;
  v_installation_kit_quantity_after integer;
  v_configuration_quantity_before integer;
  v_configuration_quantity_after integer;
  v_balance record;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception using
      errcode = '22023',
      message = 'p_quantity must be greater than zero.';
  end if;

  if p_source is null
    or p_source not in ('MANUAL', 'AI_CHAT', 'ORDER_PHOTO') then
    raise exception using
      errcode = '22023',
      message = 'p_source must be MANUAL, AI_CHAT, or ORDER_PHOTO.';
  end if;

  select servo_id, installation_kit_id
  into v_servo_id, v_installation_kit_id
  from public.commercial_configurations
  where id = p_configuration_id
    and is_active
  for share;

  if not found then
    raise exception using
      errcode = '22023',
      message = format(
        'Commercial configuration %s does not exist or is inactive.',
        p_configuration_id
      );
  end if;

  perform id
  from public.items
  where id = any (array[v_servo_id, v_installation_kit_id])
  order by id
  for share;

  select is_active
  into v_servo_is_active
  from public.items
  where id = v_servo_id;

  select is_active
  into v_installation_kit_is_active
  from public.items
  where id = v_installation_kit_id;

  if not coalesce(v_servo_is_active, false) then
    raise exception using
      errcode = '22023',
      message = format('Servo item %s does not exist or is inactive.', v_servo_id);
  end if;

  if not coalesce(v_installation_kit_is_active, false) then
    raise exception using
      errcode = '22023',
      message = format(
        'Installation kit item %s does not exist or is inactive.',
        v_installation_kit_id
      );
  end if;

  insert into public.configuration_stock_balances (configuration_id, quantity)
  values (p_configuration_id, 0)
  on conflict (configuration_id) do nothing;

  select quantity
  into v_configuration_quantity_before
  from public.configuration_stock_balances
  where configuration_id = p_configuration_id
  for update;

  for v_balance in
    select item_id, quantity
    from public.stock_balances
    where item_id = any (array[v_servo_id, v_installation_kit_id])
    order by item_id
    for update
  loop
    if v_balance.item_id = v_servo_id then
      v_servo_quantity_before := v_balance.quantity;
    elsif v_balance.item_id = v_installation_kit_id then
      v_installation_kit_quantity_before := v_balance.quantity;
    end if;
  end loop;

  if v_servo_quantity_before is null then
    raise exception using
      errcode = '23514',
      message = format('No stock balance exists for servo item %s.', v_servo_id);
  end if;

  if v_installation_kit_quantity_before is null then
    raise exception using
      errcode = '23514',
      message = format(
        'No stock balance exists for installation kit item %s.',
        v_installation_kit_id
      );
  end if;

  if v_servo_quantity_before < p_quantity then
    raise exception using
      errcode = '23514',
      message = format(
        'Insufficient stock for servo item %s: available %s, requested %s.',
        v_servo_id,
        v_servo_quantity_before,
        p_quantity
      );
  end if;

  if v_installation_kit_quantity_before < p_quantity then
    raise exception using
      errcode = '23514',
      message = format(
        'Insufficient stock for installation kit item %s: available %s, requested %s.',
        v_installation_kit_id,
        v_installation_kit_quantity_before,
        p_quantity
      );
  end if;

  v_servo_quantity_after := v_servo_quantity_before - p_quantity;
  v_installation_kit_quantity_after :=
    v_installation_kit_quantity_before - p_quantity;
  v_configuration_quantity_after :=
    v_configuration_quantity_before + p_quantity;

  insert into public.movement_batches (
    movement_type,
    source,
    user_id,
    description
  )
  values (
    'ASSEMBLY',
    p_source,
    p_user_id,
    p_description
  )
  returning id into v_batch_id;

  update public.configuration_stock_balances
  set quantity = v_configuration_quantity_after,
      updated_at = now()
  where configuration_id = p_configuration_id;

  update public.stock_balances
  set quantity = v_servo_quantity_after,
      updated_at = now()
  where item_id = v_servo_id;

  update public.stock_balances
  set quantity = v_installation_kit_quantity_after,
      updated_at = now()
  where item_id = v_installation_kit_id;

  insert into public.stock_movements (
    batch_id,
    item_id,
    quantity_change,
    quantity_before,
    quantity_after
  )
  values
    (
      v_batch_id,
      v_servo_id,
      -p_quantity,
      v_servo_quantity_before,
      v_servo_quantity_after
    ),
    (
      v_batch_id,
      v_installation_kit_id,
      -p_quantity,
      v_installation_kit_quantity_before,
      v_installation_kit_quantity_after
    );

  insert into public.configuration_stock_movements (
    batch_id,
    configuration_id,
    quantity_change,
    quantity_before,
    quantity_after
  )
  values (
    v_batch_id,
    p_configuration_id,
    p_quantity,
    v_configuration_quantity_before,
    v_configuration_quantity_after
  );

  insert into public.assembly_operations (
    batch_id,
    configuration_id,
    operation_type,
    quantity
  )
  values (
    v_batch_id,
    p_configuration_id,
    'ASSEMBLY',
    p_quantity
  );

  return v_batch_id;
end;
$$;


ALTER FUNCTION "private"."assemble_commercial_configuration"("p_configuration_id" "uuid", "p_quantity" integer, "p_user_id" "uuid", "p_source" "text", "p_description" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."cancel_supplier_order"("p_supplier_order_id" "uuid", "p_cancellation_note" "text", "p_idempotency_key" "uuid", "p_user_id" "uuid", "p_user_name" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_cancellation_note text;
  v_request jsonb;
  v_existing_result jsonb;
  v_result jsonb;
  v_cancelled_at timestamptz;
begin
  if p_supplier_order_id is null or p_idempotency_key is null then
    raise exception using
      errcode = '22023',
      message = 'Order and idempotency key are required.';
  end if;

  v_cancellation_note := nullif(btrim(p_cancellation_note), '');

  if v_cancellation_note is not null
    and char_length(v_cancellation_note) > 2000 then
    raise exception using
      errcode = '22023',
      message = 'p_cancellation_note must contain at most 2000 characters.';
  end if;

  v_request := jsonb_build_object(
    'supplier_order_id', p_supplier_order_id,
    'cancellation_note', v_cancellation_note
  );

  v_existing_result := private.supplier_order_existing_result(
    p_user_id,
    p_idempotency_key,
    'ORDER_CANCELLED',
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
      message = 'The supplier order is already cancelled.';
  end if;

  perform 1
  from public.supplier_order_items
  where supplier_order_id = p_supplier_order_id
  order by id
  for update;

  if exists (
    select 1
    from public.supplier_order_items
    where supplier_order_id = p_supplier_order_id
      and (picked_quantity > 0 or stocked_quantity > 0)
  ) then
    raise exception using
      errcode = '22023',
      message = 'An order with picked or stocked quantities cannot be fully cancelled.';
  end if;

  update public.supplier_order_items
  set cancelled_quantity = ordered_quantity
  where supplier_order_id = p_supplier_order_id;

  update public.supplier_orders
  set cancelled_at = now(),
      cancelled_by = p_user_id,
      cancelled_by_name_snapshot = p_user_name,
      cancellation_note = v_cancellation_note
  where id = p_supplier_order_id;

  v_result := private.supplier_order_result(p_supplier_order_id);

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
    'ORDER_CANCELLED',
    p_user_id,
    p_user_name,
    p_idempotency_key,
    v_cancellation_note,
    jsonb_build_object(
      'request', v_request,
      'result', v_result
    )
  );

  return v_result;
end;
$$;


ALTER FUNCTION "private"."cancel_supplier_order"("p_supplier_order_id" "uuid", "p_cancellation_note" "text", "p_idempotency_key" "uuid", "p_user_id" "uuid", "p_user_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."cancel_supplier_order_remaining"("p_supplier_order_id" "uuid", "p_cancellation_note" "text", "p_idempotency_key" "uuid", "p_user_id" "uuid", "p_user_name" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_cancellation_note text;
  v_request jsonb;
  v_existing_result jsonb;
  v_result jsonb;
  v_cancelled_at timestamptz;
begin
  if p_supplier_order_id is null or p_idempotency_key is null then
    raise exception using
      errcode = '22023',
      message = 'Order and idempotency key are required.';
  end if;

  v_cancellation_note := nullif(btrim(p_cancellation_note), '');

  if v_cancellation_note is not null
    and char_length(v_cancellation_note) > 2000 then
    raise exception using
      errcode = '22023',
      message = 'p_cancellation_note must contain at most 2000 characters.';
  end if;

  v_request := jsonb_build_object(
    'supplier_order_id', p_supplier_order_id,
    'cancellation_note', v_cancellation_note
  );

  v_existing_result := private.supplier_order_existing_result(
    p_user_id,
    p_idempotency_key,
    'REMAINING_QUANTITY_CANCELLED',
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
      message = 'The supplier order is already cancelled.';
  end if;

  perform 1
  from public.supplier_order_items
  where supplier_order_id = p_supplier_order_id
  order by id
  for update;

  if not exists (
    select 1
    from public.supplier_order_items
    where supplier_order_id = p_supplier_order_id
      and (picked_quantity > 0 or stocked_quantity > 0)
  ) then
    raise exception using
      errcode = '22023',
      message = 'Use full cancellation when no quantity has been picked.';
  end if;

  if not exists (
    select 1
    from public.supplier_order_items
    where supplier_order_id = p_supplier_order_id
      and ordered_quantity - picked_quantity - cancelled_quantity > 0
  ) then
    raise exception using
      errcode = '22023',
      message = 'The supplier order has no remaining pickup quantity to cancel.';
  end if;

  update public.supplier_order_items
  set cancelled_quantity = ordered_quantity - picked_quantity
  where supplier_order_id = p_supplier_order_id;

  update public.supplier_orders
  set cancelled_at = now(),
      cancelled_by = p_user_id,
      cancelled_by_name_snapshot = p_user_name,
      cancellation_note = v_cancellation_note
  where id = p_supplier_order_id;

  v_result := private.supplier_order_result(p_supplier_order_id);

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
    'REMAINING_QUANTITY_CANCELLED',
    p_user_id,
    p_user_name,
    p_idempotency_key,
    v_cancellation_note,
    jsonb_build_object(
      'request', v_request,
      'result', v_result
    )
  );

  return v_result;
end;
$$;


ALTER FUNCTION "private"."cancel_supplier_order_remaining"("p_supplier_order_id" "uuid", "p_cancellation_note" "text", "p_idempotency_key" "uuid", "p_user_id" "uuid", "p_user_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."create_supplier_order"("p_negotiation_number" "text", "p_order_date" "date", "p_notes" "text", "p_lines" "jsonb", "p_idempotency_key" "uuid", "p_user_id" "uuid", "p_user_name" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_negotiation_number text;
  v_notes text;
  v_lines jsonb;
  v_request jsonb;
  v_existing_result jsonb;
  v_result jsonb;
  v_order_id uuid;
  v_line jsonb;
begin
  v_negotiation_number := btrim(p_negotiation_number);
  v_notes := nullif(btrim(p_notes), '');

  if v_negotiation_number is null
    or char_length(v_negotiation_number) not between 1 and 120 then
    raise exception using
      errcode = '22023',
      message = 'p_negotiation_number must contain between 1 and 120 characters.';
  end if;

  if p_order_date is null then
    raise exception using
      errcode = '22023',
      message = 'p_order_date is required.';
  end if;

  if v_notes is not null and char_length(v_notes) > 2000 then
    raise exception using
      errcode = '22023',
      message = 'p_notes must contain at most 2000 characters.';
  end if;

  if p_idempotency_key is null then
    raise exception using
      errcode = '22023',
      message = 'p_idempotency_key is required.';
  end if;

  v_lines := private.normalize_supplier_order_lines(p_lines, false);
  v_request := jsonb_build_object(
    'negotiation_number', v_negotiation_number,
    'order_date', p_order_date,
    'notes', v_notes,
    'lines', v_lines
  );

  v_existing_result := private.supplier_order_existing_result(
    p_user_id,
    p_idempotency_key,
    'ORDER_CREATED',
    v_request
  );

  if v_existing_result is not null then
    return v_existing_result;
  end if;

  -- Validate the complete catalog payload before the first write.
  for v_line in
    select value
    from jsonb_array_elements(v_lines)
    order by coalesce(
      value ->> 'item_id',
      value ->> 'commercial_configuration_id'
    ),
    value ->> 'commercial_configuration_code_id'
  loop
    perform *
    from private.supplier_order_catalog_snapshot(
      nullif(v_line ->> 'item_id', '')::uuid,
      nullif(v_line ->> 'commercial_configuration_id', '')::uuid,
      nullif(v_line ->> 'commercial_configuration_code_id', '')::uuid,
      true
    );
  end loop;

  insert into public.supplier_orders (
    negotiation_number,
    order_date,
    notes,
    created_by,
    created_by_name_snapshot
  )
  values (
    v_negotiation_number,
    p_order_date,
    v_notes,
    p_user_id,
    p_user_name
  )
  returning id into v_order_id;

  for v_line in
    select value
    from jsonb_array_elements(v_lines)
    order by (value ->> 'position')::integer
  loop
    insert into public.supplier_order_items (
      supplier_order_id,
      item_id,
      commercial_configuration_id,
      commercial_configuration_code_id,
      code_snapshot,
      description_snapshot,
      item_type_snapshot,
      ordered_quantity,
      position,
      notes
    )
    values (
      v_order_id,
      nullif(v_line ->> 'item_id', '')::uuid,
      nullif(v_line ->> 'commercial_configuration_id', '')::uuid,
      nullif(v_line ->> 'commercial_configuration_code_id', '')::uuid,
      'SERVER_PENDING',
      'SERVER_PENDING',
      'LOOSE_PART',
      (v_line ->> 'quantity')::integer,
      (v_line ->> 'position')::integer,
      nullif(v_line ->> 'notes', '')
    );
  end loop;

  v_result := private.supplier_order_result(v_order_id);

  insert into public.supplier_order_events (
    supplier_order_id,
    event_type,
    user_id,
    user_name_snapshot,
    idempotency_key,
    details
  )
  values (
    v_order_id,
    'ORDER_CREATED',
    p_user_id,
    p_user_name,
    p_idempotency_key,
    jsonb_build_object(
      'request', v_request,
      'result', v_result
    )
  );

  return v_result;
end;
$$;


ALTER FUNCTION "private"."create_supplier_order"("p_negotiation_number" "text", "p_order_date" "date", "p_notes" "text", "p_lines" "jsonb", "p_idempotency_key" "uuid", "p_user_id" "uuid", "p_user_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."create_supplier_order_stock_entry"("p_supplier_order_id" "uuid", "p_lines" "jsonb", "p_note" "text", "p_expected_updated_at" timestamp with time zone, "p_idempotency_key" "uuid", "p_user_id" "uuid", "p_user_name" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_note text;
  v_lines jsonb;
  v_request jsonb;
  v_existing_result jsonb;
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
  v_requested_line_count := jsonb_array_length(v_lines);

  v_request := jsonb_build_object(
    'supplier_order_id', p_supplier_order_id,
    'lines', v_lines,
    'note', v_note,
    'expected_updated_at', p_expected_updated_at
  );

  -- This shared helper acquires the per-user/key advisory transaction lock.
  -- Identical retries return before the optimistic timestamp check.
  v_existing_result := private.supplier_order_existing_result(
    p_user_id,
    p_idempotency_key,
    'STOCK_ENTRY_CREATED',
    v_request
  );

  if v_existing_result is not null then
    return v_existing_result;
  end if;

  -- A movement key without the supplier-order event cannot be adopted by a
  -- different operation, even if its stock payload happens to be equivalent.
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

  select *
  into v_order
  from public.supplier_orders
  where id = p_supplier_order_id
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

  -- The order status and closure metadata are intentionally not eligibility
  -- guards. Only picked_quantity - stocked_quantity authorizes stock entry.
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

      -- The existing inbound worker addresses a physical configuration
      -- through one of its aliases. When the order did not preserve a
      -- preferred alias, choose one active alias deterministically; the new
      -- link line remains authoritative for the physical configuration.
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

  -- Reuse the approved mixed-inbound worker. It creates the normal INBOUND /
  -- MANUAL batch, audit lines, locks, movements, and balance updates.
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

  update public.supplier_orders
  set updated_at = now()
  where id = p_supplier_order_id;

  v_result := private.supplier_order_result(p_supplier_order_id)
    || jsonb_build_object(
      'supplier_order_stock_entry_id', v_stock_entry_id,
      'movement_batch_id', v_movement_batch_id,
      'stock_entry_line_count', v_requested_line_count,
      'stock_entry_quantity', v_total_quantity,
      'stock_entry_created_at', v_created_at
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
    'STOCK_ENTRY_CREATED',
    p_user_id,
    btrim(p_user_name),
    p_idempotency_key,
    v_note,
    jsonb_build_object(
      'request', v_request,
      'result', v_result,
      'movement_batch_id', v_movement_batch_id,
      'supplier_order_stock_entry_id', v_stock_entry_id,
      'line_count', v_requested_line_count,
      'total_quantity', v_total_quantity
    )
  );

  return v_result;
end;
$$;


ALTER FUNCTION "private"."create_supplier_order_stock_entry"("p_supplier_order_id" "uuid", "p_lines" "jsonb", "p_note" "text", "p_expected_updated_at" timestamp with time zone, "p_idempotency_key" "uuid", "p_user_id" "uuid", "p_user_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."disassemble_commercial_configuration"("p_configuration_id" "uuid", "p_quantity" integer, "p_user_id" "uuid", "p_source" "text", "p_description" "text") RETURNS "uuid"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_batch_id uuid;
  v_servo_id uuid;
  v_installation_kit_id uuid;
  v_servo_quantity_before integer;
  v_servo_quantity_after integer;
  v_installation_kit_quantity_before integer;
  v_installation_kit_quantity_after integer;
  v_configuration_quantity_before integer;
  v_configuration_quantity_after integer;
  v_balance record;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception using
      errcode = '22023',
      message = 'p_quantity must be greater than zero.';
  end if;

  if p_source is null
    or p_source not in ('MANUAL', 'AI_CHAT', 'ORDER_PHOTO') then
    raise exception using
      errcode = '22023',
      message = 'p_source must be MANUAL, AI_CHAT, or ORDER_PHOTO.';
  end if;

  select servo_id, installation_kit_id
  into v_servo_id, v_installation_kit_id
  from public.commercial_configurations
  where id = p_configuration_id
  for share;

  if not found then
    raise exception using
      errcode = '22023',
      message = format(
        'Commercial configuration %s does not exist.',
        p_configuration_id
      );
  end if;

  select quantity
  into v_configuration_quantity_before
  from public.configuration_stock_balances
  where configuration_id = p_configuration_id
  for update;

  if not found then
    raise exception using
      errcode = '23514',
      message = format(
        'No assembled stock balance exists for configuration %s.',
        p_configuration_id
      );
  end if;

  if v_configuration_quantity_before < p_quantity then
    raise exception using
      errcode = '23514',
      message = format(
        'Insufficient assembled stock for configuration %s: available %s, requested %s.',
        p_configuration_id,
        v_configuration_quantity_before,
        p_quantity
      );
  end if;

  insert into public.stock_balances (item_id, quantity)
  select item_id, 0
  from unnest(array[v_servo_id, v_installation_kit_id]) as ids(item_id)
  order by item_id
  on conflict (item_id) do nothing;

  for v_balance in
    select item_id, quantity
    from public.stock_balances
    where item_id = any (array[v_servo_id, v_installation_kit_id])
    order by item_id
    for update
  loop
    if v_balance.item_id = v_servo_id then
      v_servo_quantity_before := v_balance.quantity;
    elsif v_balance.item_id = v_installation_kit_id then
      v_installation_kit_quantity_before := v_balance.quantity;
    end if;
  end loop;

  v_servo_quantity_after := v_servo_quantity_before + p_quantity;
  v_installation_kit_quantity_after :=
    v_installation_kit_quantity_before + p_quantity;
  v_configuration_quantity_after :=
    v_configuration_quantity_before - p_quantity;

  insert into public.movement_batches (
    movement_type,
    source,
    user_id,
    description
  )
  values (
    'DISASSEMBLY',
    p_source,
    p_user_id,
    p_description
  )
  returning id into v_batch_id;

  update public.configuration_stock_balances
  set quantity = v_configuration_quantity_after,
      updated_at = now()
  where configuration_id = p_configuration_id;

  update public.stock_balances
  set quantity = v_servo_quantity_after,
      updated_at = now()
  where item_id = v_servo_id;

  update public.stock_balances
  set quantity = v_installation_kit_quantity_after,
      updated_at = now()
  where item_id = v_installation_kit_id;

  insert into public.configuration_stock_movements (
    batch_id,
    configuration_id,
    quantity_change,
    quantity_before,
    quantity_after
  )
  values (
    v_batch_id,
    p_configuration_id,
    -p_quantity,
    v_configuration_quantity_before,
    v_configuration_quantity_after
  );

  insert into public.stock_movements (
    batch_id,
    item_id,
    quantity_change,
    quantity_before,
    quantity_after
  )
  values
    (
      v_batch_id,
      v_servo_id,
      p_quantity,
      v_servo_quantity_before,
      v_servo_quantity_after
    ),
    (
      v_batch_id,
      v_installation_kit_id,
      p_quantity,
      v_installation_kit_quantity_before,
      v_installation_kit_quantity_after
    );

  insert into public.assembly_operations (
    batch_id,
    configuration_id,
    operation_type,
    quantity
  )
  values (
    v_batch_id,
    p_configuration_id,
    'DISASSEMBLY',
    p_quantity
  );

  return v_batch_id;
end;
$$;


ALTER FUNCTION "private"."disassemble_commercial_configuration"("p_configuration_id" "uuid", "p_quantity" integer, "p_user_id" "uuid", "p_source" "text", "p_description" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."execute_configuration_operation"("p_operation_type" "text", "p_configuration_id" "uuid", "p_quantity" integer, "p_idempotency_key" "uuid", "p_commercial_code" "text", "p_description" "text", "p_user_id" "uuid", "p_user_name" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_request_id uuid;
  v_normalized_commercial_code text;
  v_normalized_description text;
  v_commercial_code_id uuid;
  v_servo_id uuid;
  v_installation_kit_id uuid;
  v_batch_id uuid;
  v_servo_quantity_before integer;
  v_servo_quantity_after integer;
  v_kit_quantity_before integer;
  v_kit_quantity_after integer;
  v_configuration_quantity_before integer;
  v_configuration_quantity_after integer;
  v_existing_operation_type text;
  v_existing_configuration_id uuid;
  v_existing_commercial_code_snapshot text;
  v_existing_quantity integer;
  v_existing_description text;
  v_existing_batch_id uuid;
  v_existing_servo_id uuid;
  v_existing_installation_kit_id uuid;
  v_existing_servo_quantity_before integer;
  v_existing_servo_quantity_after integer;
  v_existing_kit_quantity_before integer;
  v_existing_kit_quantity_after integer;
  v_existing_configuration_quantity_before integer;
  v_existing_configuration_quantity_after integer;
  v_existing_completed_at timestamptz;
  v_other_batch_id uuid;
  v_updated_rows integer;
begin
  if p_user_id is null then
    raise exception using
      errcode = '22023',
      message = 'p_user_id is required for a configuration operation.';
  end if;

  if p_operation_type not in ('ASSEMBLY', 'DISASSEMBLY') then
    raise exception using
      errcode = '22023',
      message = 'p_operation_type must be ASSEMBLY or DISASSEMBLY.';
  end if;

  if p_configuration_id is null then
    raise exception using
      errcode = '22023',
      message = 'p_configuration_id is required for a configuration operation.';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception using
      errcode = '22023',
      message = 'p_quantity must be greater than zero.';
  end if;

  if p_idempotency_key is null then
    raise exception using
      errcode = '22023',
      message = 'p_idempotency_key is required for a configuration operation.';
  end if;

  v_normalized_commercial_code := nullif(btrim(p_commercial_code), '');
  v_normalized_description := nullif(btrim(p_description), '');

  if v_normalized_description is not null
    and char_length(v_normalized_description) > 500 then
    raise exception using
      errcode = '22023',
      message = 'p_description must contain at most 500 characters.';
  end if;

  select
    configuration.servo_id,
    configuration.installation_kit_id
  into
    v_servo_id,
    v_installation_kit_id
  from public.commercial_configurations as configuration
  where configuration.id = p_configuration_id
  for share;

  if not found then
    raise exception using
      errcode = '22023',
      message = format(
        'Commercial configuration %s does not exist.',
        p_configuration_id
      );
  end if;

  insert into private.configuration_operation_requests (
    user_id,
    user_name_snapshot,
    idempotency_key,
    operation_type,
    configuration_id,
    commercial_code_snapshot,
    quantity,
    description
  )
  values (
    p_user_id,
    p_user_name,
    p_idempotency_key,
    p_operation_type,
    p_configuration_id,
    v_normalized_commercial_code,
    p_quantity,
    v_normalized_description
  )
  on conflict (user_id, idempotency_key)
    where user_id is not null
  do nothing
  returning id into v_request_id;

  if not found then
    select
      request.operation_type,
      request.configuration_id,
      request.commercial_code_snapshot,
      request.quantity,
      request.description,
      request.movement_batch_id,
      request.servo_id,
      request.installation_kit_id,
      request.servo_quantity_before,
      request.servo_quantity_after,
      request.kit_quantity_before,
      request.kit_quantity_after,
      request.configuration_quantity_before,
      request.configuration_quantity_after,
      request.completed_at
    into
      v_existing_operation_type,
      v_existing_configuration_id,
      v_existing_commercial_code_snapshot,
      v_existing_quantity,
      v_existing_description,
      v_existing_batch_id,
      v_existing_servo_id,
      v_existing_installation_kit_id,
      v_existing_servo_quantity_before,
      v_existing_servo_quantity_after,
      v_existing_kit_quantity_before,
      v_existing_kit_quantity_after,
      v_existing_configuration_quantity_before,
      v_existing_configuration_quantity_after,
      v_existing_completed_at
    from private.configuration_operation_requests as request
    where request.user_id = p_user_id
      and request.idempotency_key = p_idempotency_key
    for share;

    if not found or v_existing_completed_at is null then
      raise exception using
        errcode = '23505',
        message = 'The existing configuration operation request could not be resolved.';
    end if;

    if v_existing_operation_type is distinct from p_operation_type
      or v_existing_configuration_id is distinct from p_configuration_id
      or v_existing_commercial_code_snapshot is distinct from v_normalized_commercial_code
      or v_existing_quantity is distinct from p_quantity
      or v_existing_description is distinct from v_normalized_description then
      raise exception using
        errcode = '22023',
        message = 'p_idempotency_key has already been used with a different configuration operation request.';
    end if;

    select batch.id
    into v_other_batch_id
    from public.movement_batches as batch
    where batch.user_id = p_user_id
      and batch.idempotency_key = p_idempotency_key;

    if not found or v_other_batch_id is distinct from v_existing_batch_id then
      raise exception using
        errcode = '22023',
        message = 'The movement batch for the existing configuration operation could not be resolved.';
    end if;

    return jsonb_build_object(
      'movement_batch_id', v_existing_batch_id,
      'operation_type', v_existing_operation_type,
      'configuration_id', v_existing_configuration_id,
      'commercial_code', v_existing_commercial_code_snapshot,
      'quantity', v_existing_quantity,
      'servo_id', v_existing_servo_id,
      'installation_kit_id', v_existing_installation_kit_id,
      'servo_quantity_before', v_existing_servo_quantity_before,
      'servo_quantity_after', v_existing_servo_quantity_after,
      'kit_quantity_before', v_existing_kit_quantity_before,
      'kit_quantity_after', v_existing_kit_quantity_after,
      'configuration_quantity_before', v_existing_configuration_quantity_before,
      'configuration_quantity_after', v_existing_configuration_quantity_after,
      'operation_applied', true
    );
  end if;

  perform 1
  from public.movement_batches as batch
  where batch.user_id = p_user_id
    and batch.idempotency_key = p_idempotency_key
  for share;

  if found then
    raise exception using
      errcode = '22023',
      message = 'p_idempotency_key has already been used by another stock operation.';
  end if;

  if v_normalized_commercial_code is not null then
    select commercial_code.id
    into v_commercial_code_id
    from public.commercial_configuration_codes as commercial_code
    where commercial_code.code = v_normalized_commercial_code
      and commercial_code.configuration_id = p_configuration_id
    for share;

    if not found then
      raise exception using
        errcode = '22023',
        message = format(
          'Commercial code %s does not belong to configuration %s.',
          v_normalized_commercial_code,
          p_configuration_id
        );
    end if;

    update private.configuration_operation_requests
    set commercial_configuration_code_id = v_commercial_code_id,
        commercial_code_snapshot = v_normalized_commercial_code
    where id = v_request_id;
  end if;

  begin
    if p_operation_type = 'ASSEMBLY' then
      v_batch_id := private.assemble_commercial_configuration(
        p_configuration_id,
        p_quantity,
        p_user_id,
        'MANUAL',
        v_normalized_description
      );
    else
      v_batch_id := private.disassemble_commercial_configuration(
        p_configuration_id,
        p_quantity,
        p_user_id,
        'MANUAL',
        v_normalized_description
      );
    end if;

    update public.movement_batches
    set user_name_snapshot = p_user_name,
        idempotency_key = p_idempotency_key
    where id = v_batch_id
      and user_id = p_user_id;

    if not found then
      raise exception using
        errcode = '23514',
        message = 'The configuration operation movement batch could not be finalized.';
    end if;
  exception
    when unique_violation then
      raise exception using
        errcode = '22023',
        message = 'p_idempotency_key has already been used by another stock operation.';
  end;

  update public.assembly_operations
  set commercial_configuration_code_id = v_commercial_code_id,
      commercial_code_snapshot = v_normalized_commercial_code
  where batch_id = v_batch_id
    and configuration_id = p_configuration_id;

  get diagnostics v_updated_rows = row_count;

  if v_updated_rows <> 1 then
    raise exception using
      errcode = '23514',
      message = 'The configuration operation audit row could not be resolved.';
  end if;

  select movement.quantity_before, movement.quantity_after
  into v_servo_quantity_before, v_servo_quantity_after
  from public.stock_movements as movement
  where movement.batch_id = v_batch_id
    and movement.item_id = v_servo_id;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'The servo stock movement could not be resolved.';
  end if;

  select movement.quantity_before, movement.quantity_after
  into v_kit_quantity_before, v_kit_quantity_after
  from public.stock_movements as movement
  where movement.batch_id = v_batch_id
    and movement.item_id = v_installation_kit_id;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'The installation kit stock movement could not be resolved.';
  end if;

  select movement.quantity_before, movement.quantity_after
  into v_configuration_quantity_before, v_configuration_quantity_after
  from public.configuration_stock_movements as movement
  where movement.batch_id = v_batch_id
    and movement.configuration_id = p_configuration_id;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'The configuration stock movement could not be resolved.';
  end if;

  update private.configuration_operation_requests
  set commercial_configuration_code_id = v_commercial_code_id,
      commercial_code_snapshot = v_normalized_commercial_code,
      movement_batch_id = v_batch_id,
      servo_id = v_servo_id,
      installation_kit_id = v_installation_kit_id,
      servo_quantity_before = v_servo_quantity_before,
      servo_quantity_after = v_servo_quantity_after,
      kit_quantity_before = v_kit_quantity_before,
      kit_quantity_after = v_kit_quantity_after,
      configuration_quantity_before = v_configuration_quantity_before,
      configuration_quantity_after = v_configuration_quantity_after,
      completed_at = now()
  where id = v_request_id;

  return jsonb_build_object(
    'movement_batch_id', v_batch_id,
    'operation_type', p_operation_type,
    'configuration_id', p_configuration_id,
    'commercial_code', v_normalized_commercial_code,
    'quantity', p_quantity,
    'servo_id', v_servo_id,
    'installation_kit_id', v_installation_kit_id,
    'servo_quantity_before', v_servo_quantity_before,
    'servo_quantity_after', v_servo_quantity_after,
    'kit_quantity_before', v_kit_quantity_before,
    'kit_quantity_after', v_kit_quantity_after,
    'configuration_quantity_before', v_configuration_quantity_before,
    'configuration_quantity_after', v_configuration_quantity_after,
    'operation_applied', true
  );
end;
$$;


ALTER FUNCTION "private"."execute_configuration_operation"("p_operation_type" "text", "p_configuration_id" "uuid", "p_quantity" integer, "p_idempotency_key" "uuid", "p_commercial_code" "text", "p_description" "text", "p_user_id" "uuid", "p_user_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."finalize_supplier_order"("p_supplier_order_id" "uuid", "p_expected_updated_at" timestamp with time zone, "p_finalization_note" "text", "p_idempotency_key" "uuid", "p_user_id" "uuid", "p_user_name" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_finalization_note text;
  v_request jsonb;
  v_existing_result jsonb;
  v_result jsonb;
  v_order public.supplier_orders%rowtype;
  v_status text;
  v_waiting_pickup_quantity bigint;
  v_before jsonb;
begin
  if p_supplier_order_id is null
    or p_expected_updated_at is null
    or p_idempotency_key is null then
    raise exception using
      errcode = '22023',
      message = 'Order, expected updated_at, and idempotency key are required.';
  end if;

  v_finalization_note := nullif(btrim(p_finalization_note), '');

  if v_finalization_note is not null
    and char_length(v_finalization_note) > 500 then
    raise exception using
      errcode = '22023',
      message = 'p_finalization_note must contain at most 500 characters.';
  end if;

  v_request := jsonb_build_object(
    'supplier_order_id', p_supplier_order_id,
    'expected_updated_at', p_expected_updated_at,
    'finalization_note', v_finalization_note
  );

  v_existing_result := private.supplier_order_existing_result(
    p_user_id,
    p_idempotency_key,
    'ORDER_FINALIZED',
    v_request
  );

  if v_existing_result is not null then
    return v_existing_result;
  end if;

  select *
  into v_order
  from public.supplier_orders
  where id = p_supplier_order_id
  for update;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'The supplier order does not exist.';
  end if;

  if v_order.cancelled_at is not null then
    raise exception using
      errcode = '22023',
      message = 'A cancelled supplier order cannot be finalized.';
  end if;

  if v_order.finalized_at is not null then
    raise exception using
      errcode = '22023',
      message = 'The supplier order is already finalized.';
  end if;

  if v_order.updated_at is distinct from p_expected_updated_at then
    raise exception using
      errcode = '40001',
      message = 'The supplier order changed after it was loaded. Reload it before finalizing.';
  end if;

  perform 1
  from public.supplier_order_items
  where supplier_order_id = p_supplier_order_id
  order by id
  for update;

  select summary.status, summary.waiting_pickup_quantity
  into v_status, v_waiting_pickup_quantity
  from public.supplier_order_summaries as summary
  where summary.id = p_supplier_order_id;

  if v_status is distinct from 'COMPLETED'
    or v_waiting_pickup_quantity <> 0 then
    raise exception using
      errcode = '22023',
      message = 'Only a completed supplier order with no pickup quantity remaining can be finalized.';
  end if;

  v_before := jsonb_build_object(
    'status', v_status,
    'updated_at', v_order.updated_at,
    'finalized_at', v_order.finalized_at,
    'finalized_by', v_order.finalized_by,
    'finalized_by_name_snapshot',
      v_order.finalized_by_name_snapshot,
    'finalization_note', v_order.finalization_note
  );

  update public.supplier_orders
  set finalized_at = now(),
      finalized_by = p_user_id,
      finalized_by_name_snapshot = btrim(p_user_name),
      finalization_note = v_finalization_note,
      updated_at = now()
  where id = p_supplier_order_id;

  v_result := private.supplier_order_result(p_supplier_order_id);

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
    'ORDER_FINALIZED',
    p_user_id,
    btrim(p_user_name),
    p_idempotency_key,
    v_finalization_note,
    jsonb_build_object(
      'request', v_request,
      'result', v_result,
      'before', v_before,
      'after', jsonb_build_object(
        'status', v_result -> 'status',
        'updated_at', v_result -> 'updated_at',
        'finalized_at', v_result -> 'finalized_at',
        'finalized_by', v_result -> 'finalized_by',
        'finalized_by_name_snapshot',
          v_result -> 'finalized_by_name_snapshot',
        'finalization_note', v_result -> 'finalization_note'
      )
    )
  );

  return v_result;
end;
$$;


ALTER FUNCTION "private"."finalize_supplier_order"("p_supplier_order_id" "uuid", "p_expected_updated_at" timestamp with time zone, "p_finalization_note" "text", "p_idempotency_key" "uuid", "p_user_id" "uuid", "p_user_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."is_active_profile"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and is_active
  );
$$;


ALTER FUNCTION "private"."is_active_profile"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."mark_supplier_order_all_picked"("p_supplier_order_id" "uuid", "p_description" "text", "p_idempotency_key" "uuid", "p_user_id" "uuid", "p_user_name" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_description text;
  v_request jsonb;
  v_existing_result jsonb;
  v_result jsonb;
  v_cancelled_at timestamptz;
  v_changes jsonb;
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

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'supplier_order_item_id', order_item.id,
        'previous_picked_quantity', order_item.picked_quantity,
        'new_picked_quantity',
          order_item.ordered_quantity - order_item.cancelled_quantity
      )
      order by order_item.id
    ),
    '[]'::jsonb
  )
  into v_changes
  from public.supplier_order_items as order_item
  where order_item.supplier_order_id = p_supplier_order_id
    and order_item.picked_quantity
      is distinct from (
        order_item.ordered_quantity - order_item.cancelled_quantity
      );

  update public.supplier_order_items
  set picked_quantity = ordered_quantity - cancelled_quantity
  where supplier_order_id = p_supplier_order_id
    and picked_quantity
      is distinct from ordered_quantity - cancelled_quantity;

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
      'changes', v_changes
    )
  );

  return v_result;
end;
$$;


ALTER FUNCTION "private"."mark_supplier_order_all_picked"("p_supplier_order_id" "uuid", "p_description" "text", "p_idempotency_key" "uuid", "p_user_id" "uuid", "p_user_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."mark_supplier_order_all_picked_checked"("p_supplier_order_id" "uuid", "p_description" "text", "p_expected_order_updated_at" timestamp with time zone, "p_idempotency_key" "uuid", "p_user_id" "uuid", "p_user_name" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_description text;
  v_request jsonb;
  v_existing_result jsonb;
  v_result jsonb;
  v_order public.supplier_orders%rowtype;
  v_added_picked_quantity bigint := 0;
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

  -- Keep the canonical request identical to the existing worker.
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

  -- Preserve the official lock order: parent order, then all lines by UUID.
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

  select coalesce(
    sum(
      order_item.ordered_quantity
        - order_item.cancelled_quantity
        - order_item.picked_quantity
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


ALTER FUNCTION "private"."mark_supplier_order_all_picked_checked"("p_supplier_order_id" "uuid", "p_description" "text", "p_expected_order_updated_at" timestamp with time zone, "p_idempotency_key" "uuid", "p_user_id" "uuid", "p_user_name" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "private"."mark_supplier_order_all_picked_checked"("p_supplier_order_id" "uuid", "p_description" "text", "p_expected_order_updated_at" timestamp with time zone, "p_idempotency_key" "uuid", "p_user_id" "uuid", "p_user_name" "text") IS 'Checks an Assistant mark-all preview token under stable order/line locks, then delegates the atomic update and audit to the existing worker.';



CREATE OR REPLACE FUNCTION "private"."normalize_supplier_order_lines"("p_lines" "jsonb", "p_allow_existing_ids" boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
declare
  v_line jsonb;
  v_normalized jsonb := '[]'::jsonb;
  v_position integer;
  v_kind text;
  v_line_id uuid;
  v_item_id uuid;
  v_configuration_id uuid;
  v_commercial_code_id uuid;
  v_quantity_numeric numeric;
  v_quantity integer;
  v_notes text;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'p_lines must be a JSON array.';
  end if;

  if jsonb_array_length(p_lines) = 0
    or jsonb_array_length(p_lines) > 1000 then
    raise exception using
      errcode = '22023',
      message = 'p_lines must contain between 1 and 1000 lines.';
  end if;

  for v_line, v_position in
    select value, (ordinality - 1)::integer
    from jsonb_array_elements(p_lines) with ordinality
  loop
    if jsonb_typeof(v_line) <> 'object' then
      raise exception using
        errcode = '22023',
        message = format('Line %s must be a JSON object.', v_position + 1);
    end if;

    if exists (
      select 1
      from jsonb_object_keys(v_line) as key_name
      where key_name not in (
        'id',
        'kind',
        'item_id',
        'commercial_configuration_id',
        'commercial_configuration_code_id',
        'quantity',
        'notes'
      )
    ) then
      raise exception using
        errcode = '22023',
        message = format('Line %s contains an unexpected field.', v_position + 1);
    end if;

    if not p_allow_existing_ids and v_line ? 'id' then
      raise exception using
        errcode = '22023',
        message = 'Line IDs cannot be supplied while creating an order.';
    end if;

    begin
      v_line_id := nullif(v_line ->> 'id', '')::uuid;
      v_item_id := nullif(v_line ->> 'item_id', '')::uuid;
      v_configuration_id :=
        nullif(v_line ->> 'commercial_configuration_id', '')::uuid;
      v_commercial_code_id :=
        nullif(v_line ->> 'commercial_configuration_code_id', '')::uuid;
    exception
      when invalid_text_representation then
        raise exception using
          errcode = '22023',
          message = format('Line %s contains an invalid UUID.', v_position + 1);
    end;

    if v_line_id is not null and exists (
      select 1
      from jsonb_array_elements(v_normalized) as previous_line
      where (previous_line ->> 'id')::uuid = v_line_id
    ) then
      raise exception using
        errcode = '22023',
        message = 'The same existing order line cannot appear twice.';
    end if;

    v_kind := v_line ->> 'kind';

    if v_kind = 'ITEM' then
      if v_item_id is null
        or v_configuration_id is not null
        or v_commercial_code_id is not null then
        raise exception using
          errcode = '22023',
          message = format('Line %s has an invalid ITEM target.', v_position + 1);
      end if;
    elsif v_kind = 'COMMERCIAL_CONFIGURATION' then
      if v_item_id is not null or v_configuration_id is null then
        raise exception using
          errcode = '22023',
          message = format(
            'Line %s has an invalid COMMERCIAL_CONFIGURATION target.',
            v_position + 1
          );
      end if;
    else
      raise exception using
        errcode = '22023',
        message = format('Line %s has an invalid kind.', v_position + 1);
    end if;

    if jsonb_typeof(v_line -> 'quantity') is distinct from 'number' then
      raise exception using
        errcode = '22023',
        message = format('Line %s quantity must be an integer.', v_position + 1);
    end if;

    if v_line ? 'notes'
      and jsonb_typeof(v_line -> 'notes') not in ('string', 'null') then
      raise exception using
        errcode = '22023',
        message = format('Line %s notes must be text or null.', v_position + 1);
    end if;

    begin
      v_quantity_numeric := (v_line ->> 'quantity')::numeric;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        raise exception using
          errcode = '22023',
          message = format('Line %s quantity is invalid.', v_position + 1);
    end;

    if v_quantity_numeric <> trunc(v_quantity_numeric)
      or v_quantity_numeric < 1
      or v_quantity_numeric > 2147483647 then
      raise exception using
        errcode = '22023',
        message = format(
          'Line %s quantity must be a positive 32-bit integer.',
          v_position + 1
        );
    end if;

    v_quantity := v_quantity_numeric::integer;
    v_notes := nullif(btrim(v_line ->> 'notes'), '');

    if v_notes is not null and char_length(v_notes) > 1000 then
      raise exception using
        errcode = '22023',
        message = format(
          'Line %s notes must contain at most 1000 characters.',
          v_position + 1
        );
    end if;

    v_normalized := v_normalized || jsonb_build_array(
      jsonb_build_object(
        'id', v_line_id,
        'kind', v_kind,
        'item_id', v_item_id,
        'commercial_configuration_id', v_configuration_id,
        'commercial_configuration_code_id', v_commercial_code_id,
        'quantity', v_quantity,
        'notes', v_notes,
        'position', v_position
      )
    );
  end loop;

  return v_normalized;
end;
$$;


ALTER FUNCTION "private"."normalize_supplier_order_lines"("p_lines" "jsonb", "p_allow_existing_ids" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."normalize_supplier_order_stock_entry_lines"("p_lines" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
declare
  v_line jsonb;
  v_line_number integer := 0;
  v_supplier_order_item_id uuid;
  v_quantity_numeric numeric;
  v_normalized jsonb := '[]'::jsonb;
begin
  if p_lines is null or jsonb_typeof(p_lines) is distinct from 'array' then
    raise exception using
      errcode = '22023',
      message = 'p_lines must be a non-empty JSON array.';
  end if;

  if jsonb_array_length(p_lines) not between 1 and 1000 then
    raise exception using
      errcode = '22023',
      message = 'p_lines must contain between 1 and 1000 lines.';
  end if;

  for v_line in
    select payload.value
    from jsonb_array_elements(p_lines) as payload(value)
  loop
    v_line_number := v_line_number + 1;

    if jsonb_typeof(v_line) is distinct from 'object' then
      raise exception using
        errcode = '22023',
        message = format('p_lines entry %s must be an object.', v_line_number);
    end if;

    if v_line - 'supplier_order_item_id' - 'quantity' <> '{}'::jsonb then
      raise exception using
        errcode = '22023',
        message = format(
          'p_lines entry %s contains unexpected fields.',
          v_line_number
        );
    end if;

    if not (v_line ? 'supplier_order_item_id')
      or jsonb_typeof(
        v_line -> 'supplier_order_item_id'
      ) is distinct from 'string'
      or nullif(btrim(v_line ->> 'supplier_order_item_id'), '') is null then
      raise exception using
        errcode = '22023',
        message = format(
          'p_lines entry %s must contain supplier_order_item_id as a UUID string.',
          v_line_number
        );
    end if;

    begin
      v_supplier_order_item_id :=
        (v_line ->> 'supplier_order_item_id')::uuid;
    exception
      when invalid_text_representation then
        raise exception using
          errcode = '22023',
          message = format(
            'p_lines entry %s contains an invalid supplier_order_item_id UUID.',
            v_line_number
          );
    end;

    if exists (
      select 1
      from jsonb_array_elements(v_normalized) as existing_line
      where (existing_line ->> 'supplier_order_item_id')::uuid
        = v_supplier_order_item_id
    ) then
      raise exception using
        errcode = '22023',
        message = 'The same supplier-order line cannot appear twice.';
    end if;

    if not (v_line ? 'quantity')
      or jsonb_typeof(v_line -> 'quantity') is distinct from 'number' then
      raise exception using
        errcode = '22023',
        message = format(
          'p_lines entry %s must contain quantity as an integer.',
          v_line_number
        );
    end if;

    begin
      v_quantity_numeric := (v_line ->> 'quantity')::numeric;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        raise exception using
          errcode = '22023',
          message = format(
            'p_lines entry %s contains an invalid quantity.',
            v_line_number
          );
    end;

    if v_quantity_numeric <> trunc(v_quantity_numeric)
      or v_quantity_numeric < 1
      or v_quantity_numeric > 2147483647 then
      raise exception using
        errcode = '22023',
        message = format(
          'p_lines entry %s quantity must be a positive 32-bit integer.',
          v_line_number
        );
    end if;

    v_normalized := v_normalized || jsonb_build_array(
      jsonb_build_object(
        'supplier_order_item_id',
        v_supplier_order_item_id,
        'quantity',
        v_quantity_numeric::integer
      )
    );
  end loop;

  select jsonb_agg(line.value order by line.value ->> 'supplier_order_item_id')
  into v_normalized
  from jsonb_array_elements(v_normalized) as line(value);

  return v_normalized;
end;
$$;


ALTER FUNCTION "private"."normalize_supplier_order_stock_entry_lines"("p_lines" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."protect_supplier_order_commercial_code_links"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if exists (
    select 1
    from public.supplier_order_items as order_item
    where order_item.commercial_configuration_code_id = new.id
      and order_item.commercial_configuration_id <> new.configuration_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'A commercial code used by a supplier order cannot be moved to another physical configuration.';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "private"."protect_supplier_order_commercial_code_links"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."require_supplier_order_user"() RETURNS TABLE("user_id" "uuid", "user_name" "text")
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception using
      errcode = '28000',
      message = 'An authenticated user is required.';
  end if;

  return query
  select
    profile.id,
    btrim(profile.name)
  from public.profiles as profile
  where profile.id = v_user_id
    and profile.is_active
    and nullif(btrim(profile.name), '') is not null
  for share;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'The authenticated user requires an active profile with a registered name.';
  end if;
end;
$$;


ALTER FUNCTION "private"."require_supplier_order_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."set_configuration_minimum_stock"("p_configuration_id" "uuid", "p_minimum_stock" integer, "p_user_id" "uuid", "p_user_name" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_previous_minimum_stock integer;
  v_change_id uuid;
begin
  if p_user_id is null then
    raise exception using
      errcode = '22023',
      message = 'p_user_id is required to change configuration minimum stock.';
  end if;

  if p_minimum_stock is null or p_minimum_stock < 0 then
    raise exception using
      errcode = '22023',
      message = 'p_minimum_stock must be a non-negative PostgreSQL integer.';
  end if;

  select configuration.minimum_stock
  into v_previous_minimum_stock
  from public.commercial_configurations as configuration
  where configuration.id = p_configuration_id
  for update;

  if not found then
    raise exception using
      errcode = '22023',
      message = format(
        'Commercial configuration %s does not exist.',
        p_configuration_id
      );
  end if;

  if v_previous_minimum_stock = p_minimum_stock then
    return jsonb_build_object(
      'change_applied', false,
      'change_id', null,
      'previous_minimum_stock', v_previous_minimum_stock,
      'new_minimum_stock', p_minimum_stock
    );
  end if;

  update public.commercial_configurations
  set minimum_stock = p_minimum_stock,
      updated_at = now()
  where id = p_configuration_id;

  insert into public.configuration_minimum_stock_changes (
    configuration_id,
    previous_minimum_stock,
    new_minimum_stock,
    user_id,
    user_name_snapshot
  )
  values (
    p_configuration_id,
    v_previous_minimum_stock,
    p_minimum_stock,
    p_user_id,
    p_user_name
  )
  returning id into v_change_id;

  return jsonb_build_object(
    'change_applied', true,
    'change_id', v_change_id,
    'previous_minimum_stock', v_previous_minimum_stock,
    'new_minimum_stock', p_minimum_stock
  );
end;
$$;


ALTER FUNCTION "private"."set_configuration_minimum_stock"("p_configuration_id" "uuid", "p_minimum_stock" integer, "p_user_id" "uuid", "p_user_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."set_item_minimum_stock"("p_item_id" "uuid", "p_minimum_stock" integer, "p_user_id" "uuid", "p_user_name" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_item_type text;
  v_previous_minimum_stock integer;
  v_change_id uuid;
begin
  if p_user_id is null then
    raise exception using
      errcode = '22023',
      message = 'p_user_id is required to change minimum stock.';
  end if;

  if p_minimum_stock is null or p_minimum_stock < 0 then
    raise exception using
      errcode = '22023',
      message = 'p_minimum_stock must be a non-negative PostgreSQL integer.';
  end if;

  select item.item_type, item.minimum_stock
  into v_item_type, v_previous_minimum_stock
  from public.items as item
  where item.id = p_item_id
  for update;

  if not found then
    raise exception using
      errcode = '22023',
      message = format('Item %s does not exist.', p_item_id);
  end if;

  if v_item_type not in (
    'SERVO',
    'INSTALLATION_KIT',
    'REPAIR_KIT',
    'LOOSE_PART'
  ) then
    raise exception using
      errcode = '22023',
      message = format(
        'Item %s has unsupported item_type %s.',
        p_item_id,
        v_item_type
      );
  end if;

  if v_previous_minimum_stock = p_minimum_stock then
    return jsonb_build_object(
      'change_applied', false,
      'change_id', null,
      'previous_minimum_stock', v_previous_minimum_stock,
      'new_minimum_stock', p_minimum_stock
    );
  end if;

  update public.items
  set minimum_stock = p_minimum_stock,
      updated_at = now()
  where id = p_item_id;

  insert into public.minimum_stock_changes (
    item_id,
    previous_minimum_stock,
    new_minimum_stock,
    user_id,
    user_name_snapshot
  )
  values (
    p_item_id,
    v_previous_minimum_stock,
    p_minimum_stock,
    p_user_id,
    p_user_name
  )
  returning id into v_change_id;

  return jsonb_build_object(
    'change_applied', true,
    'change_id', v_change_id,
    'previous_minimum_stock', v_previous_minimum_stock,
    'new_minimum_stock', p_minimum_stock
  );
end;
$$;


ALTER FUNCTION "private"."set_item_minimum_stock"("p_item_id" "uuid", "p_minimum_stock" integer, "p_user_id" "uuid", "p_user_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."set_supplier_order_item_picked_quantity"("p_supplier_order_item_id" "uuid", "p_picked_quantity" integer, "p_description" "text", "p_idempotency_key" "uuid", "p_user_id" "uuid", "p_user_name" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
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

  v_previous_quantity := v_line.picked_quantity;

  update public.supplier_order_items
  set picked_quantity = p_picked_quantity
  where id = p_supplier_order_item_id;

  update public.supplier_orders
  set updated_at = now()
  where id = v_order_id;

  v_result := private.supplier_order_result(v_order_id)
    || jsonb_build_object(
      'supplier_order_item_id', p_supplier_order_item_id,
      'previous_picked_quantity', v_previous_quantity,
      'new_picked_quantity', p_picked_quantity,
      'picked_quantity_delta', p_picked_quantity - v_previous_quantity
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


ALTER FUNCTION "private"."set_supplier_order_item_picked_quantity"("p_supplier_order_item_id" "uuid", "p_picked_quantity" integer, "p_description" "text", "p_idempotency_key" "uuid", "p_user_id" "uuid", "p_user_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."set_supplier_order_item_picked_quantity_checked"("p_supplier_order_item_id" "uuid", "p_target_picked_quantity" integer, "p_description" "text", "p_expected_order_updated_at" timestamp with time zone, "p_idempotency_key" "uuid", "p_user_id" "uuid", "p_user_name" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_description text;
  v_request jsonb;
  v_existing_result jsonb;
  v_result jsonb;
  v_order public.supplier_orders%rowtype;
  v_line public.supplier_order_items%rowtype;
begin
  if p_supplier_order_item_id is null
    or p_target_picked_quantity is null
    or p_target_picked_quantity < 0
    or p_expected_order_updated_at is null
    or p_idempotency_key is null
    or p_user_id is null
    or nullif(btrim(p_user_name), '') is null then
    raise exception using
      errcode = '22023',
      message = 'Line, nonnegative target, expected order version, idempotency key, and authenticated user are required.';
  end if;

  v_description := nullif(btrim(p_description), '');

  if v_description is not null and char_length(v_description) > 2000 then
    raise exception using
      errcode = '22023',
      message = 'p_description must contain at most 2000 characters.';
  end if;

  -- Keep the canonical request identical to the existing worker so its
  -- immutable event remains the single idempotency ledger.
  v_request := jsonb_build_object(
    'supplier_order_item_id', p_supplier_order_item_id,
    'picked_quantity', p_target_picked_quantity,
    'description', v_description
  );

  -- The helper acquires the per-user/key advisory transaction lock first.
  -- An identical replay returns before checking the now-stale preview token.
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

  -- Preserve the official lock order: parent order, then affected line.
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

  -- This comparison is inside the same transaction, after every required
  -- row lock, and before the delegated worker can write anything.
  if v_order.updated_at is distinct from p_expected_order_updated_at then
    raise exception using
      errcode = '40001',
      message = 'supplier_order_version_conflict';
  end if;

  v_result := private.set_supplier_order_item_picked_quantity(
    p_supplier_order_item_id,
    p_target_picked_quantity,
    v_description,
    p_idempotency_key,
    p_user_id,
    btrim(p_user_name)
  );

  return v_result || jsonb_build_object('idempotent_replay', false);
end;
$$;


ALTER FUNCTION "private"."set_supplier_order_item_picked_quantity_checked"("p_supplier_order_item_id" "uuid", "p_target_picked_quantity" integer, "p_description" "text", "p_expected_order_updated_at" timestamp with time zone, "p_idempotency_key" "uuid", "p_user_id" "uuid", "p_user_name" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "private"."set_supplier_order_item_picked_quantity_checked"("p_supplier_order_item_id" "uuid", "p_target_picked_quantity" integer, "p_description" "text", "p_expected_order_updated_at" timestamp with time zone, "p_idempotency_key" "uuid", "p_user_id" "uuid", "p_user_name" "text") IS 'Checks an Assistant pickup preview token under the official order/line locks, then delegates the absolute quantity and audit to the existing worker.';



CREATE OR REPLACE FUNCTION "private"."set_supplier_order_item_snapshots"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_snapshot record;
begin
  select *
  into v_snapshot
  from private.supplier_order_catalog_snapshot(
    new.item_id,
    new.commercial_configuration_id,
    new.commercial_configuration_code_id,
    true
  );

  new.code_snapshot := v_snapshot.code_snapshot;
  new.description_snapshot := v_snapshot.description_snapshot;
  new.model_snapshot := v_snapshot.model_snapshot;
  new.item_type_snapshot := v_snapshot.item_type_snapshot;
  new.commercial_code_snapshot := v_snapshot.commercial_code_snapshot;
  new.updated_at := now();

  return new;
end;
$$;


ALTER FUNCTION "private"."set_supplier_order_item_snapshots"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."stock_inbound_item"("p_item_id" "uuid", "p_quantity" integer, "p_user_id" "uuid", "p_source" "text", "p_description" "text") RETURNS "uuid"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_batch_id uuid;
  v_quantity_before integer;
  v_quantity_after integer;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception using
      errcode = '22023',
      message = 'p_quantity must be greater than zero.';
  end if;

  if p_source is null
    or p_source not in ('MANUAL', 'AI_CHAT', 'ORDER_PHOTO') then
    raise exception using
      errcode = '22023',
      message = 'p_source must be MANUAL, AI_CHAT, or ORDER_PHOTO.';
  end if;

  perform 1
  from public.items
  where id = p_item_id
    and is_active
  for share;

  if not found then
    raise exception using
      errcode = '22023',
      message = format('Item %s does not exist or is inactive.', p_item_id);
  end if;

  insert into public.stock_balances (item_id, quantity)
  values (p_item_id, 0)
  on conflict (item_id) do nothing;

  select quantity
  into v_quantity_before
  from public.stock_balances
  where item_id = p_item_id
  for update;

  v_quantity_after := v_quantity_before + p_quantity;

  insert into public.movement_batches (
    movement_type,
    source,
    user_id,
    description
  )
  values (
    'INBOUND',
    p_source,
    p_user_id,
    p_description
  )
  returning id into v_batch_id;

  update public.stock_balances
  set quantity = v_quantity_after,
      updated_at = now()
  where item_id = p_item_id;

  insert into public.stock_movements (
    batch_id,
    item_id,
    quantity_change,
    quantity_before,
    quantity_after
  )
  values (
    v_batch_id,
    p_item_id,
    p_quantity,
    v_quantity_before,
    v_quantity_after
  );

  return v_batch_id;
end;
$$;


ALTER FUNCTION "private"."stock_inbound_item"("p_item_id" "uuid", "p_quantity" integer, "p_user_id" "uuid", "p_source" "text", "p_description" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."stock_inbound_items"("p_items" "jsonb", "p_idempotency_key" "uuid", "p_user_id" "uuid", "p_user_name" "text", "p_description" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_batch_id uuid;
  v_normalized_items jsonb;
  v_existing_normalized_items jsonb;
  v_payload_item jsonb;
  v_payload_index integer := 0;
  v_payload_item_id uuid;
  v_payload_quantity numeric;
  v_item_type text;
  v_item_is_active boolean;
  v_existing_movement_type text;
  v_existing_source text;
  v_existing_description text;
  v_items_processed integer;
  v_existing_items_processed integer;
  v_total_quantity numeric;
  v_existing_total_quantity numeric;
  v_locked_balances integer := 0;
  v_balance record;
  v_quantity_after integer;
begin
  if p_user_id is null then
    raise exception using
      errcode = '22023',
      message = 'p_user_id is required for a batch stock inbound.';
  end if;

  if p_idempotency_key is null then
    raise exception using
      errcode = '22023',
      message = 'p_idempotency_key is required for a batch stock inbound.';
  end if;

  if p_items is null
    or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception using
      errcode = '22023',
      message = 'p_items must be a non-empty JSON array.';
  end if;

  if jsonb_array_length(p_items) = 0 then
    raise exception using
      errcode = '22023',
      message = 'p_items must contain at least one item.';
  end if;

  for v_payload_item in
    select payload_item.value
    from jsonb_array_elements(p_items) as payload_item(value)
  loop
    v_payload_index := v_payload_index + 1;

    if jsonb_typeof(v_payload_item) is distinct from 'object' then
      raise exception using
        errcode = '22023',
        message = format(
          'p_items entry %s must be a JSON object.',
          v_payload_index
        );
    end if;

    if not (v_payload_item ? 'item_id')
      or jsonb_typeof(v_payload_item -> 'item_id') is distinct from 'string'
      or nullif(btrim(v_payload_item ->> 'item_id'), '') is null then
      raise exception using
        errcode = '22023',
        message = format(
          'p_items entry %s must contain item_id as a UUID string.',
          v_payload_index
        );
    end if;

    begin
      v_payload_item_id := (v_payload_item ->> 'item_id')::uuid;
    exception
      when invalid_text_representation then
        raise exception using
          errcode = '22023',
          message = format(
            'p_items entry %s contains an invalid item_id UUID.',
            v_payload_index
          );
    end;

    if not (v_payload_item ? 'quantity')
      or jsonb_typeof(v_payload_item -> 'quantity') is distinct from 'number' then
      raise exception using
        errcode = '22023',
        message = format(
          'p_items entry %s must contain quantity as an integer greater than zero.',
          v_payload_index
        );
    end if;

    v_payload_quantity := (v_payload_item ->> 'quantity')::numeric;

    if v_payload_quantity <> trunc(v_payload_quantity)
      or v_payload_quantity <= 0
      or v_payload_quantity > 2147483647 then
      raise exception using
        errcode = '22023',
        message = format(
          'p_items entry %s must contain quantity as an integer greater than zero within the PostgreSQL integer range.',
          v_payload_index
        );
    end if;
  end loop;

  if exists (
    select 1
    from (
      select
        (payload_item.value ->> 'item_id')::uuid as item_id,
        sum((payload_item.value ->> 'quantity')::numeric) as quantity
      from jsonb_array_elements(p_items) as payload_item(value)
      group by (payload_item.value ->> 'item_id')::uuid
    ) as grouped_item
    where grouped_item.quantity > 2147483647
  ) then
    raise exception using
      errcode = '22003',
      message = 'The consolidated quantity for an item exceeds the PostgreSQL integer range.';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'item_id', grouped_item.item_id,
      'quantity', grouped_item.quantity::integer
    )
    order by grouped_item.item_id
  )
  into v_normalized_items
  from (
    select
      (payload_item.value ->> 'item_id')::uuid as item_id,
      sum((payload_item.value ->> 'quantity')::numeric) as quantity
    from jsonb_array_elements(p_items) as payload_item(value)
    group by (payload_item.value ->> 'item_id')::uuid
  ) as grouped_item;

  v_items_processed := jsonb_array_length(v_normalized_items);

  select coalesce(sum(normalized_item.quantity::numeric), 0)
  into v_total_quantity
  from jsonb_to_recordset(v_normalized_items) as normalized_item(
    item_id uuid,
    quantity integer
  );

  -- The unique partial index is the concurrency boundary. A concurrent call
  -- with the same user and key waits here until the winning transaction ends.
  insert into public.movement_batches (
    movement_type,
    source,
    user_id,
    user_name_snapshot,
    description,
    idempotency_key
  )
  values (
    'INBOUND',
    'MANUAL',
    p_user_id,
    p_user_name,
    p_description,
    p_idempotency_key
  )
  on conflict (user_id, idempotency_key)
    where idempotency_key is not null
  do nothing
  returning id into v_batch_id;

  if not found then
    select
      batch.id,
      batch.movement_type,
      batch.source,
      batch.description
    into
      v_batch_id,
      v_existing_movement_type,
      v_existing_source,
      v_existing_description
    from public.movement_batches as batch
    where batch.user_id = p_user_id
      and batch.idempotency_key = p_idempotency_key
    for share;

    if not found then
      raise exception using
        errcode = '23505',
        message = 'The existing movement batch for p_idempotency_key could not be resolved.';
    end if;

    select
      jsonb_agg(
        jsonb_build_object(
          'item_id', movement.item_id,
          'quantity', movement.quantity_change
        )
        order by movement.item_id
      ),
      count(*)::integer,
      coalesce(sum(movement.quantity_change::numeric), 0)
    into
      v_existing_normalized_items,
      v_existing_items_processed,
      v_existing_total_quantity
    from public.stock_movements as movement
    where movement.batch_id = v_batch_id;

    if v_existing_movement_type is distinct from 'INBOUND'
      or v_existing_source is distinct from 'MANUAL'
      or v_existing_description is distinct from p_description
      or v_existing_normalized_items is distinct from v_normalized_items then
      raise exception using
        errcode = '22023',
        message = 'p_idempotency_key has already been used with a different batch stock inbound request.';
    end if;

    return jsonb_build_object(
      'movement_batch_id', v_batch_id,
      'items_processed', v_existing_items_processed,
      'total_quantity', v_existing_total_quantity
    );
  end if;

  -- Validate and lock catalog rows in a deterministic order so their active
  -- state and physical item type cannot change during the operation.
  for v_payload_item_id in
    select normalized_item.item_id
    from jsonb_to_recordset(v_normalized_items) as normalized_item(
      item_id uuid,
      quantity integer
    )
    order by normalized_item.item_id
  loop
    select item.item_type, item.is_active
    into v_item_type, v_item_is_active
    from public.items as item
    where item.id = v_payload_item_id
    for share;

    if not found then
      raise exception using
        errcode = '22023',
        message = format('Item %s does not exist.', v_payload_item_id);
    end if;

    if not v_item_is_active then
      raise exception using
        errcode = '22023',
        message = format('Item %s is inactive.', v_payload_item_id);
    end if;

    if v_item_type not in (
      'SERVO',
      'INSTALLATION_KIT',
      'REPAIR_KIT',
      'LOOSE_PART'
    ) then
      raise exception using
        errcode = '22023',
        message = format(
          'Item %s has unsupported item_type %s.',
          v_payload_item_id,
          v_item_type
        );
    end if;
  end loop;

  insert into public.stock_balances (item_id, quantity)
  select normalized_item.item_id, 0
  from jsonb_to_recordset(v_normalized_items) as normalized_item(
    item_id uuid,
    quantity integer
  )
  order by normalized_item.item_id
  on conflict (item_id) do nothing;

  for v_balance in
    select
      balance.item_id,
      balance.quantity as quantity_before,
      normalized_item.quantity as quantity_change
    from public.stock_balances as balance
    join jsonb_to_recordset(v_normalized_items) as normalized_item(
      item_id uuid,
      quantity integer
    ) on normalized_item.item_id = balance.item_id
    order by balance.item_id
    for update of balance
  loop
    v_locked_balances := v_locked_balances + 1;

    if v_balance.quantity_before::bigint
      + v_balance.quantity_change::bigint > 2147483647 then
      raise exception using
        errcode = '22003',
        message = format(
          'Inbound quantity would exceed the PostgreSQL integer range for item %s.',
          v_balance.item_id
        );
    end if;
  end loop;

  if v_locked_balances <> v_items_processed then
    raise exception using
      errcode = '23514',
      message = 'Could not lock every stock balance required by the batch inbound.';
  end if;

  for v_balance in
    select
      balance.item_id,
      balance.quantity as quantity_before,
      normalized_item.quantity as quantity_change
    from public.stock_balances as balance
    join jsonb_to_recordset(v_normalized_items) as normalized_item(
      item_id uuid,
      quantity integer
    ) on normalized_item.item_id = balance.item_id
    order by balance.item_id
  loop
    v_quantity_after := (
      v_balance.quantity_before::bigint
      + v_balance.quantity_change::bigint
    )::integer;

    update public.stock_balances
    set quantity = v_quantity_after,
        updated_at = now()
    where item_id = v_balance.item_id;

    insert into public.stock_movements (
      batch_id,
      item_id,
      quantity_change,
      quantity_before,
      quantity_after
    )
    values (
      v_batch_id,
      v_balance.item_id,
      v_balance.quantity_change,
      v_balance.quantity_before,
      v_quantity_after
    );
  end loop;

  return jsonb_build_object(
    'movement_batch_id', v_batch_id,
    'items_processed', v_items_processed,
    'total_quantity', v_total_quantity
  );
end;
$$;


ALTER FUNCTION "private"."stock_inbound_items"("p_items" "jsonb", "p_idempotency_key" "uuid", "p_user_id" "uuid", "p_user_name" "text", "p_description" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."stock_inbound_lines"("p_lines" "jsonb", "p_idempotency_key" "uuid", "p_user_id" "uuid", "p_user_name" "text", "p_description" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_batch_id uuid;
  v_normalized_lines jsonb;
  v_existing_normalized_lines jsonb;
  v_payload_line jsonb;
  v_payload_index integer := 0;
  v_payload_kind text;
  v_payload_identifier uuid;
  v_payload_quantity numeric;
  v_existing_movement_type text;
  v_existing_source text;
  v_existing_description text;
  v_lines_processed integer;
  v_existing_lines_processed integer;
  v_total_quantity numeric;
  v_existing_total_quantity numeric;
  v_commercial_quantity numeric;
  v_existing_commercial_quantity numeric;
  v_configuration_id uuid;
  v_servo_id uuid;
  v_installation_kit_id uuid;
  v_item_type text;
  v_catalog_is_active boolean;
  v_commercial_code text;
  v_required_configurations integer;
  v_locked_configurations integer := 0;
  v_required_items integer;
  v_locked_items integer := 0;
  v_inserted_audit_lines integer := 0;
  v_quantity_after integer;
  v_record record;
begin
  if p_user_id is null then
    raise exception using
      errcode = '22023',
      message = 'p_user_id is required for a batch stock inbound.';
  end if;

  if p_idempotency_key is null then
    raise exception using
      errcode = '22023',
      message = 'p_idempotency_key is required for a batch stock inbound.';
  end if;

  if p_lines is null
    or jsonb_typeof(p_lines) is distinct from 'array' then
    raise exception using
      errcode = '22023',
      message = 'p_lines must be a non-empty JSON array.';
  end if;

  if jsonb_array_length(p_lines) = 0 then
    raise exception using
      errcode = '22023',
      message = 'p_lines must contain at least one line.';
  end if;

  if jsonb_array_length(p_lines) > 500 then
    raise exception using
      errcode = '22023',
      message = 'p_lines must contain at most 500 lines.';
  end if;

  for v_payload_line in
    select payload_line.value
    from jsonb_array_elements(p_lines) as payload_line(value)
  loop
    v_payload_index := v_payload_index + 1;

    if jsonb_typeof(v_payload_line) is distinct from 'object' then
      raise exception using
        errcode = '22023',
        message = format(
          'p_lines entry %s must be a JSON object.',
          v_payload_index
        );
    end if;

    if not (v_payload_line ? 'kind')
      or jsonb_typeof(v_payload_line -> 'kind') is distinct from 'string' then
      raise exception using
        errcode = '22023',
        message = format(
          'p_lines entry %s must contain kind as a string.',
          v_payload_index
        );
    end if;

    v_payload_kind := v_payload_line ->> 'kind';

    if v_payload_kind not in ('ITEM', 'COMMERCIAL_CODE') then
      raise exception using
        errcode = '22023',
        message = format(
          'p_lines entry %s kind must be ITEM or COMMERCIAL_CODE.',
          v_payload_index
        );
    end if;

    if v_payload_kind = 'ITEM' then
      if v_payload_line - 'kind' - 'item_id' - 'quantity'
        <> '{}'::jsonb then
        raise exception using
          errcode = '22023',
          message = format(
            'p_lines entry %s contains unexpected fields for kind ITEM.',
            v_payload_index
          );
      end if;

      if not (v_payload_line ? 'item_id')
        or jsonb_typeof(v_payload_line -> 'item_id') is distinct from 'string'
        or nullif(btrim(v_payload_line ->> 'item_id'), '') is null then
        raise exception using
          errcode = '22023',
          message = format(
            'p_lines entry %s must contain item_id as a UUID string.',
            v_payload_index
          );
      end if;

      begin
        v_payload_identifier := (v_payload_line ->> 'item_id')::uuid;
      exception
        when invalid_text_representation then
          raise exception using
            errcode = '22023',
            message = format(
              'p_lines entry %s contains an invalid item_id UUID.',
              v_payload_index
            );
      end;
    else
      if v_payload_line - 'kind' - 'commercial_code_id' - 'quantity'
        <> '{}'::jsonb then
        raise exception using
          errcode = '22023',
          message = format(
            'p_lines entry %s contains unexpected fields for kind COMMERCIAL_CODE.',
            v_payload_index
          );
      end if;

      if not (v_payload_line ? 'commercial_code_id')
        or jsonb_typeof(
          v_payload_line -> 'commercial_code_id'
        ) is distinct from 'string'
        or nullif(
          btrim(v_payload_line ->> 'commercial_code_id'),
          ''
        ) is null then
        raise exception using
          errcode = '22023',
          message = format(
            'p_lines entry %s must contain commercial_code_id as a UUID string.',
            v_payload_index
          );
      end if;

      begin
        v_payload_identifier :=
          (v_payload_line ->> 'commercial_code_id')::uuid;
      exception
        when invalid_text_representation then
          raise exception using
            errcode = '22023',
            message = format(
              'p_lines entry %s contains an invalid commercial_code_id UUID.',
              v_payload_index
            );
      end;
    end if;

    if not (v_payload_line ? 'quantity')
      or jsonb_typeof(v_payload_line -> 'quantity') is distinct from 'number' then
      raise exception using
        errcode = '22023',
        message = format(
          'p_lines entry %s must contain quantity as an integer greater than zero.',
          v_payload_index
        );
    end if;

    v_payload_quantity := (v_payload_line ->> 'quantity')::numeric;

    if v_payload_quantity <> trunc(v_payload_quantity)
      or v_payload_quantity <= 0
      or v_payload_quantity > 2147483647 then
      raise exception using
        errcode = '22023',
        message = format(
          'p_lines entry %s must contain quantity as an integer greater than zero within the PostgreSQL integer range.',
          v_payload_index
        );
    end if;
  end loop;

  if exists (
    with parsed_lines as (
      select
        payload_line.value ->> 'kind' as kind,
        case payload_line.value ->> 'kind'
          when 'ITEM'
            then (payload_line.value ->> 'item_id')::uuid
          else (payload_line.value ->> 'commercial_code_id')::uuid
        end as identifier,
        (payload_line.value ->> 'quantity')::numeric as quantity
      from jsonb_array_elements(p_lines) as payload_line(value)
    )
    select 1
    from parsed_lines
    group by kind, identifier
    having sum(quantity) > 2147483647
  ) then
    raise exception using
      errcode = '22003',
      message = 'The consolidated quantity for an inbound line exceeds the PostgreSQL integer range.';
  end if;

  with parsed_lines as (
    select
      payload_line.value ->> 'kind' as kind,
      case payload_line.value ->> 'kind'
        when 'ITEM'
          then (payload_line.value ->> 'item_id')::uuid
        else (payload_line.value ->> 'commercial_code_id')::uuid
      end as identifier,
      (payload_line.value ->> 'quantity')::numeric as quantity
    from jsonb_array_elements(p_lines) as payload_line(value)
  ),
  grouped_lines as (
    select kind, identifier, sum(quantity)::integer as quantity
    from parsed_lines
    group by kind, identifier
  )
  select jsonb_agg(
    case grouped_line.kind
      when 'ITEM' then jsonb_build_object(
        'kind',
        'ITEM',
        'item_id',
        grouped_line.identifier,
        'quantity',
        grouped_line.quantity
      )
      else jsonb_build_object(
        'kind',
        'COMMERCIAL_CODE',
        'commercial_code_id',
        grouped_line.identifier,
        'quantity',
        grouped_line.quantity
      )
    end
    order by grouped_line.kind, grouped_line.identifier
  )
  into v_normalized_lines
  from grouped_lines as grouped_line;

  v_lines_processed := jsonb_array_length(v_normalized_lines);

  select
    coalesce(sum(normalized_line.quantity::numeric), 0),
    coalesce(
      sum(normalized_line.quantity::numeric)
        filter (where normalized_line.kind = 'COMMERCIAL_CODE'),
      0
    )
  into v_total_quantity, v_commercial_quantity
  from jsonb_to_recordset(v_normalized_lines) as normalized_line(
    kind text,
    item_id uuid,
    commercial_code_id uuid,
    quantity integer
  );

  -- The existing partial unique index is the concurrency boundary. A
  -- concurrent retry waits here and then reads the winning transaction.
  insert into public.movement_batches (
    movement_type,
    source,
    user_id,
    user_name_snapshot,
    description,
    idempotency_key
  )
  values (
    'INBOUND',
    'MANUAL',
    p_user_id,
    p_user_name,
    p_description,
    p_idempotency_key
  )
  on conflict (user_id, idempotency_key)
    where idempotency_key is not null
  do nothing
  returning id into v_batch_id;

  if not found then
    select
      batch.id,
      batch.movement_type,
      batch.source,
      batch.description
    into
      v_batch_id,
      v_existing_movement_type,
      v_existing_source,
      v_existing_description
    from public.movement_batches as batch
    where batch.user_id = p_user_id
      and batch.idempotency_key = p_idempotency_key
    for share;

    if not found then
      raise exception using
        errcode = '23505',
        message = 'The existing movement batch for p_idempotency_key could not be resolved.';
    end if;

    select
      jsonb_agg(
        case
          when inbound_line.item_id is not null then jsonb_build_object(
            'kind',
            'ITEM',
            'item_id',
            inbound_line.item_id,
            'quantity',
            inbound_line.quantity
          )
          else jsonb_build_object(
            'kind',
            'COMMERCIAL_CODE',
            'commercial_code_id',
            inbound_line.commercial_configuration_code_id,
            'quantity',
            inbound_line.quantity
          )
        end
        order by
          case
            when inbound_line.item_id is not null
              then 'ITEM'
            else 'COMMERCIAL_CODE'
          end,
          coalesce(
            inbound_line.item_id,
            inbound_line.commercial_configuration_code_id
          )
      ),
      count(*)::integer,
      coalesce(sum(inbound_line.quantity::numeric), 0),
      coalesce(
        sum(inbound_line.quantity::numeric)
          filter (
            where inbound_line.commercial_configuration_code_id is not null
          ),
        0
      )
    into
      v_existing_normalized_lines,
      v_existing_lines_processed,
      v_existing_total_quantity,
      v_existing_commercial_quantity
    from public.inbound_batch_lines as inbound_line
    where inbound_line.batch_id = v_batch_id;

    if v_existing_movement_type is distinct from 'INBOUND'
      or v_existing_source is distinct from 'MANUAL'
      or v_existing_description is distinct from p_description
      or v_existing_normalized_lines is distinct from v_normalized_lines then
      raise exception using
        errcode = '22023',
        message = 'p_idempotency_key has already been used with a different batch stock inbound request.';
    end if;

    return jsonb_build_object(
      'movement_batch_id',
      v_batch_id,
      'lines_processed',
      v_existing_lines_processed,
      'total_quantity',
      v_existing_total_quantity,
      'commercial_quantity',
      v_existing_commercial_quantity
    );
  end if;

  -- Lock commercial codes first so aliases and their configuration mappings
  -- cannot change during the operation.
  for v_record in
    select normalized_line.commercial_code_id
    from jsonb_to_recordset(v_normalized_lines) as normalized_line(
      kind text,
      item_id uuid,
      commercial_code_id uuid,
      quantity integer
    )
    where normalized_line.kind = 'COMMERCIAL_CODE'
    order by normalized_line.commercial_code_id
  loop
    select
      commercial_code.configuration_id,
      commercial_code.code,
      commercial_code.is_active
    into
      v_configuration_id,
      v_commercial_code,
      v_catalog_is_active
    from public.commercial_configuration_codes as commercial_code
    where commercial_code.id = v_record.commercial_code_id
    for share;

    if not found then
      raise exception using
        errcode = '22023',
        message = format(
          'Commercial code %s does not exist.',
          v_record.commercial_code_id
        );
    end if;

    if not v_catalog_is_active then
      raise exception using
        errcode = '22023',
        message = format(
          'Commercial code %s is inactive.',
          v_commercial_code
        );
    end if;
  end loop;

  for v_record in
    select distinct commercial_code.configuration_id
    from jsonb_to_recordset(v_normalized_lines) as normalized_line(
      kind text,
      item_id uuid,
      commercial_code_id uuid,
      quantity integer
    )
    join public.commercial_configuration_codes as commercial_code
      on commercial_code.id = normalized_line.commercial_code_id
    where normalized_line.kind = 'COMMERCIAL_CODE'
    order by commercial_code.configuration_id
  loop
    select
      configuration.servo_id,
      configuration.installation_kit_id,
      configuration.is_active
    into
      v_servo_id,
      v_installation_kit_id,
      v_catalog_is_active
    from public.commercial_configurations as configuration
    where configuration.id = v_record.configuration_id
    for share;

    if not found then
      raise exception using
        errcode = '22023',
        message = format(
          'Commercial configuration %s does not exist.',
          v_record.configuration_id
        );
    end if;

    if not v_catalog_is_active then
      raise exception using
        errcode = '22023',
        message = format(
          'Commercial configuration %s is inactive.',
          v_record.configuration_id
        );
    end if;
  end loop;

  -- Lock direct physical items and commercial configuration components in
  -- one deterministic item_id order.
  for v_record in
    with normalized_lines as (
      select *
      from jsonb_to_recordset(v_normalized_lines) as normalized_line(
        kind text,
        item_id uuid,
        commercial_code_id uuid,
        quantity integer
      )
    ),
    required_item_roles as (
      select
        normalized_line.item_id,
        true as directly_requested,
        false as required_as_servo,
        false as required_as_installation_kit
      from normalized_lines as normalized_line
      where normalized_line.kind = 'ITEM'
      union all
      select
        configuration.servo_id,
        false,
        true,
        false
      from normalized_lines as normalized_line
      join public.commercial_configuration_codes as commercial_code
        on commercial_code.id = normalized_line.commercial_code_id
      join public.commercial_configurations as configuration
        on configuration.id = commercial_code.configuration_id
      where normalized_line.kind = 'COMMERCIAL_CODE'
      union all
      select
        configuration.installation_kit_id,
        false,
        false,
        true
      from normalized_lines as normalized_line
      join public.commercial_configuration_codes as commercial_code
        on commercial_code.id = normalized_line.commercial_code_id
      join public.commercial_configurations as configuration
        on configuration.id = commercial_code.configuration_id
      where normalized_line.kind = 'COMMERCIAL_CODE'
    ),
    required_items as (
      select
        required_role.item_id,
        bool_or(required_role.directly_requested) as directly_requested,
        bool_or(required_role.required_as_servo) as required_as_servo,
        bool_or(
          required_role.required_as_installation_kit
        ) as required_as_installation_kit
      from required_item_roles as required_role
      group by required_role.item_id
    )
    select *
    from required_items
    order by required_items.item_id
  loop
    select item.item_type, item.is_active
    into v_item_type, v_catalog_is_active
    from public.items as item
    where item.id = v_record.item_id
    for share;

    if not found then
      raise exception using
        errcode = '22023',
        message = format('Item %s does not exist.', v_record.item_id);
    end if;

    if not v_catalog_is_active then
      raise exception using
        errcode = '22023',
        message = format('Item %s is inactive.', v_record.item_id);
    end if;

    if v_record.directly_requested
      and v_item_type not in (
        'SERVO',
        'INSTALLATION_KIT',
        'REPAIR_KIT',
        'LOOSE_PART'
      ) then
      raise exception using
        errcode = '22023',
        message = format(
          'Item %s has unsupported item_type %s.',
          v_record.item_id,
          v_item_type
        );
    end if;

    if v_record.required_as_servo
      and v_item_type is distinct from 'SERVO' then
      raise exception using
        errcode = '23514',
        message = format(
          'Commercial configuration component %s must have item_type SERVO.',
          v_record.item_id
        );
    end if;

    if v_record.required_as_installation_kit
      and v_item_type is distinct from 'INSTALLATION_KIT' then
      raise exception using
        errcode = '23514',
        message = format(
          'Commercial configuration component %s must have item_type INSTALLATION_KIT.',
          v_record.item_id
        );
    end if;
  end loop;

  if exists (
    select 1
    from jsonb_to_recordset(v_normalized_lines) as normalized_line(
      kind text,
      item_id uuid,
      commercial_code_id uuid,
      quantity integer
    )
    join public.commercial_configuration_codes as commercial_code
      on commercial_code.id = normalized_line.commercial_code_id
    where normalized_line.kind = 'COMMERCIAL_CODE'
    group by commercial_code.configuration_id
    having sum(normalized_line.quantity::numeric) > 2147483647
  ) then
    raise exception using
      errcode = '22003',
      message = 'The consolidated inbound quantity for a physical configuration exceeds the PostgreSQL integer range.';
  end if;

  select count(*)
  into v_required_configurations
  from (
    select distinct commercial_code.configuration_id
    from jsonb_to_recordset(v_normalized_lines) as normalized_line(
      kind text,
      item_id uuid,
      commercial_code_id uuid,
      quantity integer
    )
    join public.commercial_configuration_codes as commercial_code
      on commercial_code.id = normalized_line.commercial_code_id
    where normalized_line.kind = 'COMMERCIAL_CODE'
  ) as required_configuration;

  insert into public.configuration_stock_balances (
    configuration_id,
    quantity
  )
  select required_configuration.configuration_id, 0
  from (
    select distinct commercial_code.configuration_id
    from jsonb_to_recordset(v_normalized_lines) as normalized_line(
      kind text,
      item_id uuid,
      commercial_code_id uuid,
      quantity integer
    )
    join public.commercial_configuration_codes as commercial_code
      on commercial_code.id = normalized_line.commercial_code_id
    where normalized_line.kind = 'COMMERCIAL_CODE'
  ) as required_configuration
  order by required_configuration.configuration_id
  on conflict (configuration_id) do nothing;

  for v_record in
    with configuration_requests as (
      select
        commercial_code.configuration_id,
        sum(normalized_line.quantity::numeric)::integer as quantity
      from jsonb_to_recordset(v_normalized_lines) as normalized_line(
        kind text,
        item_id uuid,
        commercial_code_id uuid,
        quantity integer
      )
      join public.commercial_configuration_codes as commercial_code
        on commercial_code.id = normalized_line.commercial_code_id
      where normalized_line.kind = 'COMMERCIAL_CODE'
      group by commercial_code.configuration_id
    )
    select
      balance.configuration_id,
      balance.quantity as quantity_before,
      configuration_request.quantity as quantity_change
    from public.configuration_stock_balances as balance
    join configuration_requests as configuration_request
      on configuration_request.configuration_id = balance.configuration_id
    order by balance.configuration_id
    for update of balance
  loop
    v_locked_configurations := v_locked_configurations + 1;

    if v_record.quantity_before::bigint
      + v_record.quantity_change::bigint > 2147483647 then
      raise exception using
        errcode = '22003',
        message = format(
          'Inbound quantity would exceed the PostgreSQL integer range for commercial configuration %s.',
          v_record.configuration_id
        );
    end if;
  end loop;

  if v_locked_configurations <> v_required_configurations then
    raise exception using
      errcode = '23514',
      message = 'Could not lock every configuration balance required by the batch stock inbound.';
  end if;

  select count(*)
  into v_required_items
  from jsonb_to_recordset(v_normalized_lines) as normalized_line(
    kind text,
    item_id uuid,
    commercial_code_id uuid,
    quantity integer
  )
  where normalized_line.kind = 'ITEM';

  insert into public.stock_balances (item_id, quantity)
  select normalized_line.item_id, 0
  from jsonb_to_recordset(v_normalized_lines) as normalized_line(
    kind text,
    item_id uuid,
    commercial_code_id uuid,
    quantity integer
  )
  where normalized_line.kind = 'ITEM'
  order by normalized_line.item_id
  on conflict (item_id) do nothing;

  for v_record in
    select
      balance.item_id,
      balance.quantity as quantity_before,
      normalized_line.quantity as quantity_change
    from public.stock_balances as balance
    join jsonb_to_recordset(v_normalized_lines) as normalized_line(
      kind text,
      item_id uuid,
      commercial_code_id uuid,
      quantity integer
    ) on normalized_line.item_id = balance.item_id
    where normalized_line.kind = 'ITEM'
    order by balance.item_id
    for update of balance
  loop
    v_locked_items := v_locked_items + 1;

    if v_record.quantity_before::bigint
      + v_record.quantity_change::bigint > 2147483647 then
      raise exception using
        errcode = '22003',
        message = format(
          'Inbound quantity would exceed the PostgreSQL integer range for item %s.',
          v_record.item_id
        );
    end if;
  end loop;

  if v_locked_items <> v_required_items then
    raise exception using
      errcode = '23514',
      message = 'Could not lock every physical balance required by the batch stock inbound.';
  end if;

  insert into public.inbound_batch_lines (
    batch_id,
    item_id,
    commercial_configuration_code_id,
    quantity
  )
  select
    v_batch_id,
    case
      when normalized_line.kind = 'ITEM' then normalized_line.item_id
      else null
    end,
    case
      when normalized_line.kind = 'COMMERCIAL_CODE'
        then normalized_line.commercial_code_id
      else null
    end,
    normalized_line.quantity
  from jsonb_to_recordset(v_normalized_lines) as normalized_line(
    kind text,
    item_id uuid,
    commercial_code_id uuid,
    quantity integer
  )
  order by
    normalized_line.kind,
    coalesce(normalized_line.item_id, normalized_line.commercial_code_id);

  get diagnostics v_inserted_audit_lines = row_count;

  if v_inserted_audit_lines <> v_lines_processed then
    raise exception using
      errcode = '23514',
      message = 'Could not create every audit line required by the batch stock inbound.';
  end if;

  -- Commercial boxes arrive already assembled. Increase only the shared
  -- configuration balance; do not create component stock movements or an
  -- assembly operation.
  for v_record in
    with configuration_requests as (
      select
        commercial_code.configuration_id,
        sum(normalized_line.quantity::numeric)::integer as quantity
      from jsonb_to_recordset(v_normalized_lines) as normalized_line(
        kind text,
        item_id uuid,
        commercial_code_id uuid,
        quantity integer
      )
      join public.commercial_configuration_codes as commercial_code
        on commercial_code.id = normalized_line.commercial_code_id
      where normalized_line.kind = 'COMMERCIAL_CODE'
      group by commercial_code.configuration_id
    )
    select
      balance.configuration_id,
      balance.quantity as quantity_before,
      configuration_request.quantity as quantity_change
    from public.configuration_stock_balances as balance
    join configuration_requests as configuration_request
      on configuration_request.configuration_id = balance.configuration_id
    order by balance.configuration_id
  loop
    v_quantity_after := (
      v_record.quantity_before::bigint
      + v_record.quantity_change::bigint
    )::integer;

    update public.configuration_stock_balances
    set quantity = v_quantity_after,
        updated_at = now()
    where configuration_id = v_record.configuration_id;

    insert into public.configuration_stock_movements (
      batch_id,
      configuration_id,
      quantity_change,
      quantity_before,
      quantity_after
    )
    values (
      v_batch_id,
      v_record.configuration_id,
      v_record.quantity_change,
      v_record.quantity_before,
      v_quantity_after
    );
  end loop;

  for v_record in
    select
      balance.item_id,
      balance.quantity as quantity_before,
      normalized_line.quantity as quantity_change
    from public.stock_balances as balance
    join jsonb_to_recordset(v_normalized_lines) as normalized_line(
      kind text,
      item_id uuid,
      commercial_code_id uuid,
      quantity integer
    ) on normalized_line.item_id = balance.item_id
    where normalized_line.kind = 'ITEM'
    order by balance.item_id
  loop
    v_quantity_after := (
      v_record.quantity_before::bigint
      + v_record.quantity_change::bigint
    )::integer;

    update public.stock_balances
    set quantity = v_quantity_after,
        updated_at = now()
    where item_id = v_record.item_id;

    insert into public.stock_movements (
      batch_id,
      item_id,
      quantity_change,
      quantity_before,
      quantity_after
    )
    values (
      v_batch_id,
      v_record.item_id,
      v_record.quantity_change,
      v_record.quantity_before,
      v_quantity_after
    );
  end loop;

  return jsonb_build_object(
    'movement_batch_id',
    v_batch_id,
    'lines_processed',
    v_lines_processed,
    'total_quantity',
    v_total_quantity,
    'commercial_quantity',
    v_commercial_quantity
  );
end;
$$;


ALTER FUNCTION "private"."stock_inbound_lines"("p_lines" "jsonb", "p_idempotency_key" "uuid", "p_user_id" "uuid", "p_user_name" "text", "p_description" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."stock_inbound_lines_with_loose_parts"("p_lines" "jsonb", "p_idempotency_key" "uuid", "p_user_id" "uuid", "p_user_name" "text", "p_description" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_payload_line jsonb;
  v_payload_index integer := 0;
  v_payload_kind text;
  v_payload_quantity numeric;
  v_normalized_lines jsonb;
  v_resolved_lines jsonb := '[]'::jsonb;
  v_new_code text;
  v_new_description text;
  v_item_id uuid;
  v_item_type text;
  v_item_description text;
  v_item_is_active boolean;
  v_result jsonb;
  v_batch_id uuid;
  v_saved_request jsonb;
  v_lock_key bigint;
begin
  if p_user_id is null then
    raise exception using
      errcode = '22023',
      message = 'p_user_id is required for a batch stock inbound.';
  end if;

  if p_idempotency_key is null then
    raise exception using
      errcode = '22023',
      message = 'p_idempotency_key is required for a batch stock inbound.';
  end if;

  if p_lines is null
    or jsonb_typeof(p_lines) is distinct from 'array'
    or jsonb_array_length(p_lines) = 0 then
    raise exception using
      errcode = '22023',
      message = 'p_lines must be a non-empty JSON array.';
  end if;

  if jsonb_array_length(p_lines) > 500 then
    raise exception using
      errcode = '22023',
      message = 'p_lines cannot contain more than 500 entries.';
  end if;

  if p_description is not null
    and char_length(p_description) > 500 then
    raise exception using
      errcode = '22023',
      message = 'p_description cannot exceed 500 characters.';
  end if;

  for v_payload_line in
    select payload_line.value
    from jsonb_array_elements(p_lines) as payload_line(value)
  loop
    v_payload_index := v_payload_index + 1;

    if jsonb_typeof(v_payload_line) is distinct from 'object' then
      raise exception using
        errcode = '22023',
        message = format(
          'p_lines entry %s must be a JSON object.',
          v_payload_index
        );
    end if;

    if not (v_payload_line ? 'kind')
      or jsonb_typeof(v_payload_line -> 'kind') is distinct from 'string' then
      raise exception using
        errcode = '22023',
        message = format(
          'p_lines entry %s must contain kind as a string.',
          v_payload_index
        );
    end if;

    v_payload_kind := v_payload_line ->> 'kind';

    if v_payload_kind = 'ITEM' then
      if v_payload_line - 'kind' - 'item_id' - 'quantity'
        <> '{}'::jsonb
        or not (v_payload_line ? 'item_id')
        or jsonb_typeof(v_payload_line -> 'item_id') is distinct from 'string'
        or nullif(btrim(v_payload_line ->> 'item_id'), '') is null then
        raise exception using
          errcode = '22023',
          message = format(
            'p_lines entry %s is invalid for kind ITEM.',
            v_payload_index
          );
      end if;

      begin
        perform (v_payload_line ->> 'item_id')::uuid;
      exception
        when invalid_text_representation then
          raise exception using
            errcode = '22023',
            message = format(
              'p_lines entry %s contains an invalid item_id UUID.',
              v_payload_index
            );
      end;
    elsif v_payload_kind = 'COMMERCIAL_CODE' then
      if v_payload_line - 'kind' - 'commercial_code_id' - 'quantity'
        <> '{}'::jsonb
        or not (v_payload_line ? 'commercial_code_id')
        or jsonb_typeof(
          v_payload_line -> 'commercial_code_id'
        ) is distinct from 'string'
        or nullif(
          btrim(v_payload_line ->> 'commercial_code_id'),
          ''
        ) is null then
        raise exception using
          errcode = '22023',
          message = format(
            'p_lines entry %s is invalid for kind COMMERCIAL_CODE.',
            v_payload_index
          );
      end if;

      begin
        perform (v_payload_line ->> 'commercial_code_id')::uuid;
      exception
        when invalid_text_representation then
          raise exception using
            errcode = '22023',
            message = format(
              'p_lines entry %s contains an invalid commercial_code_id UUID.',
              v_payload_index
            );
      end;
    elsif v_payload_kind = 'NEW_LOOSE_PART' then
      if v_payload_line - 'kind' - 'code' - 'description' - 'quantity'
        <> '{}'::jsonb
        or not (v_payload_line ? 'code')
        or jsonb_typeof(v_payload_line -> 'code') is distinct from 'string'
        or nullif(btrim(v_payload_line ->> 'code'), '') is null
        or char_length(btrim(v_payload_line ->> 'code')) > 120
        or not (v_payload_line ? 'description')
        or jsonb_typeof(
          v_payload_line -> 'description'
        ) is distinct from 'string'
        or nullif(btrim(v_payload_line ->> 'description'), '') is null
        or char_length(
          btrim(v_payload_line ->> 'description')
        ) > 500 then
        raise exception using
          errcode = '22023',
          message = format(
            'p_lines entry %s is invalid for kind NEW_LOOSE_PART.',
            v_payload_index
          );
      end if;
    else
      raise exception using
        errcode = '22023',
        message = format(
          'p_lines entry %s kind must be ITEM, COMMERCIAL_CODE or NEW_LOOSE_PART.',
          v_payload_index
        );
    end if;

    if not (v_payload_line ? 'quantity')
      or jsonb_typeof(v_payload_line -> 'quantity') is distinct from 'number' then
      raise exception using
        errcode = '22023',
        message = format(
          'p_lines entry %s must contain quantity as an integer greater than zero.',
          v_payload_index
        );
    end if;

    v_payload_quantity := (v_payload_line ->> 'quantity')::numeric;

    if v_payload_quantity <> trunc(v_payload_quantity)
      or v_payload_quantity <= 0
      or v_payload_quantity > 2147483647 then
      raise exception using
        errcode = '22023',
        message = format(
          'p_lines entry %s must contain quantity as a positive PostgreSQL integer.',
          v_payload_index
        );
    end if;
  end loop;

  if exists (
    select 1
    from jsonb_array_elements(p_lines) as payload_line(value)
    where payload_line.value ->> 'kind' = 'NEW_LOOSE_PART'
    group by btrim(payload_line.value ->> 'code')
    having count(
      distinct lower(btrim(payload_line.value ->> 'description'))
    ) > 1
  ) then
    raise exception using
      errcode = '22023',
      message = 'The same new loose-part code has conflicting descriptions.';
  end if;

  if exists (
    with parsed_lines as (
      select
        payload_line.value ->> 'kind' as kind,
        case payload_line.value ->> 'kind'
          when 'ITEM'
            then lower(payload_line.value ->> 'item_id')
          when 'COMMERCIAL_CODE'
            then lower(payload_line.value ->> 'commercial_code_id')
          else btrim(payload_line.value ->> 'code')
        end as identifier,
        (payload_line.value ->> 'quantity')::numeric as quantity
      from jsonb_array_elements(p_lines) as payload_line(value)
    )
    select 1
    from parsed_lines
    group by kind, identifier
    having sum(quantity) > 2147483647
  ) then
    raise exception using
      errcode = '22003',
      message = 'The consolidated quantity for an inbound line exceeds the PostgreSQL integer range.';
  end if;

  with parsed_lines as (
    select
      payload_line.value ->> 'kind' as kind,
      case payload_line.value ->> 'kind'
        when 'ITEM'
          then lower(payload_line.value ->> 'item_id')
        when 'COMMERCIAL_CODE'
          then lower(payload_line.value ->> 'commercial_code_id')
        else btrim(payload_line.value ->> 'code')
      end as identifier,
      case
        when payload_line.value ->> 'kind' = 'NEW_LOOSE_PART'
          then btrim(payload_line.value ->> 'code')
        else null
      end as code,
      case
        when payload_line.value ->> 'kind' = 'NEW_LOOSE_PART'
          then btrim(payload_line.value ->> 'description')
        else null
      end as description,
      (payload_line.value ->> 'quantity')::numeric as quantity
    from jsonb_array_elements(p_lines) as payload_line(value)
  ),
  grouped_lines as (
    select
      kind,
      identifier,
      min(code) as code,
      min(description) as description,
      sum(quantity)::integer as quantity
    from parsed_lines
    group by kind, identifier
  )
  select jsonb_agg(
    case grouped_line.kind
      when 'ITEM' then jsonb_build_object(
        'kind',
        'ITEM',
        'item_id',
        grouped_line.identifier,
        'quantity',
        grouped_line.quantity
      )
      when 'COMMERCIAL_CODE' then jsonb_build_object(
        'kind',
        'COMMERCIAL_CODE',
        'commercial_code_id',
        grouped_line.identifier,
        'quantity',
        grouped_line.quantity
      )
      else jsonb_build_object(
        'kind',
        'NEW_LOOSE_PART',
        'code',
        grouped_line.code,
        'description',
        grouped_line.description,
        'quantity',
        grouped_line.quantity
      )
    end
    order by grouped_line.kind, grouped_line.identifier
  )
  into v_normalized_lines
  from grouped_lines as grouped_line;

  -- Lock the actual 64-bit advisory keys in numeric order. Equal hashes
  -- serialize unrelated codes harmlessly and cannot invert lock ordering.
  for v_lock_key in
    select distinct pg_catalog.hashtextextended(
      normalized_line.value ->> 'code',
      0
    )
    from jsonb_array_elements(v_normalized_lines)
      as normalized_line(value)
    where normalized_line.value ->> 'kind' = 'NEW_LOOSE_PART'
    order by 1
  loop
    perform pg_catalog.pg_advisory_xact_lock(v_lock_key);
  end loop;

  for v_payload_line in
    select normalized_line.value
    from jsonb_array_elements(v_normalized_lines)
      as normalized_line(value)
  loop
    if v_payload_line ->> 'kind' <> 'NEW_LOOSE_PART' then
      v_resolved_lines := v_resolved_lines || jsonb_build_array(
        v_payload_line
      );
      continue;
    end if;

    v_new_code := v_payload_line ->> 'code';
    v_new_description := v_payload_line ->> 'description';

    perform 1
    from public.commercial_configuration_codes as commercial_code
    where commercial_code.code = v_new_code
    for share;

    if found then
      raise exception using
        errcode = '23514',
        message = format(
          'Code %s already belongs to a commercial configuration code.',
          v_new_code
        );
    end if;

    v_item_id := null;

    select
      item.id,
      item.item_type,
      item.description,
      item.is_active
    into
      v_item_id,
      v_item_type,
      v_item_description,
      v_item_is_active
    from public.items as item
    where item.code = v_new_code;

    if not found then
      insert into public.items (
        code,
        description,
        item_type,
        minimum_stock,
        is_active
      )
      values (
        v_new_code,
        v_new_description,
        'LOOSE_PART',
        0,
        true
      )
      on conflict (code) do nothing
      returning id, item_type, description, is_active
      into
        v_item_id,
        v_item_type,
        v_item_description,
        v_item_is_active;

      if not found then
        select
          item.id,
          item.item_type,
          item.description,
          item.is_active
        into
          v_item_id,
          v_item_type,
          v_item_description,
          v_item_is_active
        from public.items as item
        where item.code = v_new_code;
      else
        insert into public.loose_parts (item_id)
        values (v_item_id);
      end if;
    end if;

    if v_item_id is null then
      raise exception using
        errcode = '23503',
        message = format(
          'Loose-part code %s could not be resolved.',
          v_new_code
        );
    end if;

    if v_item_type <> 'LOOSE_PART' then
      raise exception using
        errcode = '23514',
        message = format(
          'Code %s already belongs to another item type.',
          v_new_code
        );
    end if;

    if not v_item_is_active then
      raise exception using
        errcode = '23514',
        message = format(
          'Loose-part code %s is inactive.',
          v_new_code
        );
    end if;

    if lower(btrim(v_item_description))
      <> lower(btrim(v_new_description)) then
      raise exception using
        errcode = '23514',
        message = format(
          'Code %s already has a different description.',
          v_new_code
        );
    end if;

    if not exists (
      select 1
      from public.loose_parts as loose_part
      where loose_part.item_id = v_item_id
    ) then
      raise exception using
        errcode = '23514',
        message = format(
          'Code %s is not registered as a loose-part subtype.',
          v_new_code
        );
    end if;

    v_resolved_lines := v_resolved_lines || jsonb_build_array(
      jsonb_build_object(
        'kind',
        'ITEM',
        'item_id',
        v_item_id,
        'quantity',
        (v_payload_line ->> 'quantity')::integer
      )
    );
  end loop;

  v_result := private.stock_inbound_lines(
    v_resolved_lines,
    p_idempotency_key,
    p_user_id,
    p_user_name,
    p_description
  );

  -- The delegated worker now holds a share lock on every resolved item.
  -- Recheck mutable catalog fields so a concurrent administrative edit
  -- cannot pass using values read before that lock was acquired.
  for v_payload_line in
    select normalized_line.value
    from jsonb_array_elements(v_normalized_lines)
      as normalized_line(value)
    where normalized_line.value ->> 'kind' = 'NEW_LOOSE_PART'
  loop
    v_new_code := v_payload_line ->> 'code';
    v_new_description := v_payload_line ->> 'description';

    select
      item.id,
      item.item_type,
      item.description,
      item.is_active
    into
      v_item_id,
      v_item_type,
      v_item_description,
      v_item_is_active
    from public.items as item
    where item.code = v_new_code;

    if not found
      or v_item_type <> 'LOOSE_PART'
      or not v_item_is_active
      or lower(btrim(v_item_description))
        <> lower(btrim(v_new_description))
      or not exists (
        select 1
        from public.loose_parts as loose_part
        where loose_part.item_id = v_item_id
      ) then
      raise exception using
        errcode = '23514',
        message = format(
          'Loose-part code %s changed while the inbound operation was being validated.',
          v_new_code
        );
    end if;
  end loop;

  v_batch_id := (v_result ->> 'movement_batch_id')::uuid;

  select batch.inbound_request_payload
  into v_saved_request
  from public.movement_batches as batch
  where batch.id = v_batch_id
  for update;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'The inbound movement batch could not be found.';
  end if;

  if v_saved_request is null then
    update public.movement_batches
    set inbound_request_payload = v_normalized_lines
    where id = v_batch_id;
  elsif v_saved_request <> v_normalized_lines then
    raise exception using
      errcode = '23505',
      message = 'The idempotency_key has already been used with a different inbound payload.';
  end if;

  return v_result;
end;
$$;


ALTER FUNCTION "private"."stock_inbound_lines_with_loose_parts"("p_lines" "jsonb", "p_idempotency_key" "uuid", "p_user_id" "uuid", "p_user_name" "text", "p_description" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."stock_outbound_item"("p_item_id" "uuid", "p_quantity" integer, "p_user_id" "uuid", "p_source" "text", "p_description" "text") RETURNS "uuid"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_batch_id uuid;
  v_quantity_before integer;
  v_quantity_after integer;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception using
      errcode = '22023',
      message = 'p_quantity must be greater than zero.';
  end if;

  if p_source is null
    or p_source not in ('MANUAL', 'AI_CHAT', 'ORDER_PHOTO') then
    raise exception using
      errcode = '22023',
      message = 'p_source must be MANUAL, AI_CHAT, or ORDER_PHOTO.';
  end if;

  perform 1
  from public.items
  where id = p_item_id
  for share;

  if not found then
    raise exception using
      errcode = '22023',
      message = format('Item %s does not exist.', p_item_id);
  end if;

  select quantity
  into v_quantity_before
  from public.stock_balances
  where item_id = p_item_id
  for update;

  if not found then
    raise exception using
      errcode = '22023',
      message = format('No stock balance exists for item %s.', p_item_id);
  end if;

  if v_quantity_before < p_quantity then
    raise exception using
      errcode = '23514',
      message = format(
        'Insufficient stock for item %s: available %s, requested %s.',
        p_item_id,
        v_quantity_before,
        p_quantity
      );
  end if;

  v_quantity_after := v_quantity_before - p_quantity;

  insert into public.movement_batches (
    movement_type,
    source,
    user_id,
    description
  )
  values (
    'OUTBOUND',
    p_source,
    p_user_id,
    p_description
  )
  returning id into v_batch_id;

  update public.stock_balances
  set quantity = v_quantity_after,
      updated_at = now()
  where item_id = p_item_id;

  insert into public.stock_movements (
    batch_id,
    item_id,
    quantity_change,
    quantity_before,
    quantity_after
  )
  values (
    v_batch_id,
    p_item_id,
    -p_quantity,
    v_quantity_before,
    v_quantity_after
  );

  return v_batch_id;
end;
$$;


ALTER FUNCTION "private"."stock_outbound_item"("p_item_id" "uuid", "p_quantity" integer, "p_user_id" "uuid", "p_source" "text", "p_description" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."stock_outbound_items"("p_lines" "jsonb", "p_idempotency_key" "uuid", "p_user_id" "uuid", "p_user_name" "text", "p_description" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_batch_id uuid;
  v_normalized_lines jsonb;
  v_existing_normalized_lines jsonb;
  v_payload_line jsonb;
  v_payload_index integer := 0;
  v_payload_kind text;
  v_payload_identifier uuid;
  v_payload_quantity numeric;
  v_existing_movement_type text;
  v_existing_source text;
  v_existing_description text;
  v_lines_processed integer;
  v_existing_lines_processed integer;
  v_total_quantity numeric;
  v_existing_total_quantity numeric;
  v_auto_assembled_quantity numeric;
  v_existing_auto_assembled_quantity numeric;
  v_configuration_id uuid;
  v_servo_id uuid;
  v_installation_kit_id uuid;
  v_item_type text;
  v_catalog_is_active boolean;
  v_commercial_code text;
  v_required_configurations integer;
  v_locked_configurations integer := 0;
  v_required_items integer;
  v_locked_items integer := 0;
  v_inserted_audit_lines integer := 0;
  v_affected_rows integer;
  v_quantity_after integer;
  v_configuration_quantity_after_assembly integer;
  v_configuration_quantity_after_outbound integer;
  v_record record;
begin
  if p_user_id is null then
    raise exception using
      errcode = '22023',
      message = 'p_user_id is required for a batch stock outbound.';
  end if;

  if p_idempotency_key is null then
    raise exception using
      errcode = '22023',
      message = 'p_idempotency_key is required for a batch stock outbound.';
  end if;

  if p_lines is null
    or jsonb_typeof(p_lines) is distinct from 'array' then
    raise exception using
      errcode = '22023',
      message = 'p_lines must be a non-empty JSON array.';
  end if;

  if jsonb_array_length(p_lines) = 0 then
    raise exception using
      errcode = '22023',
      message = 'p_lines must contain at least one line.';
  end if;

  for v_payload_line in
    select payload_line.value
    from jsonb_array_elements(p_lines) as payload_line(value)
  loop
    v_payload_index := v_payload_index + 1;

    if jsonb_typeof(v_payload_line) is distinct from 'object' then
      raise exception using
        errcode = '22023',
        message = format(
          'p_lines entry %s must be a JSON object.',
          v_payload_index
        );
    end if;

    if not (v_payload_line ? 'kind')
      or jsonb_typeof(v_payload_line -> 'kind') is distinct from 'string' then
      raise exception using
        errcode = '22023',
        message = format(
          'p_lines entry %s must contain kind as a string.',
          v_payload_index
        );
    end if;

    v_payload_kind := v_payload_line ->> 'kind';

    if v_payload_kind not in ('ITEM', 'COMMERCIAL_CODE') then
      raise exception using
        errcode = '22023',
        message = format(
          'p_lines entry %s kind must be ITEM or COMMERCIAL_CODE.',
          v_payload_index
        );
    end if;

    if v_payload_kind = 'ITEM' then
      if v_payload_line - 'kind' - 'item_id' - 'quantity'
        <> '{}'::jsonb then
        raise exception using
          errcode = '22023',
          message = format(
            'p_lines entry %s contains unexpected fields for kind ITEM.',
            v_payload_index
          );
      end if;

      if not (v_payload_line ? 'item_id')
        or jsonb_typeof(v_payload_line -> 'item_id') is distinct from 'string'
        or nullif(btrim(v_payload_line ->> 'item_id'), '') is null then
        raise exception using
          errcode = '22023',
          message = format(
            'p_lines entry %s must contain item_id as a UUID string.',
            v_payload_index
          );
      end if;

      begin
        v_payload_identifier := (v_payload_line ->> 'item_id')::uuid;
      exception
        when invalid_text_representation then
          raise exception using
            errcode = '22023',
            message = format(
              'p_lines entry %s contains an invalid item_id UUID.',
              v_payload_index
            );
      end;
    else
      if v_payload_line - 'kind' - 'commercial_code_id' - 'quantity'
        <> '{}'::jsonb then
        raise exception using
          errcode = '22023',
          message = format(
            'p_lines entry %s contains unexpected fields for kind COMMERCIAL_CODE.',
            v_payload_index
          );
      end if;

      if not (v_payload_line ? 'commercial_code_id')
        or jsonb_typeof(
          v_payload_line -> 'commercial_code_id'
        ) is distinct from 'string'
        or nullif(
          btrim(v_payload_line ->> 'commercial_code_id'),
          ''
        ) is null then
        raise exception using
          errcode = '22023',
          message = format(
            'p_lines entry %s must contain commercial_code_id as a UUID string.',
            v_payload_index
          );
      end if;

      begin
        v_payload_identifier :=
          (v_payload_line ->> 'commercial_code_id')::uuid;
      exception
        when invalid_text_representation then
          raise exception using
            errcode = '22023',
            message = format(
              'p_lines entry %s contains an invalid commercial_code_id UUID.',
              v_payload_index
            );
      end;
    end if;

    if not (v_payload_line ? 'quantity')
      or jsonb_typeof(v_payload_line -> 'quantity') is distinct from 'number' then
      raise exception using
        errcode = '22023',
        message = format(
          'p_lines entry %s must contain quantity as an integer greater than zero.',
          v_payload_index
        );
    end if;

    v_payload_quantity := (v_payload_line ->> 'quantity')::numeric;

    if v_payload_quantity <> trunc(v_payload_quantity)
      or v_payload_quantity <= 0
      or v_payload_quantity > 2147483647 then
      raise exception using
        errcode = '22023',
        message = format(
          'p_lines entry %s must contain quantity as an integer greater than zero within the PostgreSQL integer range.',
          v_payload_index
        );
    end if;
  end loop;

  if exists (
    with parsed_lines as (
      select
        payload_line.value ->> 'kind' as kind,
        case payload_line.value ->> 'kind'
          when 'ITEM'
            then (payload_line.value ->> 'item_id')::uuid
          else (payload_line.value ->> 'commercial_code_id')::uuid
        end as identifier,
        (payload_line.value ->> 'quantity')::numeric as quantity
      from jsonb_array_elements(p_lines) as payload_line(value)
    )
    select 1
    from parsed_lines
    group by kind, identifier
    having sum(quantity) > 2147483647
  ) then
    raise exception using
      errcode = '22003',
      message = 'The consolidated quantity for an outbound line exceeds the PostgreSQL integer range.';
  end if;

  with parsed_lines as (
    select
      payload_line.value ->> 'kind' as kind,
      case payload_line.value ->> 'kind'
        when 'ITEM'
          then (payload_line.value ->> 'item_id')::uuid
        else (payload_line.value ->> 'commercial_code_id')::uuid
      end as identifier,
      (payload_line.value ->> 'quantity')::numeric as quantity
    from jsonb_array_elements(p_lines) as payload_line(value)
  ),
  grouped_lines as (
    select kind, identifier, sum(quantity)::integer as quantity
    from parsed_lines
    group by kind, identifier
  )
  select jsonb_agg(
    case grouped_line.kind
      when 'ITEM' then jsonb_build_object(
        'kind',
        'ITEM',
        'item_id',
        grouped_line.identifier,
        'quantity',
        grouped_line.quantity
      )
      else jsonb_build_object(
        'kind',
        'COMMERCIAL_CODE',
        'commercial_code_id',
        grouped_line.identifier,
        'quantity',
        grouped_line.quantity
      )
    end
    order by grouped_line.kind, grouped_line.identifier
  )
  into v_normalized_lines
  from grouped_lines as grouped_line;

  v_lines_processed := jsonb_array_length(v_normalized_lines);

  select coalesce(sum(normalized_line.quantity::numeric), 0)
  into v_total_quantity
  from jsonb_to_recordset(v_normalized_lines) as normalized_line(
    kind text,
    item_id uuid,
    commercial_code_id uuid,
    quantity integer
  );

  -- The existing partial unique index is the concurrency boundary. A
  -- concurrent retry waits here and then reads the winning transaction.
  insert into public.movement_batches (
    movement_type,
    source,
    user_id,
    user_name_snapshot,
    description,
    idempotency_key
  )
  values (
    'OUTBOUND',
    'MANUAL',
    p_user_id,
    p_user_name,
    p_description,
    p_idempotency_key
  )
  on conflict (user_id, idempotency_key)
    where idempotency_key is not null
  do nothing
  returning id into v_batch_id;

  if not found then
    select
      batch.id,
      batch.movement_type,
      batch.source,
      batch.description
    into
      v_batch_id,
      v_existing_movement_type,
      v_existing_source,
      v_existing_description
    from public.movement_batches as batch
    where batch.user_id = p_user_id
      and batch.idempotency_key = p_idempotency_key
    for share;

    if not found then
      raise exception using
        errcode = '23505',
        message = 'The existing movement batch for p_idempotency_key could not be resolved.';
    end if;

    select
      jsonb_agg(
        case
          when outbound_line.item_id is not null then jsonb_build_object(
            'kind',
            'ITEM',
            'item_id',
            outbound_line.item_id,
            'quantity',
            outbound_line.quantity
          )
          else jsonb_build_object(
            'kind',
            'COMMERCIAL_CODE',
            'commercial_code_id',
            outbound_line.commercial_configuration_code_id,
            'quantity',
            outbound_line.quantity
          )
        end
        order by
          case
            when outbound_line.item_id is not null
              then 'ITEM'
            else 'COMMERCIAL_CODE'
          end,
          coalesce(
            outbound_line.item_id,
            outbound_line.commercial_configuration_code_id
          )
      ),
      count(*)::integer,
      coalesce(sum(outbound_line.quantity::numeric), 0),
      coalesce(sum(outbound_line.auto_assembled_quantity::numeric), 0)
    into
      v_existing_normalized_lines,
      v_existing_lines_processed,
      v_existing_total_quantity,
      v_existing_auto_assembled_quantity
    from public.outbound_batch_lines as outbound_line
    where outbound_line.batch_id = v_batch_id;

    if v_existing_movement_type is distinct from 'OUTBOUND'
      or v_existing_source is distinct from 'MANUAL'
      or v_existing_description is distinct from p_description
      or v_existing_normalized_lines is distinct from v_normalized_lines then
      raise exception using
        errcode = '22023',
        message = 'p_idempotency_key has already been used with a different batch stock outbound request.';
    end if;

    return jsonb_build_object(
      'movement_batch_id',
      v_batch_id,
      'lines_processed',
      v_existing_lines_processed,
      'total_quantity',
      v_existing_total_quantity,
      'auto_assembled_quantity',
      v_existing_auto_assembled_quantity
    );
  end if;

  -- Lock commercial codes first so aliases and their configuration mappings
  -- cannot change while physical requirements are calculated.
  for v_record in
    select normalized_line.commercial_code_id
    from jsonb_to_recordset(v_normalized_lines) as normalized_line(
      kind text,
      item_id uuid,
      commercial_code_id uuid,
      quantity integer
    )
    where normalized_line.kind = 'COMMERCIAL_CODE'
    order by normalized_line.commercial_code_id
  loop
    select
      commercial_code.configuration_id,
      commercial_code.code,
      commercial_code.is_active
    into
      v_configuration_id,
      v_commercial_code,
      v_catalog_is_active
    from public.commercial_configuration_codes as commercial_code
    where commercial_code.id = v_record.commercial_code_id
    for share;

    if not found then
      raise exception using
        errcode = '22023',
        message = format(
          'Commercial code %s does not exist.',
          v_record.commercial_code_id
        );
    end if;

    if not v_catalog_is_active then
      raise exception using
        errcode = '22023',
        message = format(
          'Commercial code %s is inactive.',
          v_commercial_code
        );
    end if;
  end loop;

  for v_record in
    select distinct commercial_code.configuration_id
    from jsonb_to_recordset(v_normalized_lines) as normalized_line(
      kind text,
      item_id uuid,
      commercial_code_id uuid,
      quantity integer
    )
    join public.commercial_configuration_codes as commercial_code
      on commercial_code.id = normalized_line.commercial_code_id
    where normalized_line.kind = 'COMMERCIAL_CODE'
    order by commercial_code.configuration_id
  loop
    select
      configuration.servo_id,
      configuration.installation_kit_id,
      configuration.is_active
    into
      v_servo_id,
      v_installation_kit_id,
      v_catalog_is_active
    from public.commercial_configurations as configuration
    where configuration.id = v_record.configuration_id
    for share;

    if not found then
      raise exception using
        errcode = '22023',
        message = format(
          'Commercial configuration %s does not exist.',
          v_record.configuration_id
        );
    end if;

    if not v_catalog_is_active then
      raise exception using
        errcode = '22023',
        message = format(
          'Commercial configuration %s is inactive.',
          v_record.configuration_id
        );
    end if;
  end loop;

  -- Lock every directly requested item and every possible automatic assembly
  -- component in one deterministic item_id order.
  for v_record in
    with normalized_lines as (
      select *
      from jsonb_to_recordset(v_normalized_lines) as normalized_line(
        kind text,
        item_id uuid,
        commercial_code_id uuid,
        quantity integer
      )
    ),
    required_item_ids as (
      select normalized_line.item_id
      from normalized_lines as normalized_line
      where normalized_line.kind = 'ITEM'
      union
      select configuration.servo_id
      from normalized_lines as normalized_line
      join public.commercial_configuration_codes as commercial_code
        on commercial_code.id = normalized_line.commercial_code_id
      join public.commercial_configurations as configuration
        on configuration.id = commercial_code.configuration_id
      where normalized_line.kind = 'COMMERCIAL_CODE'
      union
      select configuration.installation_kit_id
      from normalized_lines as normalized_line
      join public.commercial_configuration_codes as commercial_code
        on commercial_code.id = normalized_line.commercial_code_id
      join public.commercial_configurations as configuration
        on configuration.id = commercial_code.configuration_id
      where normalized_line.kind = 'COMMERCIAL_CODE'
    )
    select required_item.item_id
    from required_item_ids as required_item
    order by required_item.item_id
  loop
    select item.item_type, item.is_active
    into v_item_type, v_catalog_is_active
    from public.items as item
    where item.id = v_record.item_id
    for share;

    if not found then
      raise exception using
        errcode = '22023',
        message = format('Item %s does not exist.', v_record.item_id);
    end if;

    if not v_catalog_is_active then
      raise exception using
        errcode = '22023',
        message = format('Item %s is inactive.', v_record.item_id);
    end if;

    if v_item_type not in (
      'SERVO',
      'INSTALLATION_KIT',
      'REPAIR_KIT',
      'LOOSE_PART'
    ) then
      raise exception using
        errcode = '22023',
        message = format(
          'Item %s has unsupported item_type %s.',
          v_record.item_id,
          v_item_type
        );
    end if;
  end loop;

  if exists (
    select 1
    from jsonb_to_recordset(v_normalized_lines) as normalized_line(
      kind text,
      item_id uuid,
      commercial_code_id uuid,
      quantity integer
    )
    join public.commercial_configuration_codes as commercial_code
      on commercial_code.id = normalized_line.commercial_code_id
    where normalized_line.kind = 'COMMERCIAL_CODE'
    group by commercial_code.configuration_id
    having sum(normalized_line.quantity::numeric) > 2147483647
  ) then
    raise exception using
      errcode = '22003',
      message = 'The requested quantity for a physical configuration exceeds the PostgreSQL integer range.';
  end if;

  select count(*)
  into v_required_configurations
  from (
    select distinct commercial_code.configuration_id
    from jsonb_to_recordset(v_normalized_lines) as normalized_line(
      kind text,
      item_id uuid,
      commercial_code_id uuid,
      quantity integer
    )
    join public.commercial_configuration_codes as commercial_code
      on commercial_code.id = normalized_line.commercial_code_id
    where normalized_line.kind = 'COMMERCIAL_CODE'
  ) as required_configuration;

  insert into public.configuration_stock_balances (
    configuration_id,
    quantity
  )
  select required_configuration.configuration_id, 0
  from (
    select distinct commercial_code.configuration_id
    from jsonb_to_recordset(v_normalized_lines) as normalized_line(
      kind text,
      item_id uuid,
      commercial_code_id uuid,
      quantity integer
    )
    join public.commercial_configuration_codes as commercial_code
      on commercial_code.id = normalized_line.commercial_code_id
    where normalized_line.kind = 'COMMERCIAL_CODE'
  ) as required_configuration
  order by required_configuration.configuration_id
  on conflict (configuration_id) do nothing;

  for v_record in
    select balance.configuration_id
    from public.configuration_stock_balances as balance
    join (
      select distinct commercial_code.configuration_id
      from jsonb_to_recordset(v_normalized_lines) as normalized_line(
        kind text,
        item_id uuid,
        commercial_code_id uuid,
        quantity integer
      )
      join public.commercial_configuration_codes as commercial_code
        on commercial_code.id = normalized_line.commercial_code_id
      where normalized_line.kind = 'COMMERCIAL_CODE'
    ) as required_configuration
      on required_configuration.configuration_id = balance.configuration_id
    order by balance.configuration_id
    for update of balance
  loop
    v_locked_configurations := v_locked_configurations + 1;
  end loop;

  if v_locked_configurations <> v_required_configurations then
    raise exception using
      errcode = '23514',
      message = 'Could not lock every configuration balance required by the batch stock outbound.';
  end if;

  with normalized_lines as (
    select *
    from jsonb_to_recordset(v_normalized_lines) as normalized_line(
      kind text,
      item_id uuid,
      commercial_code_id uuid,
      quantity integer
    )
  ),
  required_item_ids as (
    select normalized_line.item_id
    from normalized_lines as normalized_line
    where normalized_line.kind = 'ITEM'
    union
    select configuration.servo_id
    from normalized_lines as normalized_line
    join public.commercial_configuration_codes as commercial_code
      on commercial_code.id = normalized_line.commercial_code_id
    join public.commercial_configurations as configuration
      on configuration.id = commercial_code.configuration_id
    where normalized_line.kind = 'COMMERCIAL_CODE'
    union
    select configuration.installation_kit_id
    from normalized_lines as normalized_line
    join public.commercial_configuration_codes as commercial_code
      on commercial_code.id = normalized_line.commercial_code_id
    join public.commercial_configurations as configuration
      on configuration.id = commercial_code.configuration_id
    where normalized_line.kind = 'COMMERCIAL_CODE'
  )
  select count(*)
  into v_required_items
  from required_item_ids;

  insert into public.stock_balances (item_id, quantity)
  with normalized_lines as (
    select *
    from jsonb_to_recordset(v_normalized_lines) as normalized_line(
      kind text,
      item_id uuid,
      commercial_code_id uuid,
      quantity integer
    )
  ),
  required_item_ids as (
    select normalized_line.item_id
    from normalized_lines as normalized_line
    where normalized_line.kind = 'ITEM'
    union
    select configuration.servo_id
    from normalized_lines as normalized_line
    join public.commercial_configuration_codes as commercial_code
      on commercial_code.id = normalized_line.commercial_code_id
    join public.commercial_configurations as configuration
      on configuration.id = commercial_code.configuration_id
    where normalized_line.kind = 'COMMERCIAL_CODE'
    union
    select configuration.installation_kit_id
    from normalized_lines as normalized_line
    join public.commercial_configuration_codes as commercial_code
      on commercial_code.id = normalized_line.commercial_code_id
    join public.commercial_configurations as configuration
      on configuration.id = commercial_code.configuration_id
    where normalized_line.kind = 'COMMERCIAL_CODE'
  )
  select required_item.item_id, 0
  from required_item_ids as required_item
  order by required_item.item_id
  on conflict (item_id) do nothing;

  for v_record in
    with normalized_lines as (
      select *
      from jsonb_to_recordset(v_normalized_lines) as normalized_line(
        kind text,
        item_id uuid,
        commercial_code_id uuid,
        quantity integer
      )
    ),
    configuration_requests as (
      select
        commercial_code.configuration_id,
        sum(normalized_line.quantity::numeric) as quantity
      from normalized_lines as normalized_line
      join public.commercial_configuration_codes as commercial_code
        on commercial_code.id = normalized_line.commercial_code_id
      where normalized_line.kind = 'COMMERCIAL_CODE'
      group by commercial_code.configuration_id
    ),
    configuration_needs as (
      select
        configuration_request.configuration_id,
        greatest(
          configuration_request.quantity - balance.quantity::numeric,
          0
        ) as auto_assembled_quantity
      from configuration_requests as configuration_request
      join public.configuration_stock_balances as balance
        on balance.configuration_id =
          configuration_request.configuration_id
    ),
    physical_needs as (
      select
        normalized_line.item_id,
        normalized_line.quantity::numeric as quantity
      from normalized_lines as normalized_line
      where normalized_line.kind = 'ITEM'
      union all
      select
        configuration.servo_id,
        configuration_need.auto_assembled_quantity
      from configuration_needs as configuration_need
      join public.commercial_configurations as configuration
        on configuration.id = configuration_need.configuration_id
      where configuration_need.auto_assembled_quantity > 0
      union all
      select
        configuration.installation_kit_id,
        configuration_need.auto_assembled_quantity
      from configuration_needs as configuration_need
      join public.commercial_configurations as configuration
        on configuration.id = configuration_need.configuration_id
      where configuration_need.auto_assembled_quantity > 0
    ),
    consolidated_physical_needs as (
      select physical_need.item_id, sum(physical_need.quantity) as quantity
      from physical_needs as physical_need
      group by physical_need.item_id
    ),
    required_item_ids as (
      select normalized_line.item_id
      from normalized_lines as normalized_line
      where normalized_line.kind = 'ITEM'
      union
      select configuration.servo_id
      from normalized_lines as normalized_line
      join public.commercial_configuration_codes as commercial_code
        on commercial_code.id = normalized_line.commercial_code_id
      join public.commercial_configurations as configuration
        on configuration.id = commercial_code.configuration_id
      where normalized_line.kind = 'COMMERCIAL_CODE'
      union
      select configuration.installation_kit_id
      from normalized_lines as normalized_line
      join public.commercial_configuration_codes as commercial_code
        on commercial_code.id = normalized_line.commercial_code_id
      join public.commercial_configurations as configuration
        on configuration.id = commercial_code.configuration_id
      where normalized_line.kind = 'COMMERCIAL_CODE'
    )
    select
      balance.item_id,
      balance.quantity as quantity_before,
      coalesce(consolidated_need.quantity, 0) as quantity_required
    from public.stock_balances as balance
    join required_item_ids as required_item
      on required_item.item_id = balance.item_id
    left join consolidated_physical_needs as consolidated_need
      on consolidated_need.item_id = balance.item_id
    order by balance.item_id
    for update of balance
  loop
    v_locked_items := v_locked_items + 1;

    if v_record.quantity_required > 2147483647 then
      raise exception using
        errcode = '22003',
        message = format(
          'The total physical requirement for item %s exceeds the PostgreSQL integer range.',
          v_record.item_id
        );
    end if;

    if v_record.quantity_before::numeric < v_record.quantity_required then
      raise exception using
        errcode = '23514',
        message = format(
          'Insufficient stock for item %s: available %s, required %s.',
          v_record.item_id,
          v_record.quantity_before,
          v_record.quantity_required
        );
    end if;
  end loop;

  if v_locked_items <> v_required_items then
    raise exception using
      errcode = '23514',
      message = 'Could not lock every physical balance required by the batch stock outbound.';
  end if;

  insert into public.outbound_batch_lines (
    batch_id,
    item_id,
    commercial_configuration_code_id,
    quantity,
    assembled_quantity_used,
    auto_assembled_quantity
  )
  select
    v_batch_id,
    normalized_line.item_id,
    null,
    normalized_line.quantity,
    0,
    0
  from jsonb_to_recordset(v_normalized_lines) as normalized_line(
    kind text,
    item_id uuid,
    commercial_code_id uuid,
    quantity integer
  )
  where normalized_line.kind = 'ITEM'
  order by normalized_line.item_id;

  get diagnostics v_affected_rows = row_count;
  v_inserted_audit_lines := v_inserted_audit_lines + v_affected_rows;

  insert into public.outbound_batch_lines (
    batch_id,
    item_id,
    commercial_configuration_code_id,
    quantity,
    assembled_quantity_used,
    auto_assembled_quantity
  )
  with normalized_code_lines as (
    select
      normalized_line.commercial_code_id,
      normalized_line.quantity,
      commercial_code.configuration_id,
      commercial_code.code
    from jsonb_to_recordset(v_normalized_lines) as normalized_line(
      kind text,
      item_id uuid,
      commercial_code_id uuid,
      quantity integer
    )
    join public.commercial_configuration_codes as commercial_code
      on commercial_code.id = normalized_line.commercial_code_id
    where normalized_line.kind = 'COMMERCIAL_CODE'
  ),
  allocated_code_lines as (
    select
      code_line.commercial_code_id,
      code_line.quantity,
      balance.quantity as assembled_balance,
      coalesce(
        sum(code_line.quantity::bigint) over (
          partition by code_line.configuration_id
          order by code_line.code, code_line.commercial_code_id
          rows between unbounded preceding and 1 preceding
        ),
        0
      ) as prior_requested_quantity
    from normalized_code_lines as code_line
    join public.configuration_stock_balances as balance
      on balance.configuration_id = code_line.configuration_id
  ),
  finalized_code_lines as (
    select
      allocated_line.commercial_code_id,
      allocated_line.quantity,
      least(
        allocated_line.quantity::bigint,
        greatest(
          allocated_line.assembled_balance::bigint
            - allocated_line.prior_requested_quantity,
          0
        )
      )::integer as assembled_quantity_used
    from allocated_code_lines as allocated_line
  )
  select
    v_batch_id,
    null,
    finalized_line.commercial_code_id,
    finalized_line.quantity,
    finalized_line.assembled_quantity_used,
    finalized_line.quantity - finalized_line.assembled_quantity_used
  from finalized_code_lines as finalized_line
  order by finalized_line.commercial_code_id;

  get diagnostics v_affected_rows = row_count;
  v_inserted_audit_lines := v_inserted_audit_lines + v_affected_rows;

  if v_inserted_audit_lines <> v_lines_processed then
    raise exception using
      errcode = '23514',
      message = 'Could not create every audit line required by the batch stock outbound.';
  end if;

  select coalesce(sum(outbound_line.auto_assembled_quantity::numeric), 0)
  into v_auto_assembled_quantity
  from public.outbound_batch_lines as outbound_line
  where outbound_line.batch_id = v_batch_id;

  -- Direct outbound quantities and automatic assembly components are updated
  -- as one consolidated physical requirement per item.
  for v_record in
    with normalized_lines as (
      select *
      from jsonb_to_recordset(v_normalized_lines) as normalized_line(
        kind text,
        item_id uuid,
        commercial_code_id uuid,
        quantity integer
      )
    ),
    configuration_requests as (
      select
        commercial_code.configuration_id,
        sum(normalized_line.quantity::numeric) as quantity
      from normalized_lines as normalized_line
      join public.commercial_configuration_codes as commercial_code
        on commercial_code.id = normalized_line.commercial_code_id
      where normalized_line.kind = 'COMMERCIAL_CODE'
      group by commercial_code.configuration_id
    ),
    configuration_needs as (
      select
        configuration_request.configuration_id,
        greatest(
          configuration_request.quantity - balance.quantity::numeric,
          0
        ) as auto_assembled_quantity
      from configuration_requests as configuration_request
      join public.configuration_stock_balances as balance
        on balance.configuration_id =
          configuration_request.configuration_id
    ),
    physical_needs as (
      select
        normalized_line.item_id,
        normalized_line.quantity::numeric as quantity
      from normalized_lines as normalized_line
      where normalized_line.kind = 'ITEM'
      union all
      select
        configuration.servo_id,
        configuration_need.auto_assembled_quantity
      from configuration_needs as configuration_need
      join public.commercial_configurations as configuration
        on configuration.id = configuration_need.configuration_id
      where configuration_need.auto_assembled_quantity > 0
      union all
      select
        configuration.installation_kit_id,
        configuration_need.auto_assembled_quantity
      from configuration_needs as configuration_need
      join public.commercial_configurations as configuration
        on configuration.id = configuration_need.configuration_id
      where configuration_need.auto_assembled_quantity > 0
    ),
    consolidated_physical_needs as (
      select physical_need.item_id, sum(physical_need.quantity) as quantity
      from physical_needs as physical_need
      group by physical_need.item_id
    )
    select
      balance.item_id,
      balance.quantity as quantity_before,
      consolidated_need.quantity::integer as quantity_required
    from public.stock_balances as balance
    join consolidated_physical_needs as consolidated_need
      on consolidated_need.item_id = balance.item_id
    where consolidated_need.quantity > 0
    order by balance.item_id
  loop
    v_quantity_after := (
      v_record.quantity_before::bigint
      - v_record.quantity_required::bigint
    )::integer;

    update public.stock_balances
    set quantity = v_quantity_after,
        updated_at = now()
    where item_id = v_record.item_id;

    insert into public.stock_movements (
      batch_id,
      item_id,
      quantity_change,
      quantity_before,
      quantity_after
    )
    values (
      v_batch_id,
      v_record.item_id,
      -v_record.quantity_required,
      v_record.quantity_before,
      v_quantity_after
    );
  end loop;

  -- Automatic assembly is recorded inside the OUTBOUND batch, followed by
  -- consumption of the complete requested configuration quantity.
  for v_record in
    with configuration_requests as (
      select
        commercial_code.configuration_id,
        sum(normalized_line.quantity::numeric)::integer as quantity
      from jsonb_to_recordset(v_normalized_lines) as normalized_line(
        kind text,
        item_id uuid,
        commercial_code_id uuid,
        quantity integer
      )
      join public.commercial_configuration_codes as commercial_code
        on commercial_code.id = normalized_line.commercial_code_id
      where normalized_line.kind = 'COMMERCIAL_CODE'
      group by commercial_code.configuration_id
    )
    select
      balance.configuration_id,
      balance.quantity as quantity_before,
      configuration_request.quantity as quantity_requested,
      greatest(
        configuration_request.quantity::bigint - balance.quantity::bigint,
        0
      )::integer as auto_assembled_quantity
    from public.configuration_stock_balances as balance
    join configuration_requests as configuration_request
      on configuration_request.configuration_id = balance.configuration_id
    order by balance.configuration_id
  loop
    v_configuration_quantity_after_assembly := (
      v_record.quantity_before::bigint
      + v_record.auto_assembled_quantity::bigint
    )::integer;

    if v_record.auto_assembled_quantity > 0 then
      update public.configuration_stock_balances
      set quantity = v_configuration_quantity_after_assembly,
          updated_at = now()
      where configuration_id = v_record.configuration_id;

      insert into public.configuration_stock_movements (
        batch_id,
        configuration_id,
        quantity_change,
        quantity_before,
        quantity_after
      )
      values (
        v_batch_id,
        v_record.configuration_id,
        v_record.auto_assembled_quantity,
        v_record.quantity_before,
        v_configuration_quantity_after_assembly
      );

      insert into public.assembly_operations (
        batch_id,
        configuration_id,
        operation_type,
        quantity
      )
      values (
        v_batch_id,
        v_record.configuration_id,
        'ASSEMBLY',
        v_record.auto_assembled_quantity
      );
    end if;

    v_configuration_quantity_after_outbound := (
      v_configuration_quantity_after_assembly::bigint
      - v_record.quantity_requested::bigint
    )::integer;

    update public.configuration_stock_balances
    set quantity = v_configuration_quantity_after_outbound,
        updated_at = now()
    where configuration_id = v_record.configuration_id;

    insert into public.configuration_stock_movements (
      batch_id,
      configuration_id,
      quantity_change,
      quantity_before,
      quantity_after
    )
    values (
      v_batch_id,
      v_record.configuration_id,
      -v_record.quantity_requested,
      v_configuration_quantity_after_assembly,
      v_configuration_quantity_after_outbound
    );
  end loop;

  return jsonb_build_object(
    'movement_batch_id',
    v_batch_id,
    'lines_processed',
    v_lines_processed,
    'total_quantity',
    v_total_quantity,
    'auto_assembled_quantity',
    v_auto_assembled_quantity
  );
end;
$$;


ALTER FUNCTION "private"."stock_outbound_items"("p_lines" "jsonb", "p_idempotency_key" "uuid", "p_user_id" "uuid", "p_user_name" "text", "p_description" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."supplier_order_catalog_snapshot"("p_item_id" "uuid", "p_configuration_id" "uuid", "p_commercial_code_id" "uuid", "p_require_active" boolean DEFAULT true) RETURNS TABLE("code_snapshot" "text", "description_snapshot" "text", "model_snapshot" "text", "item_type_snapshot" "text", "commercial_code_snapshot" "text")
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if (p_item_id is not null)::integer
    + (p_configuration_id is not null)::integer <> 1 then
    raise exception using
      errcode = '22023',
      message = 'Exactly one catalog target is required.';
  end if;

  if p_item_id is not null then
    if p_commercial_code_id is not null then
      raise exception using
        errcode = '22023',
        message = 'A physical item cannot use a commercial code.';
    end if;

    return query
    select
      item.code,
      item.description,
      nullif(btrim(servo.model), ''),
      item.item_type,
      null::text
    from public.items as item
    left join public.servo_models as servo
      on servo.item_id = item.id
    where item.id = p_item_id
      and (
        not p_require_active
        or item.is_active
      )
      and (
        (item.item_type = 'SERVO' and exists (
          select 1
          from public.servo_models
          where item_id = item.id
        ))
        or
        (item.item_type = 'INSTALLATION_KIT' and exists (
          select 1
          from public.installation_kits
          where item_id = item.id
        ))
        or
        (item.item_type = 'REPAIR_KIT' and exists (
          select 1
          from public.repair_kits
          where item_id = item.id
        ))
        or
        (item.item_type = 'LOOSE_PART' and exists (
          select 1
          from public.loose_parts
          where item_id = item.id
        ))
      )
    for share of item;

    if not found then
      raise exception using
        errcode = '22023',
        message = 'The physical item does not exist or is inactive.';
    end if;

    return;
  end if;

  if p_commercial_code_id is not null then
    perform 1
    from public.commercial_configuration_codes as selected_code
    where selected_code.id = p_commercial_code_id
      and selected_code.configuration_id = p_configuration_id
      and (
        not p_require_active
        or selected_code.is_active
      )
    for share;

    if not found then
      raise exception using
        errcode = '22023',
        message = 'The selected commercial code does not belong to the configuration or is inactive.';
    end if;
  end if;

  return query
  select
    coalesce(commercial_code.code, servo_item.code || ' + ' || kit_item.code),
    coalesce(
      nullif(btrim(configuration.description), ''),
      servo_item.description || ' + ' || kit_item.description
    ),
    nullif(btrim(servo.model), ''),
    'COMMERCIAL_CONFIGURATION'::text,
    commercial_code.code
  from public.commercial_configurations as configuration
  join public.items as servo_item
    on servo_item.id = configuration.servo_id
  join public.servo_models as servo
    on servo.item_id = configuration.servo_id
  join public.items as kit_item
    on kit_item.id = configuration.installation_kit_id
  left join public.commercial_configuration_codes as commercial_code
    on commercial_code.id = p_commercial_code_id
   and commercial_code.configuration_id = configuration.id
   and (
     not p_require_active
     or commercial_code.is_active
   )
  where configuration.id = p_configuration_id
    and (
      not p_require_active
      or (
        configuration.is_active
        and servo_item.is_active
        and kit_item.is_active
      )
    )
    and (
      p_commercial_code_id is null
      or commercial_code.id is not null
    )
  for share of configuration, servo_item, kit_item;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'The commercial configuration or selected commercial code does not exist, is inactive, or is inconsistent.';
  end if;
end;
$$;


ALTER FUNCTION "private"."supplier_order_catalog_snapshot"("p_item_id" "uuid", "p_configuration_id" "uuid", "p_commercial_code_id" "uuid", "p_require_active" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."supplier_order_existing_result"("p_user_id" "uuid", "p_idempotency_key" "uuid", "p_event_type" "text", "p_request" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_event_type text;
  v_existing_request jsonb;
  v_existing_result jsonb;
  v_supplier_order_id uuid;
  v_finalized_at timestamptz;
begin
  if p_user_id is null or p_idempotency_key is null then
    raise exception using
      errcode = '22023',
      message = 'User and idempotency key are required.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_user_id::text || ':' || p_idempotency_key::text,
      0
    )
  );

  select
    event.event_type,
    event.details -> 'request',
    event.details -> 'result'
  into
    v_event_type,
    v_existing_request,
    v_existing_result
  from public.supplier_order_events as event
  where event.user_id = p_user_id
    and event.idempotency_key = p_idempotency_key;

  if found then
    if (
        (
          p_event_type = 'ORDER_UPDATED'
          and v_event_type not in (
            'ORDER_HEADER_UPDATED',
            'ORDER_ITEMS_UPDATED'
          )
        )
        or (
          p_event_type <> 'ORDER_UPDATED'
          and v_event_type is distinct from p_event_type
        )
      )
      or v_existing_request is distinct from p_request
      or v_existing_result is null then
      raise exception using
        errcode = '22023',
        message = 'p_idempotency_key has already been used with a different supplier-order request.';
    end if;

    return v_existing_result;
  end if;

  -- All existing operational mutations pass through this idempotency helper.
  -- An identical retry returns above; every new request locks and checks the
  -- order before its worker can change current operational state.
  if p_event_type in (
    'ORDER_UPDATED',
    'PICKED_QUANTITY_CHANGED',
    'ALL_ITEMS_MARKED_PICKED',
    'ORDER_CANCELLED',
    'REMAINING_QUANTITY_CANCELLED',
    'ORDER_FINALIZED'
  ) then
    v_supplier_order_id :=
      nullif(p_request ->> 'supplier_order_id', '')::uuid;

    if v_supplier_order_id is null
      and nullif(p_request ->> 'supplier_order_item_id', '') is not null then
      select supplier_order.id, supplier_order.finalized_at
      into v_supplier_order_id, v_finalized_at
      from public.supplier_order_items as order_item
      join public.supplier_orders as supplier_order
        on supplier_order.id = order_item.supplier_order_id
      where order_item.id =
        (p_request ->> 'supplier_order_item_id')::uuid
      for update of supplier_order;
    elsif v_supplier_order_id is not null then
      select supplier_order.finalized_at
      into v_finalized_at
      from public.supplier_orders as supplier_order
      where supplier_order.id = v_supplier_order_id
      for update;
    end if;

    if v_finalized_at is not null then
      raise exception using
        errcode = '22023',
        message = 'A finalized supplier order cannot be changed.';
    end if;
  end if;

  return null;
end;
$$;


ALTER FUNCTION "private"."supplier_order_existing_result"("p_user_id" "uuid", "p_idempotency_key" "uuid", "p_event_type" "text", "p_request" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."supplier_order_result"("p_supplier_order_id" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select jsonb_build_object(
    'supplier_order_id', summary.id,
    'negotiation_number', summary.negotiation_number,
    'line_count', summary.line_count,
    'ordered_quantity', summary.ordered_quantity,
    'picked_quantity', summary.picked_quantity,
    'cancelled_quantity', summary.cancelled_quantity,
    'waiting_pickup_quantity', summary.waiting_pickup_quantity,
    'stocked_quantity', summary.stocked_quantity,
    'waiting_stock_quantity', summary.waiting_stock_quantity,
    'pickup_percentage', summary.pickup_percentage,
    'status', summary.status,
    'updated_at', summary.updated_at,
    'finalized_at', summary.finalized_at,
    'finalized_by', summary.finalized_by,
    'finalized_by_name_snapshot',
      summary.finalized_by_name_snapshot,
    'finalization_note', summary.finalization_note,
    'is_finalized', summary.is_finalized,
    'is_active_order', summary.is_active_order,
    'is_in_history', summary.is_in_history,
    'closure_kind', summary.closure_kind,
    'closed_at', summary.closed_at,
    'closed_by_name_snapshot', summary.closed_by_name_snapshot
  )
  from public.supplier_order_summaries as summary
  where summary.id = p_supplier_order_id;
$$;


ALTER FUNCTION "private"."supplier_order_result"("p_supplier_order_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."touch_supplier_order_timestamp"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;


ALTER FUNCTION "private"."touch_supplier_order_timestamp"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."update_supplier_order"("p_supplier_order_id" "uuid", "p_expected_updated_at" timestamp with time zone, "p_negotiation_number" "text", "p_order_date" "date", "p_notes" "text", "p_lines" "jsonb", "p_idempotency_key" "uuid", "p_user_id" "uuid", "p_user_name" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_negotiation_number text;
  v_notes text;
  v_lines jsonb;
  v_request jsonb;
  v_existing_result jsonb;
  v_result jsonb;
  v_order public.supplier_orders%rowtype;
  v_existing_line public.supplier_order_items%rowtype;
  v_line jsonb;
  v_line_id uuid;
  v_item_id uuid;
  v_configuration_id uuid;
  v_commercial_code_id uuid;
  v_quantity integer;
  v_position integer;
  v_line_notes text;
  v_identity_changed boolean;
  v_items_changed boolean := false;
  v_header_changed boolean := false;
  v_event_type text;
  v_before jsonb;
  v_after jsonb;
begin
  if p_supplier_order_id is null
    or p_expected_updated_at is null
    or p_idempotency_key is null then
    raise exception using
      errcode = '22023',
      message = 'Order, expected updated_at, and idempotency key are required.';
  end if;

  v_negotiation_number := btrim(p_negotiation_number);
  v_notes := nullif(btrim(p_notes), '');

  if v_negotiation_number is null
    or char_length(v_negotiation_number) not between 1 and 120 then
    raise exception using
      errcode = '22023',
      message = 'p_negotiation_number must contain between 1 and 120 characters.';
  end if;

  if p_order_date is null then
    raise exception using
      errcode = '22023',
      message = 'p_order_date is required.';
  end if;

  if v_notes is not null and char_length(v_notes) > 2000 then
    raise exception using
      errcode = '22023',
      message = 'p_notes must contain at most 2000 characters.';
  end if;

  v_lines := private.normalize_supplier_order_lines(p_lines, true);
  v_request := jsonb_build_object(
    'supplier_order_id', p_supplier_order_id,
    'expected_updated_at', p_expected_updated_at,
    'negotiation_number', v_negotiation_number,
    'order_date', p_order_date,
    'notes', v_notes,
    'lines', v_lines
  );

  v_existing_result := private.supplier_order_existing_result(
    p_user_id,
    p_idempotency_key,
    'ORDER_UPDATED',
    v_request
  );

  if v_existing_result is not null then
    return v_existing_result;
  end if;

  select *
  into v_order
  from public.supplier_orders
  where id = p_supplier_order_id
  for update;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'The supplier order does not exist.';
  end if;

  if v_order.cancelled_at is not null then
    raise exception using
      errcode = '22023',
      message = 'A cancelled supplier order cannot be edited.';
  end if;

  if v_order.updated_at is distinct from p_expected_updated_at then
    raise exception using
      errcode = '40001',
      message = 'The supplier order changed after it was loaded. Reload it before saving.';
  end if;

  perform 1
  from public.supplier_order_items
  where supplier_order_id = p_supplier_order_id
  order by id
  for update;

  select jsonb_build_object(
    'negotiation_number', v_order.negotiation_number,
    'order_date', v_order.order_date,
    'notes', v_order.notes,
    'updated_at', v_order.updated_at,
    'lines', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', order_item.id,
          'item_id', order_item.item_id,
          'commercial_configuration_id',
            order_item.commercial_configuration_id,
          'commercial_configuration_code_id',
            order_item.commercial_configuration_code_id,
          'code_snapshot', order_item.code_snapshot,
          'commercial_code_snapshot',
            order_item.commercial_code_snapshot,
          'ordered_quantity', order_item.ordered_quantity,
          'picked_quantity', order_item.picked_quantity,
          'stocked_quantity', order_item.stocked_quantity,
          'cancelled_quantity', order_item.cancelled_quantity,
          'position', order_item.position,
          'notes', order_item.notes
        )
        order by order_item.position, order_item.id
      ),
      '[]'::jsonb
    )
  )
  into v_before
  from public.supplier_order_items as order_item
  where order_item.supplier_order_id = p_supplier_order_id;

  v_header_changed :=
    v_order.negotiation_number is distinct from v_negotiation_number
    or v_order.order_date is distinct from p_order_date
    or v_order.notes is distinct from v_notes;

  -- Validate all desired lines before applying any change.
  for v_line in
    select value
    from jsonb_array_elements(v_lines)
    order by coalesce(
      value ->> 'item_id',
      value ->> 'commercial_configuration_id'
    ),
    value ->> 'commercial_configuration_code_id'
  loop
    v_line_id := nullif(v_line ->> 'id', '')::uuid;
    v_item_id := nullif(v_line ->> 'item_id', '')::uuid;
    v_configuration_id :=
      nullif(v_line ->> 'commercial_configuration_id', '')::uuid;
    v_commercial_code_id :=
      nullif(v_line ->> 'commercial_configuration_code_id', '')::uuid;
    v_quantity := (v_line ->> 'quantity')::integer;

    if v_line_id is null then
      perform *
      from private.supplier_order_catalog_snapshot(
        v_item_id,
        v_configuration_id,
        v_commercial_code_id,
        true
      );
      v_items_changed := true;
      continue;
    end if;

    select *
    into v_existing_line
    from public.supplier_order_items
    where id = v_line_id
      and supplier_order_id = p_supplier_order_id;

    if not found then
      raise exception using
        errcode = '22023',
        message = 'An existing line does not belong to this supplier order.';
    end if;

    v_identity_changed :=
      v_existing_line.item_id is distinct from v_item_id
      or v_existing_line.commercial_configuration_id
        is distinct from v_configuration_id
      or v_existing_line.commercial_configuration_code_id
        is distinct from v_commercial_code_id;

    if v_identity_changed and (
      v_existing_line.picked_quantity > 0
      or v_existing_line.stocked_quantity > 0
      or v_existing_line.cancelled_quantity > 0
      or exists (
        select 1
        from public.supplier_order_events as event
        where event.supplier_order_item_id = v_existing_line.id
      )
    ) then
      raise exception using
        errcode = '22023',
        message = 'A moved or cancelled line cannot change its catalog identity.';
    end if;

    if v_identity_changed then
      perform *
      from private.supplier_order_catalog_snapshot(
        v_item_id,
        v_configuration_id,
        v_commercial_code_id,
        true
      );
    end if;

    if v_quantity
      < v_existing_line.picked_quantity + v_existing_line.cancelled_quantity then
      raise exception using
        errcode = '22023',
        message = 'ordered_quantity cannot be lower than picked plus cancelled quantity.';
    end if;

    if v_identity_changed
      or v_existing_line.ordered_quantity is distinct from v_quantity
      or v_existing_line.notes
        is distinct from nullif(v_line ->> 'notes', '')
      or v_existing_line.position
        is distinct from (v_line ->> 'position')::integer then
      v_items_changed := true;
    end if;
  end loop;

  if exists (
    select 1
    from public.supplier_order_items as existing_line
    where existing_line.supplier_order_id = p_supplier_order_id
      and not exists (
        select 1
        from jsonb_array_elements(v_lines) as desired_line
        where nullif(desired_line ->> 'id', '')::uuid = existing_line.id
      )
      and (
        existing_line.picked_quantity > 0
        or existing_line.stocked_quantity > 0
        or existing_line.cancelled_quantity > 0
        or exists (
          select 1
          from public.supplier_order_events as event
          where event.supplier_order_item_id = existing_line.id
        )
      )
  ) then
    raise exception using
      errcode = '22023',
      message = 'A moved or cancelled line cannot be removed.';
  end if;

  if exists (
    select 1
    from public.supplier_order_items as existing_line
    where existing_line.supplier_order_id = p_supplier_order_id
      and not exists (
        select 1
        from jsonb_array_elements(v_lines) as desired_line
        where nullif(desired_line ->> 'id', '')::uuid = existing_line.id
      )
  ) then
    v_items_changed := true;
  end if;

  update public.supplier_orders
  set negotiation_number = v_negotiation_number,
      order_date = p_order_date,
      notes = v_notes
  where id = p_supplier_order_id;

  if v_items_changed then
    -- Move current positions outside the accepted RPC range before stable reorder.
    update public.supplier_order_items
    set position = position + 1001
    where supplier_order_id = p_supplier_order_id;

    for v_line in
      select value
      from jsonb_array_elements(v_lines)
      order by (value ->> 'position')::integer
    loop
      v_line_id := nullif(v_line ->> 'id', '')::uuid;
      v_item_id := nullif(v_line ->> 'item_id', '')::uuid;
      v_configuration_id :=
        nullif(v_line ->> 'commercial_configuration_id', '')::uuid;
      v_commercial_code_id :=
        nullif(v_line ->> 'commercial_configuration_code_id', '')::uuid;
      v_quantity := (v_line ->> 'quantity')::integer;
      v_position := (v_line ->> 'position')::integer;
      v_line_notes := nullif(v_line ->> 'notes', '');

      if v_line_id is null then
        insert into public.supplier_order_items (
          supplier_order_id,
          item_id,
          commercial_configuration_id,
          commercial_configuration_code_id,
          code_snapshot,
          description_snapshot,
          item_type_snapshot,
          ordered_quantity,
          position,
          notes
        )
        values (
          p_supplier_order_id,
          v_item_id,
          v_configuration_id,
          v_commercial_code_id,
          'SERVER_PENDING',
          'SERVER_PENDING',
          'LOOSE_PART',
          v_quantity,
          v_position,
          v_line_notes
        );
      else
        select *
        into v_existing_line
        from public.supplier_order_items
        where id = v_line_id;

        v_identity_changed :=
          v_existing_line.item_id is distinct from v_item_id
          or v_existing_line.commercial_configuration_id
            is distinct from v_configuration_id
          or v_existing_line.commercial_configuration_code_id
            is distinct from v_commercial_code_id;

        if v_identity_changed then
          update public.supplier_order_items
          set item_id = v_item_id,
              commercial_configuration_id = v_configuration_id,
              commercial_configuration_code_id = v_commercial_code_id,
              ordered_quantity = v_quantity,
              position = v_position,
              notes = v_line_notes
          where id = v_line_id;
        else
          update public.supplier_order_items
          set ordered_quantity = v_quantity,
              position = v_position,
              notes = v_line_notes
          where id = v_line_id;
        end if;
      end if;
    end loop;

    delete from public.supplier_order_items as existing_line
    where existing_line.supplier_order_id = p_supplier_order_id
      and not exists (
        select 1
        from jsonb_array_elements(v_lines) as desired_line
        where nullif(desired_line ->> 'id', '')::uuid = existing_line.id
      );
  end if;

  update public.supplier_orders
  set updated_at = now()
  where id = p_supplier_order_id;

  v_result := private.supplier_order_result(p_supplier_order_id);
  select jsonb_build_object(
    'negotiation_number', supplier_order.negotiation_number,
    'order_date', supplier_order.order_date,
    'notes', supplier_order.notes,
    'updated_at', supplier_order.updated_at,
    'lines', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', order_item.id,
          'item_id', order_item.item_id,
          'commercial_configuration_id',
            order_item.commercial_configuration_id,
          'commercial_configuration_code_id',
            order_item.commercial_configuration_code_id,
          'code_snapshot', order_item.code_snapshot,
          'commercial_code_snapshot',
            order_item.commercial_code_snapshot,
          'ordered_quantity', order_item.ordered_quantity,
          'picked_quantity', order_item.picked_quantity,
          'stocked_quantity', order_item.stocked_quantity,
          'cancelled_quantity', order_item.cancelled_quantity,
          'position', order_item.position,
          'notes', order_item.notes
        )
        order by order_item.position, order_item.id
      ),
      '[]'::jsonb
    )
  )
  into v_after
  from public.supplier_orders as supplier_order
  join public.supplier_order_items as order_item
    on order_item.supplier_order_id = supplier_order.id
  where supplier_order.id = p_supplier_order_id
  group by
    supplier_order.negotiation_number,
    supplier_order.order_date,
    supplier_order.notes,
    supplier_order.updated_at;
  v_event_type := case
    when v_items_changed then 'ORDER_ITEMS_UPDATED'
    else 'ORDER_HEADER_UPDATED'
  end;

  insert into public.supplier_order_events (
    supplier_order_id,
    event_type,
    user_id,
    user_name_snapshot,
    idempotency_key,
    details
  )
  values (
    p_supplier_order_id,
    v_event_type,
    p_user_id,
    p_user_name,
    p_idempotency_key,
    jsonb_build_object(
      'request', v_request,
      'result', v_result,
      'header_changed', v_header_changed,
      'items_changed', v_items_changed,
      'before', v_before,
      'after', v_after
    )
  );

  return v_result;
end;
$$;


ALTER FUNCTION "private"."update_supplier_order"("p_supplier_order_id" "uuid", "p_expected_updated_at" timestamp with time zone, "p_negotiation_number" "text", "p_order_date" "date", "p_notes" "text", "p_lines" "jsonb", "p_idempotency_key" "uuid", "p_user_id" "uuid", "p_user_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."validate_supplier_order_event_item"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if new.supplier_order_item_id is not null
    and not exists (
      select 1
      from public.supplier_order_items as order_item
      where order_item.id = new.supplier_order_item_id
        and order_item.supplier_order_id = new.supplier_order_id
    ) then
    raise exception using
      errcode = '23514',
      message = 'The supplier-order event item does not belong to its order.';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "private"."validate_supplier_order_event_item"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."validate_supplier_order_stock_entry_links"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_entry_id uuid;
begin
  if tg_table_name = 'supplier_order_stock_entries' then
    v_entry_id := new.id;
  else
    v_entry_id := new.supplier_order_stock_entry_id;
  end if;

  if not exists (
    select 1
    from public.supplier_order_stock_entries as entry
    join public.movement_batches as batch
      on batch.id = entry.movement_batch_id
    where entry.id = v_entry_id
      and batch.movement_type = 'INBOUND'
      and batch.source = 'MANUAL'
      and batch.user_id is not distinct from entry.created_by
      and batch.user_name_snapshot = entry.created_by_name_snapshot
  ) then
    raise exception using
      errcode = '23514',
      message = 'A supplier-order stock entry must reference its creator''s normal manual inbound batch.';
  end if;

  if exists (
    select 1
    from public.supplier_order_stock_entry_lines as entry_line
    join public.supplier_order_stock_entries as entry
      on entry.id = entry_line.supplier_order_stock_entry_id
    join public.supplier_order_items as order_item
      on order_item.id = entry_line.supplier_order_item_id
    join public.inbound_batch_lines as inbound_line
      on inbound_line.id = entry_line.inbound_batch_line_id
    left join public.commercial_configuration_codes as commercial_code
      on commercial_code.id =
        inbound_line.commercial_configuration_code_id
    where entry_line.supplier_order_stock_entry_id = v_entry_id
      and (
        order_item.supplier_order_id <> entry.supplier_order_id
        or inbound_line.batch_id <> entry.movement_batch_id
        or entry_line.item_id is distinct from order_item.item_id
        or entry_line.commercial_configuration_id
          is distinct from order_item.commercial_configuration_id
        or (
          entry_line.item_id is not null
          and inbound_line.item_id is distinct from entry_line.item_id
        )
        or (
          entry_line.commercial_configuration_id is not null
          and commercial_code.configuration_id
            is distinct from entry_line.commercial_configuration_id
        )
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'A supplier-order stock-entry link does not match its order item or inbound batch line.';
  end if;

  if exists (
    select 1
    from public.inbound_batch_lines as inbound_line
    join public.supplier_order_stock_entries as entry
      on entry.movement_batch_id = inbound_line.batch_id
    left join lateral (
      select coalesce(sum(entry_line.quantity), 0)::bigint as quantity
      from public.supplier_order_stock_entry_lines as entry_line
      where entry_line.supplier_order_stock_entry_id = entry.id
        and entry_line.inbound_batch_line_id = inbound_line.id
    ) as allocated on true
    where entry.id = v_entry_id
      and allocated.quantity <> inbound_line.quantity
  ) then
    raise exception using
      errcode = '23514',
      message = 'Supplier-order stock-entry allocations must equal every consolidated inbound line quantity.';
  end if;

  if not exists (
    select 1
    from public.supplier_order_stock_entry_lines
    where supplier_order_stock_entry_id = v_entry_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'A supplier-order stock entry must contain at least one line.';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "private"."validate_supplier_order_stock_entry_links"() OWNER TO "postgres";


COMMENT ON FUNCTION "private"."validate_supplier_order_stock_entry_links"() IS 'Validates deferred order-entry links for either trigger table without resolving fields from the other table row type.';



CREATE OR REPLACE FUNCTION "private"."validate_supplier_order_stocked_quantity"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_linked_quantity bigint;
  v_current_stocked_quantity integer;
begin
  select order_item.stocked_quantity
  into v_current_stocked_quantity
  from public.supplier_order_items as order_item
  where order_item.id = new.id;

  if not found then
    return new;
  end if;

  select coalesce(sum(entry_line.quantity), 0)::bigint
  into v_linked_quantity
  from public.supplier_order_stock_entry_lines as entry_line
  where entry_line.supplier_order_item_id = new.id;

  if v_linked_quantity <> v_current_stocked_quantity then
    raise exception using
      errcode = '23514',
      message = 'supplier_order_items.stocked_quantity must equal its linked stock-entry quantities.';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "private"."validate_supplier_order_stocked_quantity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."adjust_configuration_stock"("p_configuration_id" "uuid", "p_counted_quantity" integer, "p_reason" "text", "p_idempotency_key" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid;
  v_user_name text;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception using
      errcode = '28000',
      message = 'An authenticated user is required.';
  end if;

  select profile.name
  into v_user_name
  from public.profiles as profile
  where profile.id = v_user_id
    and profile.is_active
  for share;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'The authenticated user does not have an active profile.';
  end if;

  return private.adjust_inventory_stock(
    'CONFIGURATION',
    p_configuration_id,
    p_counted_quantity,
    p_reason,
    p_idempotency_key,
    v_user_id,
    v_user_name
  );
end;
$$;


ALTER FUNCTION "public"."adjust_configuration_stock"("p_configuration_id" "uuid", "p_counted_quantity" integer, "p_reason" "text", "p_idempotency_key" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."adjust_item_stock"("p_item_id" "uuid", "p_counted_quantity" integer, "p_reason" "text", "p_idempotency_key" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid;
  v_user_name text;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception using
      errcode = '28000',
      message = 'An authenticated user is required.';
  end if;

  select profile.name
  into v_user_name
  from public.profiles as profile
  where profile.id = v_user_id
    and profile.is_active
  for share;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'The authenticated user does not have an active profile.';
  end if;

  return private.adjust_inventory_stock(
    'ITEM',
    p_item_id,
    p_counted_quantity,
    p_reason,
    p_idempotency_key,
    v_user_id,
    v_user_name
  );
end;
$$;


ALTER FUNCTION "public"."adjust_item_stock"("p_item_id" "uuid", "p_counted_quantity" integer, "p_reason" "text", "p_idempotency_key" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."assemble_commercial_configuration"("p_configuration_id" "uuid", "p_quantity" integer, "p_idempotency_key" "uuid", "p_commercial_code" "text" DEFAULT NULL::"text", "p_description" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid;
  v_user_name text;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception using
      errcode = '28000',
      message = 'An authenticated user is required.';
  end if;

  select profile.name
  into v_user_name
  from public.profiles as profile
  where profile.id = v_user_id
    and profile.is_active
  for share;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'The authenticated user does not have an active profile.';
  end if;

  return private.execute_configuration_operation(
    'ASSEMBLY',
    p_configuration_id,
    p_quantity,
    p_idempotency_key,
    p_commercial_code,
    p_description,
    v_user_id,
    v_user_name
  );
end;
$$;


ALTER FUNCTION "public"."assemble_commercial_configuration"("p_configuration_id" "uuid", "p_quantity" integer, "p_idempotency_key" "uuid", "p_commercial_code" "text", "p_description" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_supplier_order"("p_supplier_order_id" "uuid", "p_cancellation_note" "text", "p_idempotency_key" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user record;
begin
  select *
  into v_user
  from private.require_supplier_order_user();

  return private.cancel_supplier_order(
    p_supplier_order_id,
    p_cancellation_note,
    p_idempotency_key,
    v_user.user_id,
    v_user.user_name
  );
end;
$$;


ALTER FUNCTION "public"."cancel_supplier_order"("p_supplier_order_id" "uuid", "p_cancellation_note" "text", "p_idempotency_key" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_supplier_order_remaining"("p_supplier_order_id" "uuid", "p_cancellation_note" "text", "p_idempotency_key" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user record;
begin
  select *
  into v_user
  from private.require_supplier_order_user();

  return private.cancel_supplier_order_remaining(
    p_supplier_order_id,
    p_cancellation_note,
    p_idempotency_key,
    v_user.user_id,
    v_user.user_name
  );
end;
$$;


ALTER FUNCTION "public"."cancel_supplier_order_remaining"("p_supplier_order_id" "uuid", "p_cancellation_note" "text", "p_idempotency_key" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_supplier_order"("p_negotiation_number" "text", "p_order_date" "date", "p_notes" "text", "p_lines" "jsonb", "p_idempotency_key" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user record;
begin
  select *
  into v_user
  from private.require_supplier_order_user();

  return private.create_supplier_order(
    p_negotiation_number,
    p_order_date,
    p_notes,
    p_lines,
    p_idempotency_key,
    v_user.user_id,
    v_user.user_name
  );
end;
$$;


ALTER FUNCTION "public"."create_supplier_order"("p_negotiation_number" "text", "p_order_date" "date", "p_notes" "text", "p_lines" "jsonb", "p_idempotency_key" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_supplier_order_stock_entry"("p_supplier_order_id" "uuid", "p_lines" "jsonb", "p_note" "text", "p_expected_updated_at" timestamp with time zone, "p_idempotency_key" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user record;
begin
  select *
  into v_user
  from private.require_supplier_order_user();

  return private.create_supplier_order_stock_entry(
    p_supplier_order_id,
    p_lines,
    p_note,
    p_expected_updated_at,
    p_idempotency_key,
    v_user.user_id,
    v_user.user_name
  );
end;
$$;


ALTER FUNCTION "public"."create_supplier_order_stock_entry"("p_supplier_order_id" "uuid", "p_lines" "jsonb", "p_note" "text", "p_expected_updated_at" timestamp with time zone, "p_idempotency_key" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."create_supplier_order_stock_entry"("p_supplier_order_id" "uuid", "p_lines" "jsonb", "p_note" "text", "p_expected_updated_at" timestamp with time zone, "p_idempotency_key" "uuid") IS 'Creates one idempotent supplier-order stock entry. Client lines contain only supplier_order_item_id and quantity.';



CREATE OR REPLACE FUNCTION "public"."disassemble_commercial_configuration"("p_configuration_id" "uuid", "p_quantity" integer, "p_idempotency_key" "uuid", "p_commercial_code" "text" DEFAULT NULL::"text", "p_description" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid;
  v_user_name text;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception using
      errcode = '28000',
      message = 'An authenticated user is required.';
  end if;

  select profile.name
  into v_user_name
  from public.profiles as profile
  where profile.id = v_user_id
    and profile.is_active
  for share;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'The authenticated user does not have an active profile.';
  end if;

  return private.execute_configuration_operation(
    'DISASSEMBLY',
    p_configuration_id,
    p_quantity,
    p_idempotency_key,
    p_commercial_code,
    p_description,
    v_user_id,
    v_user_name
  );
end;
$$;


ALTER FUNCTION "public"."disassemble_commercial_configuration"("p_configuration_id" "uuid", "p_quantity" integer, "p_idempotency_key" "uuid", "p_commercial_code" "text", "p_description" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_item_subtype_integrity"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  actual_item_type text;
  expected_item_type text;
  subtype_table text;
begin
  if tg_table_name = 'items' then
    if exists (
      select 1 from public.servo_models where item_id = new.id
    ) then
      expected_item_type := 'SERVO';
      subtype_table := 'servo_models';
    elsif exists (
      select 1 from public.installation_kits where item_id = new.id
    ) then
      expected_item_type := 'INSTALLATION_KIT';
      subtype_table := 'installation_kits';
    elsif exists (
      select 1 from public.repair_kits where item_id = new.id
    ) then
      expected_item_type := 'REPAIR_KIT';
      subtype_table := 'repair_kits';
    elsif exists (
      select 1 from public.loose_parts where item_id = new.id
    ) then
      expected_item_type := 'LOOSE_PART';
      subtype_table := 'loose_parts';
    end if;

    if expected_item_type is not null
      and new.item_type <> expected_item_type then
      raise exception using
        errcode = '23514',
        message = format(
          'Item %s is registered in public.%I and must keep item_type %s; attempted %s.',
          new.id,
          subtype_table,
          expected_item_type,
          new.item_type
        );
    end if;

    return new;
  end if;

  expected_item_type := tg_argv[0];

  select item_type
  into actual_item_type
  from public.items
  where id = new.item_id
  for update;

  if not found then
    raise exception using
      errcode = '23503',
      message = format(
        'Item %s does not exist and cannot be associated with public.%I.',
        new.item_id,
        tg_table_name
      );
  end if;

  if actual_item_type <> expected_item_type then
    raise exception using
      errcode = '23514',
      message = format(
        'Item %s has item_type %s and cannot be associated with public.%I; expected %s.',
        new.item_id,
        actual_item_type,
        tg_table_name,
        expected_item_type
      );
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."enforce_item_subtype_integrity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finalize_supplier_order"("p_supplier_order_id" "uuid", "p_expected_updated_at" timestamp with time zone, "p_finalization_note" "text", "p_idempotency_key" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user record;
begin
  select *
  into v_user
  from private.require_supplier_order_user();

  return private.finalize_supplier_order(
    p_supplier_order_id,
    p_expected_updated_at,
    p_finalization_note,
    p_idempotency_key,
    v_user.user_id,
    v_user.user_name
  );
end;
$$;


ALTER FUNCTION "public"."finalize_supplier_order"("p_supplier_order_id" "uuid", "p_expected_updated_at" timestamp with time zone, "p_finalization_note" "text", "p_idempotency_key" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  insert into public.profiles (id, name)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'name', ''),
      nullif(new.raw_user_meta_data ->> 'full_name', '')
    )
  )
  on conflict (id) do nothing;

  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_supplier_order_all_picked"("p_supplier_order_id" "uuid", "p_description" "text", "p_idempotency_key" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user record;
begin
  select *
  into v_user
  from private.require_supplier_order_user();

  return private.mark_supplier_order_all_picked(
    p_supplier_order_id,
    p_description,
    p_idempotency_key,
    v_user.user_id,
    v_user.user_name
  );
end;
$$;


ALTER FUNCTION "public"."mark_supplier_order_all_picked"("p_supplier_order_id" "uuid", "p_description" "text", "p_idempotency_key" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_supplier_order_all_picked_checked"("p_supplier_order_id" "uuid", "p_description" "text", "p_expected_order_updated_at" timestamp with time zone, "p_idempotency_key" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user record;
begin
  select *
  into v_user
  from private.require_supplier_order_user();

  return private.mark_supplier_order_all_picked_checked(
    p_supplier_order_id,
    p_description,
    p_expected_order_updated_at,
    p_idempotency_key,
    v_user.user_id,
    v_user.user_name
  );
end;
$$;


ALTER FUNCTION "public"."mark_supplier_order_all_picked_checked"("p_supplier_order_id" "uuid", "p_description" "text", "p_expected_order_updated_at" timestamp with time zone, "p_idempotency_key" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."mark_supplier_order_all_picked_checked"("p_supplier_order_id" "uuid", "p_description" "text", "p_expected_order_updated_at" timestamp with time zone, "p_idempotency_key" "uuid") IS 'Atomically marks every available supplier-order quantity as picked for Assistant proposals. Identical retries remain idempotent; a new request with a stale order version fails after locking and before any write.';



CREATE OR REPLACE FUNCTION "public"."set_configuration_minimum_stock"("p_configuration_id" "uuid", "p_minimum_stock" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid;
  v_user_name text;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception using
      errcode = '28000',
      message = 'An authenticated user is required.';
  end if;

  select profile.name
  into v_user_name
  from public.profiles as profile
  where profile.id = v_user_id
    and profile.is_active
  for share;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'The authenticated user does not have an active profile.';
  end if;

  return private.set_configuration_minimum_stock(
    p_configuration_id,
    p_minimum_stock,
    v_user_id,
    v_user_name
  );
end;
$$;


ALTER FUNCTION "public"."set_configuration_minimum_stock"("p_configuration_id" "uuid", "p_minimum_stock" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_item_minimum_stock"("p_item_id" "uuid", "p_minimum_stock" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid;
  v_user_name text;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception using
      errcode = '28000',
      message = 'An authenticated user is required.';
  end if;

  select profile.name
  into v_user_name
  from public.profiles as profile
  where profile.id = v_user_id
    and profile.is_active
  for share;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'The authenticated user does not have an active profile.';
  end if;

  return private.set_item_minimum_stock(
    p_item_id,
    p_minimum_stock,
    v_user_id,
    v_user_name
  );
end;
$$;


ALTER FUNCTION "public"."set_item_minimum_stock"("p_item_id" "uuid", "p_minimum_stock" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_supplier_order_item_picked_quantity"("p_supplier_order_item_id" "uuid", "p_picked_quantity" integer, "p_description" "text", "p_idempotency_key" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user record;
begin
  select *
  into v_user
  from private.require_supplier_order_user();

  return private.set_supplier_order_item_picked_quantity(
    p_supplier_order_item_id,
    p_picked_quantity,
    p_description,
    p_idempotency_key,
    v_user.user_id,
    v_user.user_name
  );
end;
$$;


ALTER FUNCTION "public"."set_supplier_order_item_picked_quantity"("p_supplier_order_item_id" "uuid", "p_picked_quantity" integer, "p_description" "text", "p_idempotency_key" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_supplier_order_item_picked_quantity_checked"("p_supplier_order_item_id" "uuid", "p_target_picked_quantity" integer, "p_description" "text", "p_expected_order_updated_at" timestamp with time zone, "p_idempotency_key" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user record;
begin
  select *
  into v_user
  from private.require_supplier_order_user();

  return private.set_supplier_order_item_picked_quantity_checked(
    p_supplier_order_item_id,
    p_target_picked_quantity,
    p_description,
    p_expected_order_updated_at,
    p_idempotency_key,
    v_user.user_id,
    v_user.user_name
  );
end;
$$;


ALTER FUNCTION "public"."set_supplier_order_item_picked_quantity_checked"("p_supplier_order_item_id" "uuid", "p_target_picked_quantity" integer, "p_description" "text", "p_expected_order_updated_at" timestamp with time zone, "p_idempotency_key" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."set_supplier_order_item_picked_quantity_checked"("p_supplier_order_item_id" "uuid", "p_target_picked_quantity" integer, "p_description" "text", "p_expected_order_updated_at" timestamp with time zone, "p_idempotency_key" "uuid") IS 'Sets one supplier-order picked quantity to an absolute target for Assistant proposals. Identical retries remain idempotent; a new request with a stale order version fails after locking and before any write.';



CREATE OR REPLACE FUNCTION "public"."stock_inbound_item"("p_item_id" "uuid", "p_quantity" integer, "p_source" "text", "p_description" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid;
  v_user_name text;
  v_batch_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception using
      errcode = '28000',
      message = 'An authenticated user is required.';
  end if;

  select name
  into v_user_name
  from public.profiles
  where id = v_user_id
    and is_active;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'The authenticated user does not have an active profile.';
  end if;

  v_batch_id := private.stock_inbound_item(
    p_item_id,
    p_quantity,
    v_user_id,
    p_source,
    p_description
  );

  update public.movement_batches
  set user_name_snapshot = v_user_name
  where id = v_batch_id;

  return v_batch_id;
end;
$$;


ALTER FUNCTION "public"."stock_inbound_item"("p_item_id" "uuid", "p_quantity" integer, "p_source" "text", "p_description" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."stock_inbound_items"("p_items" "jsonb", "p_idempotency_key" "uuid", "p_description" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid;
  v_user_name text;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception using
      errcode = '28000',
      message = 'An authenticated user is required.';
  end if;

  if p_idempotency_key is null then
    raise exception using
      errcode = '22023',
      message = 'p_idempotency_key is required for a batch stock inbound.';
  end if;

  select profile.name
  into v_user_name
  from public.profiles as profile
  where profile.id = v_user_id
    and profile.is_active
  for share;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'The authenticated user does not have an active profile.';
  end if;

  return private.stock_inbound_items(
    p_items,
    p_idempotency_key,
    v_user_id,
    v_user_name,
    p_description
  );
end;
$$;


ALTER FUNCTION "public"."stock_inbound_items"("p_items" "jsonb", "p_idempotency_key" "uuid", "p_description" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."stock_inbound_lines"("p_lines" "jsonb", "p_idempotency_key" "uuid", "p_description" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid;
  v_user_name text;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception using
      errcode = '28000',
      message = 'An authenticated user is required.';
  end if;

  if p_idempotency_key is null then
    raise exception using
      errcode = '22023',
      message = 'p_idempotency_key is required for a batch stock inbound.';
  end if;

  select profile.name
  into v_user_name
  from public.profiles as profile
  where profile.id = v_user_id
    and profile.is_active
  for share;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'The authenticated user does not have an active profile.';
  end if;

  return private.stock_inbound_lines_with_loose_parts(
    p_lines,
    p_idempotency_key,
    v_user_id,
    v_user_name,
    p_description
  );
end;
$$;


ALTER FUNCTION "public"."stock_inbound_lines"("p_lines" "jsonb", "p_idempotency_key" "uuid", "p_description" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."stock_outbound_item"("p_item_id" "uuid", "p_quantity" integer, "p_source" "text", "p_description" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid;
  v_user_name text;
  v_batch_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception using
      errcode = '28000',
      message = 'An authenticated user is required.';
  end if;

  select name
  into v_user_name
  from public.profiles
  where id = v_user_id
    and is_active;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'The authenticated user does not have an active profile.';
  end if;

  v_batch_id := private.stock_outbound_item(
    p_item_id,
    p_quantity,
    v_user_id,
    p_source,
    p_description
  );

  update public.movement_batches
  set user_name_snapshot = v_user_name
  where id = v_batch_id;

  return v_batch_id;
end;
$$;


ALTER FUNCTION "public"."stock_outbound_item"("p_item_id" "uuid", "p_quantity" integer, "p_source" "text", "p_description" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."stock_outbound_items"("p_lines" "jsonb", "p_idempotency_key" "uuid", "p_description" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid;
  v_user_name text;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception using
      errcode = '28000',
      message = 'An authenticated user is required.';
  end if;

  if p_idempotency_key is null then
    raise exception using
      errcode = '22023',
      message = 'p_idempotency_key is required for a batch stock outbound.';
  end if;

  select profile.name
  into v_user_name
  from public.profiles as profile
  where profile.id = v_user_id
    and profile.is_active
  for share;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'The authenticated user does not have an active profile.';
  end if;

  return private.stock_outbound_items(
    p_lines,
    p_idempotency_key,
    v_user_id,
    v_user_name,
    p_description
  );
end;
$$;


ALTER FUNCTION "public"."stock_outbound_items"("p_lines" "jsonb", "p_idempotency_key" "uuid", "p_description" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_supplier_order"("p_supplier_order_id" "uuid", "p_expected_updated_at" timestamp with time zone, "p_negotiation_number" "text", "p_order_date" "date", "p_notes" "text", "p_lines" "jsonb", "p_idempotency_key" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user record;
begin
  select *
  into v_user
  from private.require_supplier_order_user();

  return private.update_supplier_order(
    p_supplier_order_id,
    p_expected_updated_at,
    p_negotiation_number,
    p_order_date,
    p_notes,
    p_lines,
    p_idempotency_key,
    v_user.user_id,
    v_user.user_name
  );
end;
$$;


ALTER FUNCTION "public"."update_supplier_order"("p_supplier_order_id" "uuid", "p_expected_updated_at" timestamp with time zone, "p_negotiation_number" "text", "p_order_date" "date", "p_notes" "text", "p_lines" "jsonb", "p_idempotency_key" "uuid") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "private"."configuration_operation_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "user_name_snapshot" "text",
    "idempotency_key" "uuid" NOT NULL,
    "operation_type" "text" NOT NULL,
    "configuration_id" "uuid" NOT NULL,
    "commercial_configuration_code_id" "uuid",
    "commercial_code_snapshot" "text",
    "quantity" integer NOT NULL,
    "description" "text",
    "movement_batch_id" "uuid",
    "servo_id" "uuid",
    "installation_kit_id" "uuid",
    "servo_quantity_before" integer,
    "servo_quantity_after" integer,
    "kit_quantity_before" integer,
    "kit_quantity_after" integer,
    "configuration_quantity_before" integer,
    "configuration_quantity_after" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    CONSTRAINT "configuration_operation_requests_commercial_code_check" CHECK ((("commercial_code_snapshot" IS NULL) OR ("btrim"("commercial_code_snapshot") <> ''::"text"))),
    CONSTRAINT "configuration_operation_requests_commercial_code_reference_chec" CHECK ((("commercial_configuration_code_id" IS NULL) OR ("commercial_code_snapshot" IS NOT NULL))),
    CONSTRAINT "configuration_operation_requests_completion_check" CHECK (((("movement_batch_id" IS NULL) AND ("servo_id" IS NULL) AND ("installation_kit_id" IS NULL) AND ("servo_quantity_before" IS NULL) AND ("servo_quantity_after" IS NULL) AND ("kit_quantity_before" IS NULL) AND ("kit_quantity_after" IS NULL) AND ("configuration_quantity_before" IS NULL) AND ("configuration_quantity_after" IS NULL) AND ("completed_at" IS NULL)) OR (("movement_batch_id" IS NOT NULL) AND ("servo_id" IS NOT NULL) AND ("installation_kit_id" IS NOT NULL) AND ("servo_quantity_before" >= 0) AND ("servo_quantity_after" >= 0) AND ("kit_quantity_before" >= 0) AND ("kit_quantity_after" >= 0) AND ("configuration_quantity_before" >= 0) AND ("configuration_quantity_after" >= 0) AND ("completed_at" IS NOT NULL) AND ("servo_quantity_after" = ("servo_quantity_before" +
CASE "operation_type"
    WHEN 'ASSEMBLY'::"text" THEN (- "quantity")
    ELSE "quantity"
END)) AND ("kit_quantity_after" = ("kit_quantity_before" +
CASE "operation_type"
    WHEN 'ASSEMBLY'::"text" THEN (- "quantity")
    ELSE "quantity"
END)) AND ("configuration_quantity_after" = ("configuration_quantity_before" +
CASE "operation_type"
    WHEN 'ASSEMBLY'::"text" THEN "quantity"
    ELSE (- "quantity")
END))))),
    CONSTRAINT "configuration_operation_requests_description_check" CHECK ((("description" IS NULL) OR (("btrim"("description") <> ''::"text") AND ("char_length"("description") <= 500)))),
    CONSTRAINT "configuration_operation_requests_operation_type_check" CHECK (("operation_type" = ANY (ARRAY['ASSEMBLY'::"text", 'DISASSEMBLY'::"text"]))),
    CONSTRAINT "configuration_operation_requests_quantity_check" CHECK (("quantity" > 0))
);


ALTER TABLE "private"."configuration_operation_requests" OWNER TO "postgres";


COMMENT ON TABLE "private"."configuration_operation_requests" IS 'Private canonical requests and immutable receipts for idempotent manual assembly and disassembly operations.';



CREATE TABLE IF NOT EXISTS "private"."stock_adjustment_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "user_name_snapshot" "text",
    "idempotency_key" "uuid" NOT NULL,
    "target_type" "text" NOT NULL,
    "item_id" "uuid",
    "configuration_id" "uuid",
    "counted_quantity" integer NOT NULL,
    "reason" "text" NOT NULL,
    "movement_batch_id" "uuid",
    "quantity_before" integer,
    "quantity_change" integer,
    "quantity_after" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    CONSTRAINT "stock_adjustment_requests_completion_check" CHECK (((("quantity_before" IS NULL) AND ("quantity_change" IS NULL) AND ("quantity_after" IS NULL) AND ("movement_batch_id" IS NULL) AND ("completed_at" IS NULL)) OR (("quantity_before" >= 0) AND ("quantity_change" IS NOT NULL) AND ("quantity_after" >= 0) AND ("quantity_after" = "counted_quantity") AND ("quantity_after" = ("quantity_before" + "quantity_change")) AND ("completed_at" IS NOT NULL) AND ((("quantity_change" = 0) AND ("movement_batch_id" IS NULL)) OR (("quantity_change" <> 0) AND ("movement_batch_id" IS NOT NULL)))))),
    CONSTRAINT "stock_adjustment_requests_counted_quantity_check" CHECK (("counted_quantity" >= 0)),
    CONSTRAINT "stock_adjustment_requests_reason_check" CHECK ((("btrim"("reason") <> ''::"text") AND ("char_length"("reason") <= 500))),
    CONSTRAINT "stock_adjustment_requests_target_check" CHECK (((("target_type" = 'ITEM'::"text") AND ("item_id" IS NOT NULL) AND ("configuration_id" IS NULL)) OR (("target_type" = 'CONFIGURATION'::"text") AND ("item_id" IS NULL) AND ("configuration_id" IS NOT NULL)))),
    CONSTRAINT "stock_adjustment_requests_target_type_check" CHECK (("target_type" = ANY (ARRAY['ITEM'::"text", 'CONFIGURATION'::"text"])))
);


ALTER TABLE "private"."stock_adjustment_requests" OWNER TO "postgres";


COMMENT ON TABLE "private"."stock_adjustment_requests" IS 'Private idempotency records for physical inventory adjustments, including no-op requests that must not create empty movement batches.';



CREATE TABLE IF NOT EXISTS "public"."assembly_operations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "batch_id" "uuid" NOT NULL,
    "configuration_id" "uuid" NOT NULL,
    "operation_type" "text" NOT NULL,
    "quantity" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "commercial_configuration_code_id" "uuid",
    "commercial_code_snapshot" "text",
    CONSTRAINT "assembly_operations_commercial_code_reference_check" CHECK ((("commercial_configuration_code_id" IS NULL) OR ("commercial_code_snapshot" IS NOT NULL))),
    CONSTRAINT "assembly_operations_commercial_code_snapshot_check" CHECK ((("commercial_code_snapshot" IS NULL) OR ("btrim"("commercial_code_snapshot") <> ''::"text"))),
    CONSTRAINT "assembly_operations_operation_type_check" CHECK (("operation_type" = ANY (ARRAY['ASSEMBLY'::"text", 'DISASSEMBLY'::"text"]))),
    CONSTRAINT "assembly_operations_quantity_check" CHECK (("quantity" > 0))
);


ALTER TABLE "public"."assembly_operations" OWNER TO "postgres";


COMMENT ON COLUMN "public"."assembly_operations"."commercial_configuration_code_id" IS 'Commercial alias selected for the operation when it still exists. The physical stock remains owned by configuration_id.';



COMMENT ON COLUMN "public"."assembly_operations"."commercial_code_snapshot" IS 'Immutable textual snapshot of the commercial alias selected for the operation.';



CREATE TABLE IF NOT EXISTS "public"."commercial_configuration_codes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "configuration_id" "uuid" NOT NULL,
    "code" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."commercial_configuration_codes" OWNER TO "postgres";


COMMENT ON TABLE "public"."commercial_configuration_codes" IS 'Commercial codes used to find a physical servo and installation kit configuration.';



CREATE TABLE IF NOT EXISTS "public"."commercial_configurations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "description" "text",
    "servo_id" "uuid" NOT NULL,
    "installation_kit_id" "uuid" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "image_path" "text",
    "minimum_stock" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "commercial_configurations_image_path_check" CHECK ((("image_path" IS NULL) OR (("image_path" = "btrim"("image_path")) AND ("image_path" ~* '^catalog/[a-z0-9][a-z0-9._-]*\.(jpg|jpeg)$'::"text") AND (POSITION(('\'::"text") IN ("image_path")) = 0) AND ("image_path" !~ '(^|/)\.\.(/|$)'::"text")))),
    CONSTRAINT "commercial_configurations_minimum_stock_check" CHECK (("minimum_stock" >= 0))
);


ALTER TABLE "public"."commercial_configurations" OWNER TO "postgres";


COMMENT ON TABLE "public"."commercial_configurations" IS 'Physical servo and installation kit configurations. Commercial codes are stored separately.';



COMMENT ON COLUMN "public"."commercial_configurations"."image_path" IS 'Object path in the private commercial-catalog-images Storage bucket for this physical commercial configuration.';



COMMENT ON COLUMN "public"."commercial_configurations"."minimum_stock" IS 'Minimum mounted quantity for the physical configuration. Zero disables minimum-stock alerts.';



CREATE TABLE IF NOT EXISTS "public"."configuration_minimum_stock_changes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "configuration_id" "uuid" NOT NULL,
    "previous_minimum_stock" integer NOT NULL,
    "new_minimum_stock" integer NOT NULL,
    "user_id" "uuid",
    "user_name_snapshot" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "configuration_minimum_stock_changes_distinct_values_check" CHECK (("previous_minimum_stock" <> "new_minimum_stock")),
    CONSTRAINT "configuration_minimum_stock_changes_new_value_check" CHECK (("new_minimum_stock" >= 0)),
    CONSTRAINT "configuration_minimum_stock_changes_previous_value_check" CHECK (("previous_minimum_stock" >= 0))
);


ALTER TABLE "public"."configuration_minimum_stock_changes" OWNER TO "postgres";


COMMENT ON TABLE "public"."configuration_minimum_stock_changes" IS 'Audit history for physical commercial-configuration minimum-stock settings. Aliases sharing a configuration share the same setting.';



CREATE TABLE IF NOT EXISTS "public"."configuration_stock_balances" (
    "configuration_id" "uuid" NOT NULL,
    "quantity" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "configuration_stock_balances_quantity_check" CHECK (("quantity" >= 0))
);


ALTER TABLE "public"."configuration_stock_balances" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."configuration_stock_movements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "batch_id" "uuid" NOT NULL,
    "configuration_id" "uuid" NOT NULL,
    "quantity_change" integer NOT NULL,
    "quantity_before" integer NOT NULL,
    "quantity_after" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "configuration_stock_movements_quantity_after_check" CHECK (("quantity_after" >= 0)),
    CONSTRAINT "configuration_stock_movements_quantity_before_check" CHECK (("quantity_before" >= 0)),
    CONSTRAINT "configuration_stock_movements_quantity_change_check" CHECK (("quantity_change" <> 0)),
    CONSTRAINT "configuration_stock_movements_quantity_consistency_check" CHECK (("quantity_after" = ("quantity_before" + "quantity_change")))
);


ALTER TABLE "public"."configuration_stock_movements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."inbound_batch_lines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "batch_id" "uuid" NOT NULL,
    "item_id" "uuid",
    "commercial_configuration_code_id" "uuid",
    "quantity" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "inbound_batch_lines_quantity_check" CHECK (("quantity" > 0)),
    CONSTRAINT "inbound_batch_lines_target_check" CHECK (("num_nonnulls"("item_id", "commercial_configuration_code_id") = 1))
);


ALTER TABLE "public"."inbound_batch_lines" OWNER TO "postgres";


COMMENT ON TABLE "public"."inbound_batch_lines" IS 'Consolidated requested lines for an inbound batch. Commercial aliases remain separate for audit.';



CREATE TABLE IF NOT EXISTS "public"."installation_kits" (
    "item_id" "uuid" NOT NULL,
    "name" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."installation_kits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "description" "text" NOT NULL,
    "item_type" "text" NOT NULL,
    "minimum_stock" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "items_item_type_check" CHECK (("item_type" = ANY (ARRAY['SERVO'::"text", 'INSTALLATION_KIT'::"text", 'REPAIR_KIT'::"text", 'LOOSE_PART'::"text"]))),
    CONSTRAINT "items_minimum_stock_check" CHECK (("minimum_stock" >= 0))
);


ALTER TABLE "public"."items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."loose_parts" (
    "item_id" "uuid" NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."loose_parts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."minimum_stock_changes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "item_id" "uuid" NOT NULL,
    "previous_minimum_stock" integer NOT NULL,
    "new_minimum_stock" integer NOT NULL,
    "user_id" "uuid",
    "user_name_snapshot" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "minimum_stock_changes_distinct_values_check" CHECK (("previous_minimum_stock" <> "new_minimum_stock")),
    CONSTRAINT "minimum_stock_changes_new_value_check" CHECK (("new_minimum_stock" >= 0)),
    CONSTRAINT "minimum_stock_changes_previous_value_check" CHECK (("previous_minimum_stock" >= 0))
);


ALTER TABLE "public"."minimum_stock_changes" OWNER TO "postgres";


COMMENT ON TABLE "public"."minimum_stock_changes" IS 'Audit history for item minimum-stock settings. These changes are catalog configuration, not physical stock movements.';



CREATE TABLE IF NOT EXISTS "public"."movement_batches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "movement_type" "text" NOT NULL,
    "source" "text" NOT NULL,
    "user_id" "uuid",
    "description" "text",
    "reversed_batch_id" "uuid",
    "occurred_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_name_snapshot" "text",
    "idempotency_key" "uuid",
    "inbound_request_payload" "jsonb",
    CONSTRAINT "movement_batches_inbound_request_payload_check" CHECK ((("inbound_request_payload" IS NULL) OR ("jsonb_typeof"("inbound_request_payload") = 'array'::"text"))),
    CONSTRAINT "movement_batches_movement_type_check" CHECK (("movement_type" = ANY (ARRAY['INBOUND'::"text", 'OUTBOUND'::"text", 'ADJUSTMENT'::"text", 'ASSEMBLY'::"text", 'DISASSEMBLY'::"text", 'REVERSAL'::"text"]))),
    CONSTRAINT "movement_batches_reversed_batch_not_self_check" CHECK ((("reversed_batch_id" IS NULL) OR ("reversed_batch_id" <> "id"))),
    CONSTRAINT "movement_batches_source_check" CHECK (("source" = ANY (ARRAY['MANUAL'::"text", 'AI_CHAT'::"text", 'ORDER_PHOTO'::"text"])))
);


ALTER TABLE "public"."movement_batches" OWNER TO "postgres";


COMMENT ON COLUMN "public"."movement_batches"."inbound_request_payload" IS 'Normalized original request used to preserve mixed inbound idempotency when a new loose part is resolved to an item.';



CREATE TABLE IF NOT EXISTS "public"."outbound_batch_lines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "batch_id" "uuid" NOT NULL,
    "item_id" "uuid",
    "commercial_configuration_code_id" "uuid",
    "quantity" integer NOT NULL,
    "assembled_quantity_used" integer DEFAULT 0 NOT NULL,
    "auto_assembled_quantity" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "outbound_batch_lines_allocation_check" CHECK (((("item_id" IS NOT NULL) AND ("assembled_quantity_used" = 0) AND ("auto_assembled_quantity" = 0)) OR (("commercial_configuration_code_id" IS NOT NULL) AND ((("assembled_quantity_used")::bigint + ("auto_assembled_quantity")::bigint) = ("quantity")::bigint)))),
    CONSTRAINT "outbound_batch_lines_assembled_quantity_used_check" CHECK ((("assembled_quantity_used" >= 0) AND ("assembled_quantity_used" <= "quantity"))),
    CONSTRAINT "outbound_batch_lines_auto_assembled_quantity_check" CHECK ((("auto_assembled_quantity" >= 0) AND ("auto_assembled_quantity" <= "quantity"))),
    CONSTRAINT "outbound_batch_lines_quantity_check" CHECK (("quantity" > 0)),
    CONSTRAINT "outbound_batch_lines_target_check" CHECK (("num_nonnulls"("item_id", "commercial_configuration_code_id") = 1))
);


ALTER TABLE "public"."outbound_batch_lines" OWNER TO "postgres";


COMMENT ON TABLE "public"."outbound_batch_lines" IS 'Consolidated requested lines for an outbound batch. Commercial aliases remain separate for audit and statistics.';



CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "name" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."repair_kits" (
    "item_id" "uuid" NOT NULL,
    "name" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."repair_kits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."servo_models" (
    "item_id" "uuid" NOT NULL,
    "model" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."servo_models" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."servo_repair_compatibility" (
    "servo_id" "uuid" NOT NULL,
    "repair_kit_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."servo_repair_compatibility" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stock_balances" (
    "item_id" "uuid" NOT NULL,
    "quantity" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "stock_balances_quantity_check" CHECK (("quantity" >= 0))
);


ALTER TABLE "public"."stock_balances" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stock_movements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "batch_id" "uuid" NOT NULL,
    "item_id" "uuid" NOT NULL,
    "quantity_change" integer NOT NULL,
    "quantity_before" integer NOT NULL,
    "quantity_after" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "stock_movements_quantity_after_check" CHECK (("quantity_after" >= 0)),
    CONSTRAINT "stock_movements_quantity_before_check" CHECK (("quantity_before" >= 0)),
    CONSTRAINT "stock_movements_quantity_change_check" CHECK (("quantity_change" <> 0)),
    CONSTRAINT "stock_movements_quantity_consistency_check" CHECK (("quantity_after" = ("quantity_before" + "quantity_change")))
);


ALTER TABLE "public"."stock_movements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."supplier_order_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "supplier_order_id" "uuid" NOT NULL,
    "supplier_order_item_id" "uuid",
    "event_type" "text" NOT NULL,
    "user_id" "uuid",
    "user_name_snapshot" "text" NOT NULL,
    "idempotency_key" "uuid" NOT NULL,
    "previous_quantity" integer,
    "new_quantity" integer,
    "quantity_delta" integer,
    "description" "text",
    "details" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "supplier_order_events_description_check" CHECK ((("description" IS NULL) OR (("description" = "btrim"("description")) AND (("char_length"("description") >= 1) AND ("char_length"("description") <= 2000))))),
    CONSTRAINT "supplier_order_events_details_check" CHECK ((("details" IS NULL) OR ("jsonb_typeof"("details") = 'object'::"text"))),
    CONSTRAINT "supplier_order_events_item_event_check" CHECK (((("event_type" = 'PICKED_QUANTITY_CHANGED'::"text") AND ("supplier_order_item_id" IS NOT NULL) AND ("previous_quantity" IS NOT NULL)) OR (("event_type" <> 'PICKED_QUANTITY_CHANGED'::"text") AND ("supplier_order_item_id" IS NULL) AND ("previous_quantity" IS NULL)))),
    CONSTRAINT "supplier_order_events_quantities_check" CHECK (((("previous_quantity" IS NULL) AND ("new_quantity" IS NULL) AND ("quantity_delta" IS NULL)) OR (("previous_quantity" IS NOT NULL) AND ("new_quantity" IS NOT NULL) AND ("quantity_delta" IS NOT NULL) AND ("previous_quantity" >= 0) AND ("new_quantity" >= 0) AND ("quantity_delta" = ("new_quantity" - "previous_quantity"))))),
    CONSTRAINT "supplier_order_events_type_check" CHECK (("event_type" = ANY (ARRAY['ORDER_CREATED'::"text", 'ORDER_HEADER_UPDATED'::"text", 'ORDER_ITEMS_UPDATED'::"text", 'PICKED_QUANTITY_CHANGED'::"text", 'ALL_ITEMS_MARKED_PICKED'::"text", 'ORDER_CANCELLED'::"text", 'REMAINING_QUANTITY_CANCELLED'::"text", 'STOCK_ENTRY_CREATED'::"text", 'ORDER_FINALIZED'::"text"]))),
    CONSTRAINT "supplier_order_events_user_snapshot_check" CHECK (("btrim"("user_name_snapshot") <> ''::"text"))
);


ALTER TABLE "public"."supplier_order_events" OWNER TO "postgres";


COMMENT ON TABLE "public"."supplier_order_events" IS 'Immutable audit trail and per-user idempotency ledger for supplier-order operations.';



CREATE TABLE IF NOT EXISTS "public"."supplier_order_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "supplier_order_id" "uuid" NOT NULL,
    "item_id" "uuid",
    "commercial_configuration_id" "uuid",
    "commercial_configuration_code_id" "uuid",
    "code_snapshot" "text" NOT NULL,
    "description_snapshot" "text" NOT NULL,
    "model_snapshot" "text",
    "item_type_snapshot" "text" NOT NULL,
    "commercial_code_snapshot" "text",
    "ordered_quantity" integer NOT NULL,
    "picked_quantity" integer DEFAULT 0 NOT NULL,
    "stocked_quantity" integer DEFAULT 0 NOT NULL,
    "cancelled_quantity" integer DEFAULT 0 NOT NULL,
    "position" integer NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "supplier_order_items_closed_quantity_check" CHECK ((("picked_quantity" + "cancelled_quantity") <= "ordered_quantity")),
    CONSTRAINT "supplier_order_items_commercial_code_target_check" CHECK (((("item_id" IS NOT NULL) AND ("commercial_configuration_code_id" IS NULL) AND ("commercial_code_snapshot" IS NULL)) OR (("commercial_configuration_id" IS NOT NULL) AND ((("commercial_configuration_code_id" IS NULL) AND ("commercial_code_snapshot" IS NULL)) OR (("commercial_configuration_code_id" IS NOT NULL) AND ("commercial_code_snapshot" IS NOT NULL) AND ("btrim"("commercial_code_snapshot") <> ''::"text")))))),
    CONSTRAINT "supplier_order_items_notes_check" CHECK ((("notes" IS NULL) OR (("notes" = "btrim"("notes")) AND (("char_length"("notes") >= 1) AND ("char_length"("notes") <= 1000))))),
    CONSTRAINT "supplier_order_items_ordered_quantity_check" CHECK (("ordered_quantity" > 0)),
    CONSTRAINT "supplier_order_items_position_check" CHECK (("position" >= 0)),
    CONSTRAINT "supplier_order_items_quantities_nonnegative_check" CHECK ((("picked_quantity" >= 0) AND ("stocked_quantity" >= 0) AND ("cancelled_quantity" >= 0))),
    CONSTRAINT "supplier_order_items_snapshots_check" CHECK ((("btrim"("code_snapshot") <> ''::"text") AND ("btrim"("description_snapshot") <> ''::"text") AND (("model_snapshot" IS NULL) OR ("btrim"("model_snapshot") <> ''::"text")) AND ("item_type_snapshot" = ANY (ARRAY['SERVO'::"text", 'INSTALLATION_KIT'::"text", 'REPAIR_KIT'::"text", 'LOOSE_PART'::"text", 'COMMERCIAL_CONFIGURATION'::"text"])))),
    CONSTRAINT "supplier_order_items_stocked_not_above_picked_check" CHECK (("stocked_quantity" <= "picked_quantity")),
    CONSTRAINT "supplier_order_items_target_check" CHECK ((((("item_id" IS NOT NULL))::integer + (("commercial_configuration_id" IS NOT NULL))::integer) = 1))
);


ALTER TABLE "public"."supplier_order_items" OWNER TO "postgres";


COMMENT ON COLUMN "public"."supplier_order_items"."stocked_quantity" IS 'Total quantity entered through create_supplier_order_stock_entry. Available quantity is picked_quantity minus stocked_quantity.';



CREATE OR REPLACE VIEW "public"."supplier_order_item_details" WITH ("security_invoker"='true') AS
 SELECT "id",
    "supplier_order_id",
    "item_id",
    "commercial_configuration_id",
    "commercial_configuration_code_id",
    "code_snapshot",
    "description_snapshot",
    "model_snapshot",
    "item_type_snapshot",
    "commercial_code_snapshot",
    "ordered_quantity",
    "picked_quantity",
    "stocked_quantity",
    "cancelled_quantity",
    (("ordered_quantity" - "picked_quantity") - "cancelled_quantity") AS "waiting_pickup_quantity",
    ("picked_quantity" - "stocked_quantity") AS "waiting_stock_quantity",
    "position",
    "notes",
    "created_at",
    "updated_at"
   FROM "public"."supplier_order_items" "order_item";


ALTER VIEW "public"."supplier_order_item_details" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."supplier_order_stock_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "supplier_order_id" "uuid" NOT NULL,
    "movement_batch_id" "uuid" NOT NULL,
    "note" "text",
    "created_by" "uuid",
    "created_by_name_snapshot" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "supplier_order_stock_entries_note_check" CHECK ((("note" IS NULL) OR (("note" = "btrim"("note")) AND (("char_length"("note") >= 1) AND ("char_length"("note") <= 500))))),
    CONSTRAINT "supplier_order_stock_entries_user_snapshot_check" CHECK (("btrim"("created_by_name_snapshot") <> ''::"text"))
);


ALTER TABLE "public"."supplier_order_stock_entries" OWNER TO "postgres";


COMMENT ON TABLE "public"."supplier_order_stock_entries" IS 'Immutable link between a supplier order and the real inbound movement batch created for one partial or complete stock entry.';



CREATE TABLE IF NOT EXISTS "public"."supplier_order_stock_entry_lines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "supplier_order_stock_entry_id" "uuid" NOT NULL,
    "supplier_order_item_id" "uuid" NOT NULL,
    "inbound_batch_line_id" "uuid" NOT NULL,
    "quantity" integer NOT NULL,
    "item_id" "uuid",
    "commercial_configuration_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "supplier_order_stock_entry_lines_quantity_check" CHECK (("quantity" > 0)),
    CONSTRAINT "supplier_order_stock_entry_lines_target_check" CHECK (("num_nonnulls"("item_id", "commercial_configuration_id") = 1))
);


ALTER TABLE "public"."supplier_order_stock_entry_lines" OWNER TO "postgres";


COMMENT ON TABLE "public"."supplier_order_stock_entry_lines" IS 'Per-order-line allocation to the consolidated inbound line. The server resolves every physical target from supplier_order_items.';



CREATE OR REPLACE VIEW "public"."supplier_order_stock_entry_line_details" WITH ("security_invoker"='true') AS
 SELECT "entry_line"."id",
    "entry_line"."supplier_order_stock_entry_id",
    "entry"."supplier_order_id",
    "entry"."movement_batch_id",
    "entry"."created_at" AS "stock_entry_created_at",
    "entry_line"."supplier_order_item_id",
    "entry_line"."inbound_batch_line_id",
    "entry_line"."quantity",
    "entry_line"."item_id",
    "entry_line"."commercial_configuration_id",
    "order_item"."commercial_configuration_code_id",
    "order_item"."code_snapshot",
    "order_item"."description_snapshot",
    "order_item"."model_snapshot",
    "order_item"."item_type_snapshot",
    "order_item"."commercial_code_snapshot",
    "entry_line"."created_at"
   FROM (("public"."supplier_order_stock_entry_lines" "entry_line"
     JOIN "public"."supplier_order_stock_entries" "entry" ON (("entry"."id" = "entry_line"."supplier_order_stock_entry_id")))
     JOIN "public"."supplier_order_items" "order_item" ON (("order_item"."id" = "entry_line"."supplier_order_item_id")));


ALTER VIEW "public"."supplier_order_stock_entry_line_details" OWNER TO "postgres";


COMMENT ON VIEW "public"."supplier_order_stock_entry_line_details" IS 'Stock-entry lines with supplier-order snapshots and direct references to the real inbound audit lines.';



CREATE TABLE IF NOT EXISTS "public"."supplier_orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "negotiation_number" "text" NOT NULL,
    "order_date" "date" NOT NULL,
    "notes" "text",
    "created_by" "uuid",
    "created_by_name_snapshot" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "cancelled_at" timestamp with time zone,
    "cancelled_by" "uuid",
    "cancelled_by_name_snapshot" "text",
    "cancellation_note" "text",
    "finalized_at" timestamp with time zone,
    "finalized_by" "uuid",
    "finalized_by_name_snapshot" "text",
    "finalization_note" "text",
    CONSTRAINT "supplier_orders_cancellation_metadata_check" CHECK (((("cancelled_at" IS NULL) AND ("cancelled_by" IS NULL) AND ("cancelled_by_name_snapshot" IS NULL) AND ("cancellation_note" IS NULL)) OR (("cancelled_at" IS NOT NULL) AND ("cancelled_by_name_snapshot" IS NOT NULL) AND ("btrim"("cancelled_by_name_snapshot") <> ''::"text")))),
    CONSTRAINT "supplier_orders_cancellation_note_check" CHECK ((("cancellation_note" IS NULL) OR (("cancellation_note" = "btrim"("cancellation_note")) AND (("char_length"("cancellation_note") >= 1) AND ("char_length"("cancellation_note") <= 2000))))),
    CONSTRAINT "supplier_orders_creator_snapshot_check" CHECK (("btrim"("created_by_name_snapshot") <> ''::"text")),
    CONSTRAINT "supplier_orders_finalization_metadata_check" CHECK (((("finalized_at" IS NULL) AND ("finalized_by" IS NULL) AND ("finalized_by_name_snapshot" IS NULL) AND ("finalization_note" IS NULL)) OR (("finalized_at" IS NOT NULL) AND ("finalized_by" IS NOT NULL) AND ("finalized_by_name_snapshot" IS NOT NULL) AND ("btrim"("finalized_by_name_snapshot") <> ''::"text")))),
    CONSTRAINT "supplier_orders_finalization_note_check" CHECK ((("finalization_note" IS NULL) OR (("finalization_note" = "btrim"("finalization_note")) AND (("char_length"("finalization_note") >= 1) AND ("char_length"("finalization_note") <= 500))))),
    CONSTRAINT "supplier_orders_negotiation_number_check" CHECK ((("negotiation_number" = "btrim"("negotiation_number")) AND (("char_length"("negotiation_number") >= 1) AND ("char_length"("negotiation_number") <= 120)))),
    CONSTRAINT "supplier_orders_notes_check" CHECK ((("notes" IS NULL) OR (("notes" = "btrim"("notes")) AND (("char_length"("notes") >= 1) AND ("char_length"("notes") <= 2000))))),
    CONSTRAINT "supplier_orders_single_closure_check" CHECK ((NOT (("finalized_at" IS NOT NULL) AND ("cancelled_at" IS NOT NULL))))
);


ALTER TABLE "public"."supplier_orders" OWNER TO "postgres";


COMMENT ON TABLE "public"."supplier_orders" IS 'Supplier negotiations. Picking records collection from the supplier and never changes inventory.';



COMMENT ON COLUMN "public"."supplier_orders"."finalized_at" IS 'Manual operational closure. It does not mean that every picked unit has entered stock.';



COMMENT ON COLUMN "public"."supplier_orders"."finalized_by_name_snapshot" IS 'Immutable display-name snapshot of the user who finalized the order.';



CREATE OR REPLACE VIEW "public"."supplier_order_stock_entry_summaries" WITH ("security_invoker"='true') AS
 SELECT "entry"."id",
    "entry"."supplier_order_id",
    "supplier_order"."negotiation_number",
    "entry"."movement_batch_id",
    "batch"."movement_type",
    "batch"."source",
    "batch"."description" AS "movement_description",
    "entry"."note",
    "entry"."created_by",
    "entry"."created_by_name_snapshot",
    "entry"."created_at",
    "totals"."line_count",
    "totals"."total_quantity"
   FROM ((("public"."supplier_order_stock_entries" "entry"
     JOIN "public"."supplier_orders" "supplier_order" ON (("supplier_order"."id" = "entry"."supplier_order_id")))
     JOIN "public"."movement_batches" "batch" ON (("batch"."id" = "entry"."movement_batch_id")))
     CROSS JOIN LATERAL ( SELECT ("count"(*))::integer AS "line_count",
            COALESCE("sum"("entry_line"."quantity"), (0)::bigint) AS "total_quantity"
           FROM "public"."supplier_order_stock_entry_lines" "entry_line"
          WHERE ("entry_line"."supplier_order_stock_entry_id" = "entry"."id")) "totals");


ALTER VIEW "public"."supplier_order_stock_entry_summaries" OWNER TO "postgres";


COMMENT ON VIEW "public"."supplier_order_stock_entry_summaries" IS 'One row per supplier-order stock entry, including the linked inbound batch and aggregate quantities.';



CREATE OR REPLACE VIEW "public"."supplier_order_summaries" WITH ("security_invoker"='true') AS
 SELECT "supplier_order"."id",
    "supplier_order"."negotiation_number",
    "supplier_order"."order_date",
    "supplier_order"."notes",
    "supplier_order"."created_by",
    "supplier_order"."created_by_name_snapshot",
    "supplier_order"."created_at",
    "supplier_order"."updated_at",
    "supplier_order"."cancelled_at",
    "supplier_order"."cancelled_by",
    "supplier_order"."cancelled_by_name_snapshot",
    "supplier_order"."cancellation_note",
    "totals"."line_count",
    "totals"."ordered_quantity",
    "totals"."picked_quantity",
    "totals"."cancelled_quantity",
    "totals"."waiting_pickup_quantity",
    "totals"."stocked_quantity",
    "totals"."waiting_stock_quantity",
        CASE
            WHEN ("totals"."ordered_quantity" = 0) THEN (0)::numeric
            ELSE "round"(((("totals"."picked_quantity")::numeric * (100)::numeric) / ("totals"."ordered_quantity")::numeric), 2)
        END AS "pickup_percentage",
    "lifecycle"."status",
    "supplier_order"."finalized_at",
    "supplier_order"."finalized_by",
    "supplier_order"."finalized_by_name_snapshot",
    "supplier_order"."finalization_note",
    ("supplier_order"."finalized_at" IS NOT NULL) AS "is_finalized",
    (("supplier_order"."finalized_at" IS NULL) AND ("lifecycle"."status" <> 'CANCELLED'::"text")) AS "is_active_order",
    (("supplier_order"."finalized_at" IS NOT NULL) OR ("lifecycle"."status" = 'CANCELLED'::"text")) AS "is_in_history",
        CASE
            WHEN ("supplier_order"."finalized_at" IS NOT NULL) THEN 'FINALIZED'::"text"
            WHEN ("lifecycle"."status" = 'CANCELLED'::"text") THEN 'CANCELLED'::"text"
            ELSE NULL::"text"
        END AS "closure_kind",
        CASE
            WHEN ("supplier_order"."finalized_at" IS NOT NULL) THEN "supplier_order"."finalized_at"
            WHEN ("lifecycle"."status" = 'CANCELLED'::"text") THEN "supplier_order"."cancelled_at"
            ELSE NULL::timestamp with time zone
        END AS "closed_at",
        CASE
            WHEN ("supplier_order"."finalized_at" IS NOT NULL) THEN "supplier_order"."finalized_by_name_snapshot"
            WHEN ("lifecycle"."status" = 'CANCELLED'::"text") THEN "supplier_order"."cancelled_by_name_snapshot"
            ELSE NULL::"text"
        END AS "closed_by_name_snapshot"
   FROM (("public"."supplier_orders" "supplier_order"
     CROSS JOIN LATERAL ( SELECT ("count"(*))::integer AS "line_count",
            COALESCE("sum"("order_item"."ordered_quantity"), (0)::bigint) AS "ordered_quantity",
            COALESCE("sum"("order_item"."picked_quantity"), (0)::bigint) AS "picked_quantity",
            COALESCE("sum"("order_item"."cancelled_quantity"), (0)::bigint) AS "cancelled_quantity",
            COALESCE("sum"((("order_item"."ordered_quantity" - "order_item"."picked_quantity") - "order_item"."cancelled_quantity")), (0)::bigint) AS "waiting_pickup_quantity",
            COALESCE("sum"("order_item"."stocked_quantity"), (0)::bigint) AS "stocked_quantity",
            COALESCE("sum"(("order_item"."picked_quantity" - "order_item"."stocked_quantity")), (0)::bigint) AS "waiting_stock_quantity"
           FROM "public"."supplier_order_items" "order_item"
          WHERE ("order_item"."supplier_order_id" = "supplier_order"."id")) "totals")
     CROSS JOIN LATERAL ( SELECT
                CASE
                    WHEN ("supplier_order"."cancelled_at" IS NOT NULL) THEN 'CANCELLED'::"text"
                    WHEN (("totals"."waiting_pickup_quantity" = 0) AND ("totals"."cancelled_quantity" > 0)) THEN 'CANCELLED'::"text"
                    WHEN (("totals"."waiting_pickup_quantity" = 0) AND ("totals"."picked_quantity" > 0) AND ("totals"."cancelled_quantity" = 0)) THEN 'COMPLETED'::"text"
                    WHEN (("totals"."picked_quantity" = 0) AND ("totals"."cancelled_quantity" = 0)) THEN 'PENDING'::"text"
                    ELSE 'PARTIAL'::"text"
                END AS "status") "lifecycle");


ALTER VIEW "public"."supplier_order_summaries" OWNER TO "postgres";


COMMENT ON VIEW "public"."supplier_order_summaries" IS 'One-row-per-order totals, pickup status, and centralized active/history classification.';



ALTER TABLE ONLY "private"."configuration_operation_requests"
    ADD CONSTRAINT "configuration_operation_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "private"."stock_adjustment_requests"
    ADD CONSTRAINT "stock_adjustment_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."assembly_operations"
    ADD CONSTRAINT "assembly_operations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."commercial_configuration_codes"
    ADD CONSTRAINT "commercial_configuration_codes_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."commercial_configuration_codes"
    ADD CONSTRAINT "commercial_configuration_codes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."commercial_configurations"
    ADD CONSTRAINT "commercial_configurations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."commercial_configurations"
    ADD CONSTRAINT "commercial_configurations_servo_kit_key" UNIQUE ("servo_id", "installation_kit_id");



ALTER TABLE ONLY "public"."configuration_minimum_stock_changes"
    ADD CONSTRAINT "configuration_minimum_stock_changes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."configuration_stock_balances"
    ADD CONSTRAINT "configuration_stock_balances_pkey" PRIMARY KEY ("configuration_id");



ALTER TABLE ONLY "public"."configuration_stock_movements"
    ADD CONSTRAINT "configuration_stock_movements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inbound_batch_lines"
    ADD CONSTRAINT "inbound_batch_lines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."installation_kits"
    ADD CONSTRAINT "installation_kits_pkey" PRIMARY KEY ("item_id");



ALTER TABLE ONLY "public"."items"
    ADD CONSTRAINT "items_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."items"
    ADD CONSTRAINT "items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."loose_parts"
    ADD CONSTRAINT "loose_parts_pkey" PRIMARY KEY ("item_id");



ALTER TABLE ONLY "public"."minimum_stock_changes"
    ADD CONSTRAINT "minimum_stock_changes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."movement_batches"
    ADD CONSTRAINT "movement_batches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."outbound_batch_lines"
    ADD CONSTRAINT "outbound_batch_lines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."repair_kits"
    ADD CONSTRAINT "repair_kits_pkey" PRIMARY KEY ("item_id");



ALTER TABLE ONLY "public"."servo_models"
    ADD CONSTRAINT "servo_models_pkey" PRIMARY KEY ("item_id");



ALTER TABLE ONLY "public"."servo_repair_compatibility"
    ADD CONSTRAINT "servo_repair_compatibility_pkey" PRIMARY KEY ("servo_id", "repair_kit_id");



ALTER TABLE ONLY "public"."stock_balances"
    ADD CONSTRAINT "stock_balances_pkey" PRIMARY KEY ("item_id");



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."supplier_order_events"
    ADD CONSTRAINT "supplier_order_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."supplier_order_items"
    ADD CONSTRAINT "supplier_order_items_order_position_key" UNIQUE ("supplier_order_id", "position");



ALTER TABLE ONLY "public"."supplier_order_items"
    ADD CONSTRAINT "supplier_order_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."supplier_order_stock_entries"
    ADD CONSTRAINT "supplier_order_stock_entries_movement_batch_id_key" UNIQUE ("movement_batch_id");



ALTER TABLE ONLY "public"."supplier_order_stock_entries"
    ADD CONSTRAINT "supplier_order_stock_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."supplier_order_stock_entry_lines"
    ADD CONSTRAINT "supplier_order_stock_entry_lines_entry_item_key" UNIQUE ("supplier_order_stock_entry_id", "supplier_order_item_id");



ALTER TABLE ONLY "public"."supplier_order_stock_entry_lines"
    ADD CONSTRAINT "supplier_order_stock_entry_lines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."supplier_orders"
    ADD CONSTRAINT "supplier_orders_pkey" PRIMARY KEY ("id");



CREATE INDEX "configuration_operation_requests_commercial_code_id_idx" ON "private"."configuration_operation_requests" USING "btree" ("commercial_configuration_code_id") WHERE ("commercial_configuration_code_id" IS NOT NULL);



CREATE INDEX "configuration_operation_requests_configuration_id_idx" ON "private"."configuration_operation_requests" USING "btree" ("configuration_id");



CREATE UNIQUE INDEX "configuration_operation_requests_movement_batch_uidx" ON "private"."configuration_operation_requests" USING "btree" ("movement_batch_id") WHERE ("movement_batch_id" IS NOT NULL);



CREATE UNIQUE INDEX "configuration_operation_requests_user_key_uidx" ON "private"."configuration_operation_requests" USING "btree" ("user_id", "idempotency_key") WHERE ("user_id" IS NOT NULL);



CREATE UNIQUE INDEX "stock_adjustment_requests_movement_batch_uidx" ON "private"."stock_adjustment_requests" USING "btree" ("movement_batch_id") WHERE ("movement_batch_id" IS NOT NULL);



CREATE UNIQUE INDEX "stock_adjustment_requests_user_key_uidx" ON "private"."stock_adjustment_requests" USING "btree" ("user_id", "idempotency_key") WHERE ("user_id" IS NOT NULL);



CREATE INDEX "assembly_operations_batch_id_idx" ON "public"."assembly_operations" USING "btree" ("batch_id");



CREATE INDEX "assembly_operations_commercial_configuration_code_id_idx" ON "public"."assembly_operations" USING "btree" ("commercial_configuration_code_id") WHERE ("commercial_configuration_code_id" IS NOT NULL);



CREATE INDEX "assembly_operations_configuration_id_idx" ON "public"."assembly_operations" USING "btree" ("configuration_id");



CREATE INDEX "commercial_configuration_codes_configuration_id_idx" ON "public"."commercial_configuration_codes" USING "btree" ("configuration_id");



CREATE UNIQUE INDEX "commercial_configurations_image_path_uidx" ON "public"."commercial_configurations" USING "btree" ("image_path") WHERE ("image_path" IS NOT NULL);



CREATE INDEX "commercial_configurations_installation_kit_id_idx" ON "public"."commercial_configurations" USING "btree" ("installation_kit_id");



CREATE INDEX "configuration_minimum_stock_changes_configuration_id_idx" ON "public"."configuration_minimum_stock_changes" USING "btree" ("configuration_id");



CREATE INDEX "configuration_minimum_stock_changes_created_at_idx" ON "public"."configuration_minimum_stock_changes" USING "btree" ("created_at");



CREATE INDEX "configuration_minimum_stock_changes_user_id_idx" ON "public"."configuration_minimum_stock_changes" USING "btree" ("user_id");



CREATE INDEX "configuration_stock_movements_batch_id_idx" ON "public"."configuration_stock_movements" USING "btree" ("batch_id");



CREATE INDEX "configuration_stock_movements_configuration_id_idx" ON "public"."configuration_stock_movements" USING "btree" ("configuration_id");



CREATE INDEX "configuration_stock_movements_created_at_idx" ON "public"."configuration_stock_movements" USING "btree" ("created_at");



CREATE UNIQUE INDEX "inbound_batch_lines_batch_commercial_code_uidx" ON "public"."inbound_batch_lines" USING "btree" ("batch_id", "commercial_configuration_code_id") WHERE ("commercial_configuration_code_id" IS NOT NULL);



CREATE INDEX "inbound_batch_lines_batch_id_idx" ON "public"."inbound_batch_lines" USING "btree" ("batch_id");



CREATE UNIQUE INDEX "inbound_batch_lines_batch_item_uidx" ON "public"."inbound_batch_lines" USING "btree" ("batch_id", "item_id") WHERE ("item_id" IS NOT NULL);



CREATE INDEX "inbound_batch_lines_commercial_code_id_idx" ON "public"."inbound_batch_lines" USING "btree" ("commercial_configuration_code_id") WHERE ("commercial_configuration_code_id" IS NOT NULL);



CREATE INDEX "inbound_batch_lines_item_id_idx" ON "public"."inbound_batch_lines" USING "btree" ("item_id") WHERE ("item_id" IS NOT NULL);



CREATE INDEX "items_description_idx" ON "public"."items" USING "btree" ("description");



CREATE INDEX "minimum_stock_changes_created_at_idx" ON "public"."minimum_stock_changes" USING "btree" ("created_at");



CREATE INDEX "minimum_stock_changes_item_id_idx" ON "public"."minimum_stock_changes" USING "btree" ("item_id");



CREATE INDEX "minimum_stock_changes_user_id_idx" ON "public"."minimum_stock_changes" USING "btree" ("user_id");



CREATE INDEX "movement_batches_occurred_at_idx" ON "public"."movement_batches" USING "btree" ("occurred_at");



CREATE INDEX "movement_batches_reversed_batch_id_idx" ON "public"."movement_batches" USING "btree" ("reversed_batch_id");



CREATE UNIQUE INDEX "movement_batches_user_id_idempotency_key_uidx" ON "public"."movement_batches" USING "btree" ("user_id", "idempotency_key") WHERE ("idempotency_key" IS NOT NULL);



CREATE INDEX "movement_batches_user_id_idx" ON "public"."movement_batches" USING "btree" ("user_id");



CREATE UNIQUE INDEX "outbound_batch_lines_batch_commercial_code_uidx" ON "public"."outbound_batch_lines" USING "btree" ("batch_id", "commercial_configuration_code_id") WHERE ("commercial_configuration_code_id" IS NOT NULL);



CREATE INDEX "outbound_batch_lines_batch_id_idx" ON "public"."outbound_batch_lines" USING "btree" ("batch_id");



CREATE UNIQUE INDEX "outbound_batch_lines_batch_item_uidx" ON "public"."outbound_batch_lines" USING "btree" ("batch_id", "item_id") WHERE ("item_id" IS NOT NULL);



CREATE INDEX "outbound_batch_lines_commercial_code_id_idx" ON "public"."outbound_batch_lines" USING "btree" ("commercial_configuration_code_id") WHERE ("commercial_configuration_code_id" IS NOT NULL);



CREATE INDEX "outbound_batch_lines_item_id_idx" ON "public"."outbound_batch_lines" USING "btree" ("item_id") WHERE ("item_id" IS NOT NULL);



CREATE INDEX "servo_repair_compatibility_repair_kit_id_idx" ON "public"."servo_repair_compatibility" USING "btree" ("repair_kit_id");



CREATE INDEX "stock_movements_batch_id_idx" ON "public"."stock_movements" USING "btree" ("batch_id");



CREATE INDEX "stock_movements_created_at_idx" ON "public"."stock_movements" USING "btree" ("created_at");



CREATE INDEX "stock_movements_item_id_idx" ON "public"."stock_movements" USING "btree" ("item_id");



CREATE INDEX "supplier_order_events_item_id_idx" ON "public"."supplier_order_events" USING "btree" ("supplier_order_item_id") WHERE ("supplier_order_item_id" IS NOT NULL);



CREATE INDEX "supplier_order_events_order_created_at_idx" ON "public"."supplier_order_events" USING "btree" ("supplier_order_id", "created_at", "id");



CREATE UNIQUE INDEX "supplier_order_events_user_id_idempotency_key_uidx" ON "public"."supplier_order_events" USING "btree" ("user_id", "idempotency_key") WHERE ("user_id" IS NOT NULL);



CREATE INDEX "supplier_order_items_commercial_code_id_idx" ON "public"."supplier_order_items" USING "btree" ("commercial_configuration_code_id") WHERE ("commercial_configuration_code_id" IS NOT NULL);



CREATE INDEX "supplier_order_items_configuration_id_idx" ON "public"."supplier_order_items" USING "btree" ("commercial_configuration_id") WHERE ("commercial_configuration_id" IS NOT NULL);



CREATE INDEX "supplier_order_items_item_id_idx" ON "public"."supplier_order_items" USING "btree" ("item_id") WHERE ("item_id" IS NOT NULL);



CREATE INDEX "supplier_order_items_order_id_idx" ON "public"."supplier_order_items" USING "btree" ("supplier_order_id");



CREATE INDEX "supplier_order_stock_entries_order_created_at_idx" ON "public"."supplier_order_stock_entries" USING "btree" ("supplier_order_id", "created_at" DESC, "id");



CREATE INDEX "supplier_order_stock_entry_lines_configuration_id_idx" ON "public"."supplier_order_stock_entry_lines" USING "btree" ("commercial_configuration_id") WHERE ("commercial_configuration_id" IS NOT NULL);



CREATE INDEX "supplier_order_stock_entry_lines_inbound_line_id_idx" ON "public"."supplier_order_stock_entry_lines" USING "btree" ("inbound_batch_line_id");



CREATE INDEX "supplier_order_stock_entry_lines_item_id_idx" ON "public"."supplier_order_stock_entry_lines" USING "btree" ("item_id") WHERE ("item_id" IS NOT NULL);



CREATE INDEX "supplier_order_stock_entry_lines_order_item_id_idx" ON "public"."supplier_order_stock_entry_lines" USING "btree" ("supplier_order_item_id");



CREATE INDEX "supplier_orders_active_ordering_idx" ON "public"."supplier_orders" USING "btree" ("order_date" DESC, "created_at" DESC) WHERE (("cancelled_at" IS NULL) AND ("finalized_at" IS NULL));



CREATE INDEX "supplier_orders_cancelled_at_idx" ON "public"."supplier_orders" USING "btree" ("cancelled_at") WHERE ("cancelled_at" IS NOT NULL);



CREATE INDEX "supplier_orders_created_at_idx" ON "public"."supplier_orders" USING "btree" ("created_at" DESC);



CREATE INDEX "supplier_orders_history_ordering_idx" ON "public"."supplier_orders" USING "btree" (COALESCE("finalized_at", "cancelled_at") DESC, "order_date" DESC, "created_at" DESC) WHERE (("finalized_at" IS NOT NULL) OR ("cancelled_at" IS NOT NULL));



CREATE INDEX "supplier_orders_negotiation_number_idx" ON "public"."supplier_orders" USING "btree" ("negotiation_number");



CREATE INDEX "supplier_orders_order_date_idx" ON "public"."supplier_orders" USING "btree" ("order_date");



CREATE OR REPLACE TRIGGER "commercial_configuration_codes_protect_supplier_order_links" BEFORE UPDATE OF "configuration_id" ON "public"."commercial_configuration_codes" FOR EACH ROW WHEN (("old"."configuration_id" IS DISTINCT FROM "new"."configuration_id")) EXECUTE FUNCTION "private"."protect_supplier_order_commercial_code_links"();



CREATE OR REPLACE TRIGGER "installation_kits_enforce_item_type" BEFORE INSERT OR UPDATE OF "item_id" ON "public"."installation_kits" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_item_subtype_integrity"('INSTALLATION_KIT');



CREATE OR REPLACE TRIGGER "items_enforce_subtype_integrity" BEFORE UPDATE OF "item_type" ON "public"."items" FOR EACH ROW WHEN (("old"."item_type" IS DISTINCT FROM "new"."item_type")) EXECUTE FUNCTION "public"."enforce_item_subtype_integrity"();



CREATE OR REPLACE TRIGGER "loose_parts_enforce_item_type" BEFORE INSERT OR UPDATE OF "item_id" ON "public"."loose_parts" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_item_subtype_integrity"('LOOSE_PART');



CREATE OR REPLACE TRIGGER "repair_kits_enforce_item_type" BEFORE INSERT OR UPDATE OF "item_id" ON "public"."repair_kits" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_item_subtype_integrity"('REPAIR_KIT');



CREATE OR REPLACE TRIGGER "servo_models_enforce_item_type" BEFORE INSERT OR UPDATE OF "item_id" ON "public"."servo_models" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_item_subtype_integrity"('SERVO');



CREATE OR REPLACE TRIGGER "supplier_order_events_validate_item" BEFORE INSERT OR UPDATE OF "supplier_order_id", "supplier_order_item_id" ON "public"."supplier_order_events" FOR EACH ROW EXECUTE FUNCTION "private"."validate_supplier_order_event_item"();



CREATE OR REPLACE TRIGGER "supplier_order_items_set_snapshots_on_insert" BEFORE INSERT ON "public"."supplier_order_items" FOR EACH ROW EXECUTE FUNCTION "private"."set_supplier_order_item_snapshots"();



CREATE OR REPLACE TRIGGER "supplier_order_items_set_snapshots_on_target_update" BEFORE UPDATE OF "item_id", "commercial_configuration_id", "commercial_configuration_code_id" ON "public"."supplier_order_items" FOR EACH ROW WHEN ((("old"."item_id" IS DISTINCT FROM "new"."item_id") OR ("old"."commercial_configuration_id" IS DISTINCT FROM "new"."commercial_configuration_id") OR ("old"."commercial_configuration_code_id" IS DISTINCT FROM "new"."commercial_configuration_code_id"))) EXECUTE FUNCTION "private"."set_supplier_order_item_snapshots"();



CREATE OR REPLACE TRIGGER "supplier_order_items_touch_updated_at" BEFORE UPDATE ON "public"."supplier_order_items" FOR EACH ROW EXECUTE FUNCTION "private"."touch_supplier_order_timestamp"();



CREATE CONSTRAINT TRIGGER "supplier_order_items_validate_changed_stocked_quantity" AFTER UPDATE ON "public"."supplier_order_items" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (("old"."stocked_quantity" IS DISTINCT FROM "new"."stocked_quantity")) EXECUTE FUNCTION "private"."validate_supplier_order_stocked_quantity"();



CREATE CONSTRAINT TRIGGER "supplier_order_items_validate_initial_stocked_quantity" AFTER INSERT ON "public"."supplier_order_items" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (("new"."stocked_quantity" <> 0)) EXECUTE FUNCTION "private"."validate_supplier_order_stocked_quantity"();



CREATE CONSTRAINT TRIGGER "supplier_order_stock_entries_validate_links" AFTER INSERT OR UPDATE ON "public"."supplier_order_stock_entries" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "private"."validate_supplier_order_stock_entry_links"();



CREATE CONSTRAINT TRIGGER "supplier_order_stock_entry_lines_validate_links" AFTER INSERT OR UPDATE ON "public"."supplier_order_stock_entry_lines" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "private"."validate_supplier_order_stock_entry_links"();



CREATE OR REPLACE TRIGGER "supplier_orders_touch_updated_at" BEFORE UPDATE ON "public"."supplier_orders" FOR EACH ROW EXECUTE FUNCTION "private"."touch_supplier_order_timestamp"();



ALTER TABLE ONLY "private"."configuration_operation_requests"
    ADD CONSTRAINT "configuration_operation_reque_commercial_configuration_cod_fkey" FOREIGN KEY ("commercial_configuration_code_id") REFERENCES "public"."commercial_configuration_codes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "private"."configuration_operation_requests"
    ADD CONSTRAINT "configuration_operation_requests_configuration_id_fkey" FOREIGN KEY ("configuration_id") REFERENCES "public"."commercial_configurations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "private"."configuration_operation_requests"
    ADD CONSTRAINT "configuration_operation_requests_installation_kit_id_fkey" FOREIGN KEY ("installation_kit_id") REFERENCES "public"."items"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "private"."configuration_operation_requests"
    ADD CONSTRAINT "configuration_operation_requests_movement_batch_id_fkey" FOREIGN KEY ("movement_batch_id") REFERENCES "public"."movement_batches"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "private"."configuration_operation_requests"
    ADD CONSTRAINT "configuration_operation_requests_servo_id_fkey" FOREIGN KEY ("servo_id") REFERENCES "public"."items"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "private"."configuration_operation_requests"
    ADD CONSTRAINT "configuration_operation_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "private"."stock_adjustment_requests"
    ADD CONSTRAINT "stock_adjustment_requests_configuration_id_fkey" FOREIGN KEY ("configuration_id") REFERENCES "public"."commercial_configurations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "private"."stock_adjustment_requests"
    ADD CONSTRAINT "stock_adjustment_requests_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "private"."stock_adjustment_requests"
    ADD CONSTRAINT "stock_adjustment_requests_movement_batch_id_fkey" FOREIGN KEY ("movement_batch_id") REFERENCES "public"."movement_batches"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "private"."stock_adjustment_requests"
    ADD CONSTRAINT "stock_adjustment_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."assembly_operations"
    ADD CONSTRAINT "assembly_operations_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "public"."movement_batches"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."assembly_operations"
    ADD CONSTRAINT "assembly_operations_commercial_configuration_code_id_fkey" FOREIGN KEY ("commercial_configuration_code_id") REFERENCES "public"."commercial_configuration_codes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."assembly_operations"
    ADD CONSTRAINT "assembly_operations_configuration_id_fkey" FOREIGN KEY ("configuration_id") REFERENCES "public"."commercial_configurations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."commercial_configuration_codes"
    ADD CONSTRAINT "commercial_configuration_codes_configuration_id_fkey" FOREIGN KEY ("configuration_id") REFERENCES "public"."commercial_configurations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."commercial_configurations"
    ADD CONSTRAINT "commercial_configurations_installation_kit_id_fkey" FOREIGN KEY ("installation_kit_id") REFERENCES "public"."installation_kits"("item_id");



ALTER TABLE ONLY "public"."commercial_configurations"
    ADD CONSTRAINT "commercial_configurations_servo_id_fkey" FOREIGN KEY ("servo_id") REFERENCES "public"."servo_models"("item_id");



ALTER TABLE ONLY "public"."configuration_minimum_stock_changes"
    ADD CONSTRAINT "configuration_minimum_stock_changes_configuration_id_fkey" FOREIGN KEY ("configuration_id") REFERENCES "public"."commercial_configurations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."configuration_minimum_stock_changes"
    ADD CONSTRAINT "configuration_minimum_stock_changes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."configuration_stock_balances"
    ADD CONSTRAINT "configuration_stock_balances_configuration_id_fkey" FOREIGN KEY ("configuration_id") REFERENCES "public"."commercial_configurations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."configuration_stock_movements"
    ADD CONSTRAINT "configuration_stock_movements_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "public"."movement_batches"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."configuration_stock_movements"
    ADD CONSTRAINT "configuration_stock_movements_configuration_id_fkey" FOREIGN KEY ("configuration_id") REFERENCES "public"."commercial_configurations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."inbound_batch_lines"
    ADD CONSTRAINT "inbound_batch_lines_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "public"."movement_batches"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."inbound_batch_lines"
    ADD CONSTRAINT "inbound_batch_lines_commercial_configuration_code_id_fkey" FOREIGN KEY ("commercial_configuration_code_id") REFERENCES "public"."commercial_configuration_codes"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."inbound_batch_lines"
    ADD CONSTRAINT "inbound_batch_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."installation_kits"
    ADD CONSTRAINT "installation_kits_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."loose_parts"
    ADD CONSTRAINT "loose_parts_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."minimum_stock_changes"
    ADD CONSTRAINT "minimum_stock_changes_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."minimum_stock_changes"
    ADD CONSTRAINT "minimum_stock_changes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."movement_batches"
    ADD CONSTRAINT "movement_batches_reversed_batch_id_fkey" FOREIGN KEY ("reversed_batch_id") REFERENCES "public"."movement_batches"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."movement_batches"
    ADD CONSTRAINT "movement_batches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."outbound_batch_lines"
    ADD CONSTRAINT "outbound_batch_lines_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "public"."movement_batches"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."outbound_batch_lines"
    ADD CONSTRAINT "outbound_batch_lines_commercial_configuration_code_id_fkey" FOREIGN KEY ("commercial_configuration_code_id") REFERENCES "public"."commercial_configuration_codes"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."outbound_batch_lines"
    ADD CONSTRAINT "outbound_batch_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."repair_kits"
    ADD CONSTRAINT "repair_kits_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."servo_models"
    ADD CONSTRAINT "servo_models_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."servo_repair_compatibility"
    ADD CONSTRAINT "servo_repair_compatibility_repair_kit_id_fkey" FOREIGN KEY ("repair_kit_id") REFERENCES "public"."repair_kits"("item_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."servo_repair_compatibility"
    ADD CONSTRAINT "servo_repair_compatibility_servo_id_fkey" FOREIGN KEY ("servo_id") REFERENCES "public"."servo_models"("item_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stock_balances"
    ADD CONSTRAINT "stock_balances_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "public"."movement_batches"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."supplier_order_events"
    ADD CONSTRAINT "supplier_order_events_supplier_order_id_fkey" FOREIGN KEY ("supplier_order_id") REFERENCES "public"."supplier_orders"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."supplier_order_events"
    ADD CONSTRAINT "supplier_order_events_supplier_order_item_id_fkey" FOREIGN KEY ("supplier_order_item_id") REFERENCES "public"."supplier_order_items"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."supplier_order_events"
    ADD CONSTRAINT "supplier_order_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."supplier_order_items"
    ADD CONSTRAINT "supplier_order_items_commercial_configuration_code_id_fkey" FOREIGN KEY ("commercial_configuration_code_id") REFERENCES "public"."commercial_configuration_codes"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."supplier_order_items"
    ADD CONSTRAINT "supplier_order_items_commercial_configuration_id_fkey" FOREIGN KEY ("commercial_configuration_id") REFERENCES "public"."commercial_configurations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."supplier_order_items"
    ADD CONSTRAINT "supplier_order_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."supplier_order_items"
    ADD CONSTRAINT "supplier_order_items_supplier_order_id_fkey" FOREIGN KEY ("supplier_order_id") REFERENCES "public"."supplier_orders"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."supplier_order_stock_entries"
    ADD CONSTRAINT "supplier_order_stock_entries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."supplier_order_stock_entries"
    ADD CONSTRAINT "supplier_order_stock_entries_movement_batch_id_fkey" FOREIGN KEY ("movement_batch_id") REFERENCES "public"."movement_batches"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."supplier_order_stock_entries"
    ADD CONSTRAINT "supplier_order_stock_entries_supplier_order_id_fkey" FOREIGN KEY ("supplier_order_id") REFERENCES "public"."supplier_orders"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."supplier_order_stock_entry_lines"
    ADD CONSTRAINT "supplier_order_stock_entry_li_supplier_order_stock_entry_i_fkey" FOREIGN KEY ("supplier_order_stock_entry_id") REFERENCES "public"."supplier_order_stock_entries"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."supplier_order_stock_entry_lines"
    ADD CONSTRAINT "supplier_order_stock_entry_lin_commercial_configuration_id_fkey" FOREIGN KEY ("commercial_configuration_id") REFERENCES "public"."commercial_configurations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."supplier_order_stock_entry_lines"
    ADD CONSTRAINT "supplier_order_stock_entry_lines_inbound_batch_line_id_fkey" FOREIGN KEY ("inbound_batch_line_id") REFERENCES "public"."inbound_batch_lines"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."supplier_order_stock_entry_lines"
    ADD CONSTRAINT "supplier_order_stock_entry_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."supplier_order_stock_entry_lines"
    ADD CONSTRAINT "supplier_order_stock_entry_lines_supplier_order_item_id_fkey" FOREIGN KEY ("supplier_order_item_id") REFERENCES "public"."supplier_order_items"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."supplier_orders"
    ADD CONSTRAINT "supplier_orders_cancelled_by_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."supplier_orders"
    ADD CONSTRAINT "supplier_orders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."supplier_orders"
    ADD CONSTRAINT "supplier_orders_finalized_by_fkey" FOREIGN KEY ("finalized_by") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE "public"."assembly_operations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "assembly_operations_select_active_users" ON "public"."assembly_operations" FOR SELECT TO "authenticated" USING (( SELECT "private"."is_active_profile"() AS "is_active_profile"));



ALTER TABLE "public"."commercial_configuration_codes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "commercial_configuration_codes_select_active_users" ON "public"."commercial_configuration_codes" FOR SELECT TO "authenticated" USING (( SELECT "private"."is_active_profile"() AS "is_active_profile"));



ALTER TABLE "public"."commercial_configurations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "commercial_configurations_select_active_users" ON "public"."commercial_configurations" FOR SELECT TO "authenticated" USING (( SELECT "private"."is_active_profile"() AS "is_active_profile"));



ALTER TABLE "public"."configuration_minimum_stock_changes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "configuration_minimum_stock_changes_select_active_users" ON "public"."configuration_minimum_stock_changes" FOR SELECT TO "authenticated" USING (( SELECT "private"."is_active_profile"() AS "is_active_profile"));



ALTER TABLE "public"."configuration_stock_balances" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "configuration_stock_balances_select_active_users" ON "public"."configuration_stock_balances" FOR SELECT TO "authenticated" USING (( SELECT "private"."is_active_profile"() AS "is_active_profile"));



ALTER TABLE "public"."configuration_stock_movements" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "configuration_stock_movements_select_active_users" ON "public"."configuration_stock_movements" FOR SELECT TO "authenticated" USING (( SELECT "private"."is_active_profile"() AS "is_active_profile"));



ALTER TABLE "public"."inbound_batch_lines" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "inbound_batch_lines_select_active_users" ON "public"."inbound_batch_lines" FOR SELECT TO "authenticated" USING (( SELECT "private"."is_active_profile"() AS "is_active_profile"));



ALTER TABLE "public"."installation_kits" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "installation_kits_select_active_users" ON "public"."installation_kits" FOR SELECT TO "authenticated" USING (( SELECT "private"."is_active_profile"() AS "is_active_profile"));



ALTER TABLE "public"."items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "items_select_active_users" ON "public"."items" FOR SELECT TO "authenticated" USING (( SELECT "private"."is_active_profile"() AS "is_active_profile"));



ALTER TABLE "public"."loose_parts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "loose_parts_select_active_users" ON "public"."loose_parts" FOR SELECT TO "authenticated" USING (( SELECT "private"."is_active_profile"() AS "is_active_profile"));



ALTER TABLE "public"."minimum_stock_changes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "minimum_stock_changes_select_active_users" ON "public"."minimum_stock_changes" FOR SELECT TO "authenticated" USING (( SELECT "private"."is_active_profile"() AS "is_active_profile"));



ALTER TABLE "public"."movement_batches" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "movement_batches_select_active_users" ON "public"."movement_batches" FOR SELECT TO "authenticated" USING (( SELECT "private"."is_active_profile"() AS "is_active_profile"));



ALTER TABLE "public"."outbound_batch_lines" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "outbound_batch_lines_select_active_users" ON "public"."outbound_batch_lines" FOR SELECT TO "authenticated" USING (( SELECT "private"."is_active_profile"() AS "is_active_profile"));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_select_active_users" ON "public"."profiles" FOR SELECT TO "authenticated" USING (( SELECT "private"."is_active_profile"() AS "is_active_profile"));



ALTER TABLE "public"."repair_kits" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "repair_kits_select_active_users" ON "public"."repair_kits" FOR SELECT TO "authenticated" USING (( SELECT "private"."is_active_profile"() AS "is_active_profile"));



ALTER TABLE "public"."servo_models" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "servo_models_select_active_users" ON "public"."servo_models" FOR SELECT TO "authenticated" USING (( SELECT "private"."is_active_profile"() AS "is_active_profile"));



ALTER TABLE "public"."servo_repair_compatibility" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "servo_repair_compatibility_select_active_users" ON "public"."servo_repair_compatibility" FOR SELECT TO "authenticated" USING (( SELECT "private"."is_active_profile"() AS "is_active_profile"));



ALTER TABLE "public"."stock_balances" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "stock_balances_select_active_users" ON "public"."stock_balances" FOR SELECT TO "authenticated" USING (( SELECT "private"."is_active_profile"() AS "is_active_profile"));



ALTER TABLE "public"."stock_movements" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "stock_movements_select_active_users" ON "public"."stock_movements" FOR SELECT TO "authenticated" USING (( SELECT "private"."is_active_profile"() AS "is_active_profile"));



ALTER TABLE "public"."supplier_order_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "supplier_order_events_select_active_users" ON "public"."supplier_order_events" FOR SELECT TO "authenticated" USING (( SELECT "private"."is_active_profile"() AS "is_active_profile"));



ALTER TABLE "public"."supplier_order_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "supplier_order_items_select_active_users" ON "public"."supplier_order_items" FOR SELECT TO "authenticated" USING (( SELECT "private"."is_active_profile"() AS "is_active_profile"));



ALTER TABLE "public"."supplier_order_stock_entries" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "supplier_order_stock_entries_select_active_users" ON "public"."supplier_order_stock_entries" FOR SELECT TO "authenticated" USING (( SELECT "private"."is_active_profile"() AS "is_active_profile"));



ALTER TABLE "public"."supplier_order_stock_entry_lines" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "supplier_order_stock_entry_lines_select_active_users" ON "public"."supplier_order_stock_entry_lines" FOR SELECT TO "authenticated" USING (( SELECT "private"."is_active_profile"() AS "is_active_profile"));



ALTER TABLE "public"."supplier_orders" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "supplier_orders_select_active_users" ON "public"."supplier_orders" FOR SELECT TO "authenticated" USING (( SELECT "private"."is_active_profile"() AS "is_active_profile"));



GRANT USAGE ON SCHEMA "private" TO "authenticated";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "private"."adjust_inventory_stock"("p_target_type" "text", "p_target_id" "uuid", "p_counted_quantity" integer, "p_reason" "text", "p_idempotency_key" "uuid", "p_user_id" "uuid", "p_user_name" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."assemble_commercial_configuration"("p_configuration_id" "uuid", "p_quantity" integer, "p_user_id" "uuid", "p_source" "text", "p_description" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."assemble_commercial_configuration"("p_configuration_id" "uuid", "p_quantity" integer, "p_user_id" "uuid", "p_source" "text", "p_description" "text") TO "service_role";



REVOKE ALL ON FUNCTION "private"."cancel_supplier_order"("p_supplier_order_id" "uuid", "p_cancellation_note" "text", "p_idempotency_key" "uuid", "p_user_id" "uuid", "p_user_name" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."cancel_supplier_order_remaining"("p_supplier_order_id" "uuid", "p_cancellation_note" "text", "p_idempotency_key" "uuid", "p_user_id" "uuid", "p_user_name" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."create_supplier_order"("p_negotiation_number" "text", "p_order_date" "date", "p_notes" "text", "p_lines" "jsonb", "p_idempotency_key" "uuid", "p_user_id" "uuid", "p_user_name" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."create_supplier_order_stock_entry"("p_supplier_order_id" "uuid", "p_lines" "jsonb", "p_note" "text", "p_expected_updated_at" timestamp with time zone, "p_idempotency_key" "uuid", "p_user_id" "uuid", "p_user_name" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."disassemble_commercial_configuration"("p_configuration_id" "uuid", "p_quantity" integer, "p_user_id" "uuid", "p_source" "text", "p_description" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."disassemble_commercial_configuration"("p_configuration_id" "uuid", "p_quantity" integer, "p_user_id" "uuid", "p_source" "text", "p_description" "text") TO "service_role";



REVOKE ALL ON FUNCTION "private"."execute_configuration_operation"("p_operation_type" "text", "p_configuration_id" "uuid", "p_quantity" integer, "p_idempotency_key" "uuid", "p_commercial_code" "text", "p_description" "text", "p_user_id" "uuid", "p_user_name" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."finalize_supplier_order"("p_supplier_order_id" "uuid", "p_expected_updated_at" timestamp with time zone, "p_finalization_note" "text", "p_idempotency_key" "uuid", "p_user_id" "uuid", "p_user_name" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."is_active_profile"() FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."is_active_profile"() TO "authenticated";



REVOKE ALL ON FUNCTION "private"."mark_supplier_order_all_picked"("p_supplier_order_id" "uuid", "p_description" "text", "p_idempotency_key" "uuid", "p_user_id" "uuid", "p_user_name" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."mark_supplier_order_all_picked_checked"("p_supplier_order_id" "uuid", "p_description" "text", "p_expected_order_updated_at" timestamp with time zone, "p_idempotency_key" "uuid", "p_user_id" "uuid", "p_user_name" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."normalize_supplier_order_lines"("p_lines" "jsonb", "p_allow_existing_ids" boolean) FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."normalize_supplier_order_stock_entry_lines"("p_lines" "jsonb") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."protect_supplier_order_commercial_code_links"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."require_supplier_order_user"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."set_configuration_minimum_stock"("p_configuration_id" "uuid", "p_minimum_stock" integer, "p_user_id" "uuid", "p_user_name" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."set_item_minimum_stock"("p_item_id" "uuid", "p_minimum_stock" integer, "p_user_id" "uuid", "p_user_name" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."set_supplier_order_item_picked_quantity"("p_supplier_order_item_id" "uuid", "p_picked_quantity" integer, "p_description" "text", "p_idempotency_key" "uuid", "p_user_id" "uuid", "p_user_name" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."set_supplier_order_item_picked_quantity_checked"("p_supplier_order_item_id" "uuid", "p_target_picked_quantity" integer, "p_description" "text", "p_expected_order_updated_at" timestamp with time zone, "p_idempotency_key" "uuid", "p_user_id" "uuid", "p_user_name" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."set_supplier_order_item_snapshots"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."stock_inbound_item"("p_item_id" "uuid", "p_quantity" integer, "p_user_id" "uuid", "p_source" "text", "p_description" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."stock_inbound_item"("p_item_id" "uuid", "p_quantity" integer, "p_user_id" "uuid", "p_source" "text", "p_description" "text") TO "service_role";



REVOKE ALL ON FUNCTION "private"."stock_inbound_items"("p_items" "jsonb", "p_idempotency_key" "uuid", "p_user_id" "uuid", "p_user_name" "text", "p_description" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."stock_inbound_lines"("p_lines" "jsonb", "p_idempotency_key" "uuid", "p_user_id" "uuid", "p_user_name" "text", "p_description" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."stock_inbound_lines_with_loose_parts"("p_lines" "jsonb", "p_idempotency_key" "uuid", "p_user_id" "uuid", "p_user_name" "text", "p_description" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."stock_outbound_item"("p_item_id" "uuid", "p_quantity" integer, "p_user_id" "uuid", "p_source" "text", "p_description" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."stock_outbound_item"("p_item_id" "uuid", "p_quantity" integer, "p_user_id" "uuid", "p_source" "text", "p_description" "text") TO "service_role";



REVOKE ALL ON FUNCTION "private"."stock_outbound_items"("p_lines" "jsonb", "p_idempotency_key" "uuid", "p_user_id" "uuid", "p_user_name" "text", "p_description" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."supplier_order_catalog_snapshot"("p_item_id" "uuid", "p_configuration_id" "uuid", "p_commercial_code_id" "uuid", "p_require_active" boolean) FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."supplier_order_existing_result"("p_user_id" "uuid", "p_idempotency_key" "uuid", "p_event_type" "text", "p_request" "jsonb") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."supplier_order_result"("p_supplier_order_id" "uuid") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."touch_supplier_order_timestamp"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."update_supplier_order"("p_supplier_order_id" "uuid", "p_expected_updated_at" timestamp with time zone, "p_negotiation_number" "text", "p_order_date" "date", "p_notes" "text", "p_lines" "jsonb", "p_idempotency_key" "uuid", "p_user_id" "uuid", "p_user_name" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."validate_supplier_order_event_item"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."validate_supplier_order_stock_entry_links"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."validate_supplier_order_stocked_quantity"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."adjust_configuration_stock"("p_configuration_id" "uuid", "p_counted_quantity" integer, "p_reason" "text", "p_idempotency_key" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."adjust_configuration_stock"("p_configuration_id" "uuid", "p_counted_quantity" integer, "p_reason" "text", "p_idempotency_key" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."adjust_configuration_stock"("p_configuration_id" "uuid", "p_counted_quantity" integer, "p_reason" "text", "p_idempotency_key" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."adjust_item_stock"("p_item_id" "uuid", "p_counted_quantity" integer, "p_reason" "text", "p_idempotency_key" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."adjust_item_stock"("p_item_id" "uuid", "p_counted_quantity" integer, "p_reason" "text", "p_idempotency_key" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."adjust_item_stock"("p_item_id" "uuid", "p_counted_quantity" integer, "p_reason" "text", "p_idempotency_key" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."assemble_commercial_configuration"("p_configuration_id" "uuid", "p_quantity" integer, "p_idempotency_key" "uuid", "p_commercial_code" "text", "p_description" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."assemble_commercial_configuration"("p_configuration_id" "uuid", "p_quantity" integer, "p_idempotency_key" "uuid", "p_commercial_code" "text", "p_description" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."assemble_commercial_configuration"("p_configuration_id" "uuid", "p_quantity" integer, "p_idempotency_key" "uuid", "p_commercial_code" "text", "p_description" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."cancel_supplier_order"("p_supplier_order_id" "uuid", "p_cancellation_note" "text", "p_idempotency_key" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cancel_supplier_order"("p_supplier_order_id" "uuid", "p_cancellation_note" "text", "p_idempotency_key" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."cancel_supplier_order"("p_supplier_order_id" "uuid", "p_cancellation_note" "text", "p_idempotency_key" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."cancel_supplier_order_remaining"("p_supplier_order_id" "uuid", "p_cancellation_note" "text", "p_idempotency_key" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cancel_supplier_order_remaining"("p_supplier_order_id" "uuid", "p_cancellation_note" "text", "p_idempotency_key" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."cancel_supplier_order_remaining"("p_supplier_order_id" "uuid", "p_cancellation_note" "text", "p_idempotency_key" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_supplier_order"("p_negotiation_number" "text", "p_order_date" "date", "p_notes" "text", "p_lines" "jsonb", "p_idempotency_key" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_supplier_order"("p_negotiation_number" "text", "p_order_date" "date", "p_notes" "text", "p_lines" "jsonb", "p_idempotency_key" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."create_supplier_order"("p_negotiation_number" "text", "p_order_date" "date", "p_notes" "text", "p_lines" "jsonb", "p_idempotency_key" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_supplier_order_stock_entry"("p_supplier_order_id" "uuid", "p_lines" "jsonb", "p_note" "text", "p_expected_updated_at" timestamp with time zone, "p_idempotency_key" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_supplier_order_stock_entry"("p_supplier_order_id" "uuid", "p_lines" "jsonb", "p_note" "text", "p_expected_updated_at" timestamp with time zone, "p_idempotency_key" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."create_supplier_order_stock_entry"("p_supplier_order_id" "uuid", "p_lines" "jsonb", "p_note" "text", "p_expected_updated_at" timestamp with time zone, "p_idempotency_key" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."disassemble_commercial_configuration"("p_configuration_id" "uuid", "p_quantity" integer, "p_idempotency_key" "uuid", "p_commercial_code" "text", "p_description" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."disassemble_commercial_configuration"("p_configuration_id" "uuid", "p_quantity" integer, "p_idempotency_key" "uuid", "p_commercial_code" "text", "p_description" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."disassemble_commercial_configuration"("p_configuration_id" "uuid", "p_quantity" integer, "p_idempotency_key" "uuid", "p_commercial_code" "text", "p_description" "text") TO "authenticated";



GRANT ALL ON FUNCTION "public"."enforce_item_subtype_integrity"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_item_subtype_integrity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_item_subtype_integrity"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."finalize_supplier_order"("p_supplier_order_id" "uuid", "p_expected_updated_at" timestamp with time zone, "p_finalization_note" "text", "p_idempotency_key" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_supplier_order"("p_supplier_order_id" "uuid", "p_expected_updated_at" timestamp with time zone, "p_finalization_note" "text", "p_idempotency_key" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."finalize_supplier_order"("p_supplier_order_id" "uuid", "p_expected_updated_at" timestamp with time zone, "p_finalization_note" "text", "p_idempotency_key" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."mark_supplier_order_all_picked"("p_supplier_order_id" "uuid", "p_description" "text", "p_idempotency_key" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_supplier_order_all_picked"("p_supplier_order_id" "uuid", "p_description" "text", "p_idempotency_key" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."mark_supplier_order_all_picked"("p_supplier_order_id" "uuid", "p_description" "text", "p_idempotency_key" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."mark_supplier_order_all_picked_checked"("p_supplier_order_id" "uuid", "p_description" "text", "p_expected_order_updated_at" timestamp with time zone, "p_idempotency_key" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_supplier_order_all_picked_checked"("p_supplier_order_id" "uuid", "p_description" "text", "p_expected_order_updated_at" timestamp with time zone, "p_idempotency_key" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."mark_supplier_order_all_picked_checked"("p_supplier_order_id" "uuid", "p_description" "text", "p_expected_order_updated_at" timestamp with time zone, "p_idempotency_key" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."set_configuration_minimum_stock"("p_configuration_id" "uuid", "p_minimum_stock" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_configuration_minimum_stock"("p_configuration_id" "uuid", "p_minimum_stock" integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."set_configuration_minimum_stock"("p_configuration_id" "uuid", "p_minimum_stock" integer) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."set_item_minimum_stock"("p_item_id" "uuid", "p_minimum_stock" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_item_minimum_stock"("p_item_id" "uuid", "p_minimum_stock" integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."set_item_minimum_stock"("p_item_id" "uuid", "p_minimum_stock" integer) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."set_supplier_order_item_picked_quantity"("p_supplier_order_item_id" "uuid", "p_picked_quantity" integer, "p_description" "text", "p_idempotency_key" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_supplier_order_item_picked_quantity"("p_supplier_order_item_id" "uuid", "p_picked_quantity" integer, "p_description" "text", "p_idempotency_key" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."set_supplier_order_item_picked_quantity"("p_supplier_order_item_id" "uuid", "p_picked_quantity" integer, "p_description" "text", "p_idempotency_key" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."set_supplier_order_item_picked_quantity_checked"("p_supplier_order_item_id" "uuid", "p_target_picked_quantity" integer, "p_description" "text", "p_expected_order_updated_at" timestamp with time zone, "p_idempotency_key" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_supplier_order_item_picked_quantity_checked"("p_supplier_order_item_id" "uuid", "p_target_picked_quantity" integer, "p_description" "text", "p_expected_order_updated_at" timestamp with time zone, "p_idempotency_key" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."set_supplier_order_item_picked_quantity_checked"("p_supplier_order_item_id" "uuid", "p_target_picked_quantity" integer, "p_description" "text", "p_expected_order_updated_at" timestamp with time zone, "p_idempotency_key" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."stock_inbound_item"("p_item_id" "uuid", "p_quantity" integer, "p_source" "text", "p_description" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."stock_inbound_item"("p_item_id" "uuid", "p_quantity" integer, "p_source" "text", "p_description" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."stock_inbound_item"("p_item_id" "uuid", "p_quantity" integer, "p_source" "text", "p_description" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."stock_inbound_items"("p_items" "jsonb", "p_idempotency_key" "uuid", "p_description" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."stock_inbound_items"("p_items" "jsonb", "p_idempotency_key" "uuid", "p_description" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."stock_inbound_items"("p_items" "jsonb", "p_idempotency_key" "uuid", "p_description" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."stock_inbound_lines"("p_lines" "jsonb", "p_idempotency_key" "uuid", "p_description" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."stock_inbound_lines"("p_lines" "jsonb", "p_idempotency_key" "uuid", "p_description" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."stock_inbound_lines"("p_lines" "jsonb", "p_idempotency_key" "uuid", "p_description" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."stock_outbound_item"("p_item_id" "uuid", "p_quantity" integer, "p_source" "text", "p_description" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."stock_outbound_item"("p_item_id" "uuid", "p_quantity" integer, "p_source" "text", "p_description" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."stock_outbound_item"("p_item_id" "uuid", "p_quantity" integer, "p_source" "text", "p_description" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."stock_outbound_items"("p_lines" "jsonb", "p_idempotency_key" "uuid", "p_description" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."stock_outbound_items"("p_lines" "jsonb", "p_idempotency_key" "uuid", "p_description" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."stock_outbound_items"("p_lines" "jsonb", "p_idempotency_key" "uuid", "p_description" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."update_supplier_order"("p_supplier_order_id" "uuid", "p_expected_updated_at" timestamp with time zone, "p_negotiation_number" "text", "p_order_date" "date", "p_notes" "text", "p_lines" "jsonb", "p_idempotency_key" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_supplier_order"("p_supplier_order_id" "uuid", "p_expected_updated_at" timestamp with time zone, "p_negotiation_number" "text", "p_order_date" "date", "p_notes" "text", "p_lines" "jsonb", "p_idempotency_key" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."update_supplier_order"("p_supplier_order_id" "uuid", "p_expected_updated_at" timestamp with time zone, "p_negotiation_number" "text", "p_order_date" "date", "p_notes" "text", "p_lines" "jsonb", "p_idempotency_key" "uuid") TO "authenticated";



GRANT ALL ON TABLE "public"."assembly_operations" TO "service_role";
GRANT SELECT ON TABLE "public"."assembly_operations" TO "authenticated";



GRANT ALL ON TABLE "public"."commercial_configuration_codes" TO "service_role";
GRANT SELECT ON TABLE "public"."commercial_configuration_codes" TO "authenticated";



GRANT ALL ON TABLE "public"."commercial_configurations" TO "service_role";
GRANT SELECT ON TABLE "public"."commercial_configurations" TO "authenticated";



GRANT ALL ON TABLE "public"."configuration_minimum_stock_changes" TO "service_role";
GRANT SELECT ON TABLE "public"."configuration_minimum_stock_changes" TO "authenticated";



GRANT ALL ON TABLE "public"."configuration_stock_balances" TO "service_role";
GRANT SELECT ON TABLE "public"."configuration_stock_balances" TO "authenticated";



GRANT ALL ON TABLE "public"."configuration_stock_movements" TO "service_role";
GRANT SELECT ON TABLE "public"."configuration_stock_movements" TO "authenticated";



GRANT ALL ON TABLE "public"."inbound_batch_lines" TO "service_role";
GRANT SELECT ON TABLE "public"."inbound_batch_lines" TO "authenticated";



GRANT ALL ON TABLE "public"."installation_kits" TO "service_role";
GRANT SELECT ON TABLE "public"."installation_kits" TO "authenticated";



GRANT ALL ON TABLE "public"."items" TO "service_role";
GRANT SELECT ON TABLE "public"."items" TO "authenticated";



GRANT ALL ON TABLE "public"."loose_parts" TO "service_role";
GRANT SELECT ON TABLE "public"."loose_parts" TO "authenticated";



GRANT ALL ON TABLE "public"."minimum_stock_changes" TO "service_role";
GRANT SELECT ON TABLE "public"."minimum_stock_changes" TO "authenticated";



GRANT ALL ON TABLE "public"."movement_batches" TO "service_role";
GRANT SELECT ON TABLE "public"."movement_batches" TO "authenticated";



GRANT ALL ON TABLE "public"."outbound_batch_lines" TO "service_role";
GRANT SELECT ON TABLE "public"."outbound_batch_lines" TO "authenticated";



GRANT ALL ON TABLE "public"."profiles" TO "service_role";
GRANT SELECT ON TABLE "public"."profiles" TO "authenticated";



GRANT ALL ON TABLE "public"."repair_kits" TO "service_role";
GRANT SELECT ON TABLE "public"."repair_kits" TO "authenticated";



GRANT ALL ON TABLE "public"."servo_models" TO "service_role";
GRANT SELECT ON TABLE "public"."servo_models" TO "authenticated";



GRANT ALL ON TABLE "public"."servo_repair_compatibility" TO "service_role";
GRANT SELECT ON TABLE "public"."servo_repair_compatibility" TO "authenticated";



GRANT ALL ON TABLE "public"."stock_balances" TO "service_role";
GRANT SELECT ON TABLE "public"."stock_balances" TO "authenticated";



GRANT ALL ON TABLE "public"."stock_movements" TO "service_role";
GRANT SELECT ON TABLE "public"."stock_movements" TO "authenticated";



GRANT ALL ON TABLE "public"."supplier_order_events" TO "service_role";
GRANT SELECT ON TABLE "public"."supplier_order_events" TO "authenticated";



GRANT ALL ON TABLE "public"."supplier_order_items" TO "service_role";
GRANT SELECT ON TABLE "public"."supplier_order_items" TO "authenticated";



GRANT ALL ON TABLE "public"."supplier_order_item_details" TO "service_role";
GRANT SELECT ON TABLE "public"."supplier_order_item_details" TO "authenticated";



GRANT ALL ON TABLE "public"."supplier_order_stock_entries" TO "service_role";
GRANT SELECT ON TABLE "public"."supplier_order_stock_entries" TO "authenticated";



GRANT ALL ON TABLE "public"."supplier_order_stock_entry_lines" TO "service_role";
GRANT SELECT ON TABLE "public"."supplier_order_stock_entry_lines" TO "authenticated";



GRANT ALL ON TABLE "public"."supplier_order_stock_entry_line_details" TO "service_role";
GRANT SELECT ON TABLE "public"."supplier_order_stock_entry_line_details" TO "authenticated";



GRANT ALL ON TABLE "public"."supplier_orders" TO "service_role";
GRANT SELECT ON TABLE "public"."supplier_orders" TO "authenticated";



GRANT ALL ON TABLE "public"."supplier_order_stock_entry_summaries" TO "service_role";
GRANT SELECT ON TABLE "public"."supplier_order_stock_entry_summaries" TO "authenticated";



GRANT ALL ON TABLE "public"."supplier_order_summaries" TO "service_role";
GRANT SELECT ON TABLE "public"."supplier_order_summaries" TO "authenticated";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";

-- Supabase Local creates storage.objects. Recreate only the application-owned
-- policy; no managed Storage table or object is copied by this baseline.
CREATE POLICY "commercial_catalog_images_select_active_users"
ON "storage"."objects"
FOR SELECT
TO "authenticated"
USING (
  ("bucket_id" = 'commercial-catalog-images'::"text")
  AND "private"."is_active_profile"()
);
