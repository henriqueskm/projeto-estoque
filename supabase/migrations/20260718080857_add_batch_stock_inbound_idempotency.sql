alter table public.movement_batches
add column idempotency_key uuid;

create unique index movement_batches_user_id_idempotency_key_uidx
  on public.movement_batches (user_id, idempotency_key)
  where idempotency_key is not null;

revoke all on function public.stock_inbound_items(jsonb, text)
from public, anon, authenticated;

drop function public.stock_inbound_items(jsonb, text);

revoke all on function private.stock_inbound_items(
  jsonb,
  uuid,
  text,
  text
) from public, anon, authenticated;

drop function private.stock_inbound_items(jsonb, uuid, text, text);

create function private.stock_inbound_items(
  p_items jsonb,
  p_idempotency_key uuid,
  p_user_id uuid,
  p_user_name text,
  p_description text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
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

revoke all on function private.stock_inbound_items(
  jsonb,
  uuid,
  uuid,
  text,
  text
) from public, anon, authenticated;

create function public.stock_inbound_items(
  p_items jsonb,
  p_idempotency_key uuid,
  p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

revoke all on function public.stock_inbound_items(jsonb, uuid, text)
from public, anon, authenticated;

grant execute on function public.stock_inbound_items(jsonb, uuid, text)
to authenticated;
