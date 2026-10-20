-- Issue #91: preserve newly added supplier-order lines.
-- The deployed pre-fix body (whitespace-insensitive MD5) is
-- 7bffbdd9664b07987b160e4feee73c10; wrapper/auth/triggers/writers stay unchanged.
-- Forward-only. Apply remotely only after explicit human authorization.

CREATE OR REPLACE FUNCTION private.update_supplier_order(p_supplier_order_id uuid, p_expected_updated_at timestamp with time zone, p_negotiation_number text, p_order_date date, p_notes text, p_lines jsonb, p_idempotency_key uuid, p_user_id uuid, p_user_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
  v_existing_line_ids uuid[];
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

  -- Snapshot only the pre-edit identities, while holding the existing locks.
  select coalesce(array_agg(id order by id), '{}'::uuid[])
  into v_existing_line_ids
  from public.supplier_order_items
  where supplier_order_id = p_supplier_order_id;

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

    -- Newly inserted IDs are absent from p_lines by design; never delete them.
    delete from public.supplier_order_items as existing_line
    where existing_line.supplier_order_id = p_supplier_order_id
      and existing_line.id = any(v_existing_line_ids)
      and not exists (
        select 1
        from jsonb_array_elements(v_lines) as desired_line
        where nullif(desired_line ->> 'id', '')::uuid = existing_line.id
      );
  end if;

  update public.supplier_orders
  set updated_at = now()
  where id = p_supplier_order_id;

  -- Assert the requested representation BEFORE recording success/audit.
  -- Any loss, target/quantity/notes/position mismatch rolls back this transaction.
  if (select count(*) from public.supplier_order_items
      where supplier_order_id = p_supplier_order_id) <> jsonb_array_length(v_lines)
    or exists (
      select 1
      from jsonb_array_elements(v_lines) as desired_line
      left join public.supplier_order_items as persisted
        on persisted.supplier_order_id = p_supplier_order_id
        and persisted.position = (desired_line ->> 'position')::integer
      where persisted.id is null
        or (nullif(desired_line ->> 'id', '') is not null
          and persisted.id is distinct from (desired_line ->> 'id')::uuid)
        or persisted.item_id is distinct from nullif(desired_line ->> 'item_id', '')::uuid
        or persisted.commercial_configuration_id is distinct from
          nullif(desired_line ->> 'commercial_configuration_id', '')::uuid
        or persisted.commercial_configuration_code_id is distinct from
          nullif(desired_line ->> 'commercial_configuration_code_id', '')::uuid
        or persisted.ordered_quantity is distinct from (desired_line ->> 'quantity')::integer
        or persisted.notes is distinct from nullif(desired_line ->> 'notes', '')
    ) then
    raise exception using errcode = '23514',
      message = 'supplier_order_update_persistence_mismatch';
  end if;

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
$function$;

revoke all on function private.update_supplier_order(uuid, timestamptz, text, date, text, jsonb, uuid, uuid, text)
  from public, anon, authenticated, service_role;
