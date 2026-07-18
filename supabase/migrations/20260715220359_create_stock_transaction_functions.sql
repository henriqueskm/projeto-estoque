create function public.stock_inbound_item(
  p_item_id uuid,
  p_quantity integer,
  p_user_id uuid,
  p_source text,
  p_description text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
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

create function public.stock_outbound_item(
  p_item_id uuid,
  p_quantity integer,
  p_user_id uuid,
  p_source text,
  p_description text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
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

create function public.assemble_commercial_configuration(
  p_configuration_id uuid,
  p_quantity integer,
  p_user_id uuid,
  p_source text,
  p_description text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
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

create function public.disassemble_commercial_configuration(
  p_configuration_id uuid,
  p_quantity integer,
  p_user_id uuid,
  p_source text,
  p_description text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
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
