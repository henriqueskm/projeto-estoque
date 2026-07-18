begin;

do $$
declare
  v_now constant timestamptz := now();

  v_servo_5_id constant uuid := 'b84223d3-19cc-4861-b6f1-1c43b1dda668';
  v_servo_5inv028_id constant uuid := '52c34551-fead-4ec3-8b58-50e2d5d35e29';
  v_servo_6_id constant uuid := '3e930061-5865-479b-89d8-47f73cca376b';
  v_servo_6rb_id constant uuid := '7d65b2e0-d07c-466d-b920-ccd42b59a97f';
  v_servo_9_id constant uuid := 'f09bbe2e-8f8f-4ba2-ae92-27d9d88ac3e5';
  v_servo_9inv_id constant uuid := 'a82ee8d4-aabd-46bc-819e-9b2b3a354588';

  v_kit_31_id constant uuid := '2d46ee2f-ea66-4f43-bb69-f780c3f794ba';
  v_kit_59_id constant uuid := 'cb6e34ec-99e8-47e7-a821-38c344372a55';
  v_kit_64_id constant uuid := 'cb5baf6d-e842-4ea5-a159-3aa2a5c1a24a';
  v_kit_71_id constant uuid := 'e7cb7310-a952-4e7f-81dc-b9248148b2fd';
  v_repair_066_id constant uuid := '75be273b-f74f-4403-a8fb-bc4b7dc338e3';

  v_code_9a_id constant uuid := '8fbc18e1-8e61-4426-a80b-537e798866d6';
  v_code_9d_id constant uuid := '44d24a7d-742b-47c1-9d2c-37f3a6fa30e5';
  v_code_5z_id constant uuid := '5e27bd1e-750b-4493-a684-2febd9b7bb30';
  v_code_6p_id constant uuid := '6851b2c8-01e4-4cdd-b8a2-97b059f8d308';
  v_code_6r_id constant uuid := 'b029c1c8-54f2-49f2-a058-e8f657384990';

  v_old_configuration_9a_id constant uuid :=
    '7809b0b5-a697-4f30-8808-7475b420603d';
  v_old_configuration_5z_id constant uuid :=
    'f4653cf0-0aa1-4d61-8450-e84dbea1bfc5';
  v_old_configuration_6p_id constant uuid :=
    'f6370e18-a9c4-4a94-8b75-8b3aa5348cd7';
  v_old_configuration_6r_id constant uuid :=
    '316c0cec-8f98-409a-bbad-66f85095ef8b';

  v_configuration_9d_id constant uuid :=
    '62316df6-e0ca-4e9c-8f55-73811596b74b';
  v_configuration_5z_id constant uuid :=
    'b6aebf6f-2dd4-4288-ab56-c54e3c96adb2';
  v_configuration_6p_id constant uuid :=
    '0837fec5-6a54-4c84-a6e6-e142b34a9e22';
  v_configuration_6r_id constant uuid :=
    '2a2f5d77-bfe2-42cb-9942-cba87625b28d';

  v_5c_configuration_id uuid;
  v_5w_configuration_id uuid;
  v_9c_configuration_id uuid;
  v_source_repair_ids uuid[];
  v_source_repair_ids_after uuid[];
  v_new_repair_ids uuid[];
  v_unrelated_aliases_before jsonb;
  v_unrelated_aliases_after jsonb;
  v_affected_rows integer;
begin
  -- Prevent operational writes while the pristine-state checks are evaluated.
  lock table public.assembly_operations in share mode nowait;
  lock table public.configuration_stock_balances in share mode nowait;
  lock table public.configuration_stock_movements in share mode nowait;
  lock table public.inbound_batch_lines in share mode nowait;
  lock table public.movement_batches in share mode nowait;
  lock table public.outbound_batch_lines in share mode nowait;
  lock table public.stock_balances in share mode nowait;
  lock table public.stock_movements in share mode nowait;

  -- Lock catalog rows in a single deterministic order before validating them.
  perform item.id
  from public.items as item
  order by item.id
  for update nowait;

  perform servo.item_id
  from public.servo_models as servo
  order by servo.item_id
  for update nowait;

  perform installation_kit.item_id
  from public.installation_kits as installation_kit
  order by installation_kit.item_id
  for update nowait;

  perform repair_kit.item_id
  from public.repair_kits as repair_kit
  order by repair_kit.item_id
  for update nowait;

  perform configuration.id
  from public.commercial_configurations as configuration
  order by configuration.id
  for update nowait;

  perform commercial_code.id
  from public.commercial_configuration_codes as commercial_code
  order by commercial_code.id
  for update nowait;

  perform compatibility.servo_id
  from public.servo_repair_compatibility as compatibility
  order by compatibility.servo_id, compatibility.repair_kit_id
  for update nowait;

  if exists (select 1 from public.movement_batches)
    or exists (select 1 from public.inbound_batch_lines)
    or exists (select 1 from public.outbound_batch_lines)
    or exists (select 1 from public.stock_movements)
    or exists (select 1 from public.configuration_stock_movements)
    or exists (select 1 from public.assembly_operations)
    or exists (
      select 1
      from public.stock_balances
      where quantity <> 0
    )
    or exists (
      select 1
      from public.configuration_stock_balances
      where quantity <> 0
    ) then
    raise exception using
      errcode = '23514',
      message =
        'Commercial catalog correction aborted: operational history or nonzero balances now exist.';
  end if;

  if exists (
    select 1
    from (
      values
        (
          v_servo_5_id,
          '5',
          'SERVO MBF-040',
          'MBF-040'
        ),
        (
          v_servo_5inv028_id,
          '5INV028',
          'SERVO MBF-040 Invertido 028',
          'MBF-040 Invertido 028'
        ),
        (
          v_servo_6_id,
          '6',
          'SERVO VF-040',
          'VF-040'
        ),
        (
          v_servo_9_id,
          '9',
          'SERVO MBF-032',
          'MBF-032'
        ),
        (
          v_servo_9inv_id,
          '9INV',
          'SERVO MBF-032 Invertido 028',
          'MBF-032 Invertido 028'
        )
    ) as expected (id, code, description, model)
    left join public.items as item
      on item.id = expected.id
    left join public.servo_models as servo
      on servo.item_id = expected.id
    where item.id is null
      or item.code is distinct from expected.code
      or item.description is distinct from expected.description
      or item.item_type is distinct from 'SERVO'
      or item.minimum_stock is distinct from 0
      or item.is_active is distinct from true
      or servo.item_id is null
      or servo.model is distinct from expected.model
  ) then
    raise exception using
      errcode = '23514',
      message =
        'Commercial catalog correction aborted: an expected servo identity, model, type, or status diverged.';
  end if;

  if exists (
    select 1
    from (
      values
        (
          v_kit_31_id,
          'KT-31',
          'Kit de instalação 9A / 9D'
        ),
        (
          v_kit_59_id,
          'KT-59',
          'Kit de instalação 5Z'
        ),
        (
          v_kit_64_id,
          'KT-64',
          'Kit de instalação 6R'
        ),
        (
          v_kit_71_id,
          'KT-71',
          'Kit de instalação 6P'
        )
    ) as expected (id, code, description)
    left join public.items as item
      on item.id = expected.id
    left join public.installation_kits as installation_kit
      on installation_kit.item_id = expected.id
    where item.id is null
      or item.code is distinct from expected.code
      or item.description is distinct from expected.description
      or item.item_type is distinct from 'INSTALLATION_KIT'
      or item.is_active is distinct from true
      or installation_kit.item_id is null
  ) then
    raise exception using
      errcode = '23514',
      message =
        'Commercial catalog correction aborted: an expected installation kit identity, type, or status diverged.';
  end if;

  if not exists (
    select 1
    from public.items as item
    join public.repair_kits as repair_kit
      on repair_kit.item_id = item.id
    where item.id = v_repair_066_id
      and item.code = 'R066'
      and item.description = 'JOGO DE REPARO 066'
      and item.item_type = 'REPAIR_KIT'
      and item.is_active
  ) then
    raise exception using
      errcode = '23514',
      message =
        'Commercial catalog correction aborted: repair kit R066 diverged from the expected catalog.';
  end if;

  if exists (
    select 1
    from public.items
    where code = '6RB'
  ) then
    raise exception using
      errcode = '23505',
      message =
        'Commercial catalog correction aborted: physical item code 6RB already exists.';
  end if;

  if exists (
    select 1
    from public.items
    where id = v_servo_6rb_id
  ) or exists (
    select 1
    from public.servo_models
    where item_id = v_servo_6rb_id
  ) then
    raise exception using
      errcode = '23505',
      message =
        'Commercial catalog correction aborted: the fixed UUID selected for servo 6RB is occupied.';
  end if;

  if exists (
    select 1
    from public.commercial_configurations
    where id in (
      v_configuration_9d_id,
      v_configuration_5z_id,
      v_configuration_6p_id,
      v_configuration_6r_id
    )
  ) then
    raise exception using
      errcode = '23505',
      message =
        'Commercial catalog correction aborted: a fixed UUID selected for a new configuration is occupied.';
  end if;

  if exists (
    select 1
    from public.commercial_configurations as configuration
    join (
      values
        (v_servo_9inv_id, v_kit_31_id),
        (v_servo_5inv028_id, v_kit_59_id),
        (v_servo_6rb_id, v_kit_71_id),
        (v_servo_6rb_id, v_kit_64_id)
    ) as expected (servo_id, installation_kit_id)
      on expected.servo_id = configuration.servo_id
      and expected.installation_kit_id =
        configuration.installation_kit_id
  ) then
    raise exception using
      errcode = '23505',
      message =
        'Commercial catalog correction aborted: an intended new servo and kit pair already exists.';
  end if;

  if exists (
    select 1
    from (
      values
        (
          v_old_configuration_9a_id,
          v_servo_9_id,
          v_kit_31_id
        ),
        (
          v_old_configuration_5z_id,
          v_servo_5_id,
          v_kit_59_id
        ),
        (
          v_old_configuration_6p_id,
          v_servo_6_id,
          v_kit_71_id
        ),
        (
          v_old_configuration_6r_id,
          v_servo_6_id,
          v_kit_64_id
        )
    ) as expected (id, servo_id, installation_kit_id)
    left join public.commercial_configurations as configuration
      on configuration.id = expected.id
    where configuration.id is null
      or configuration.servo_id is distinct from expected.servo_id
      or configuration.installation_kit_id
        is distinct from expected.installation_kit_id
      or configuration.is_active is distinct from true
  ) then
    raise exception using
      errcode = '23514',
      message =
        'Commercial catalog correction aborted: a current physical configuration diverged.';
  end if;

  if exists (
    select 1
    from (
      values
        (
          v_code_9a_id,
          '9A',
          v_old_configuration_9a_id
        ),
        (
          v_code_9d_id,
          '9D',
          v_old_configuration_9a_id
        ),
        (
          v_code_5z_id,
          '5Z',
          v_old_configuration_5z_id
        ),
        (
          v_code_6p_id,
          '6P',
          v_old_configuration_6p_id
        ),
        (
          v_code_6r_id,
          '6R',
          v_old_configuration_6r_id
        )
    ) as expected (id, code, configuration_id)
    left join public.commercial_configuration_codes as commercial_code
      on commercial_code.id = expected.id
    where commercial_code.id is null
      or commercial_code.code is distinct from expected.code
      or commercial_code.configuration_id
        is distinct from expected.configuration_id
      or commercial_code.is_active is distinct from true
  ) then
    raise exception using
      errcode = '23514',
      message =
        'Commercial catalog correction aborted: a target commercial code identity, status, or relationship diverged.';
  end if;

  if (
    select array_agg(commercial_code.code order by commercial_code.code)
    from public.commercial_configuration_codes as commercial_code
    where commercial_code.configuration_id = v_old_configuration_9a_id
  ) is distinct from array['9A', '9D']::text[] then
    raise exception using
      errcode = '23514',
      message =
        'Commercial catalog correction aborted: configuration 9 + KT-31 has unexpected aliases.';
  end if;

  if (
    select array_agg(commercial_code.code order by commercial_code.code)
    from public.commercial_configuration_codes as commercial_code
    where commercial_code.configuration_id = v_old_configuration_5z_id
  ) is distinct from array['5Z']::text[]
    or (
      select array_agg(commercial_code.code order by commercial_code.code)
      from public.commercial_configuration_codes as commercial_code
      where commercial_code.configuration_id = v_old_configuration_6p_id
    ) is distinct from array['6P']::text[]
    or (
      select array_agg(commercial_code.code order by commercial_code.code)
      from public.commercial_configuration_codes as commercial_code
      where commercial_code.configuration_id = v_old_configuration_6r_id
    ) is distinct from array['6R']::text[] then
    raise exception using
      errcode = '23514',
      message =
        'Commercial catalog correction aborted: an exclusive legacy configuration has unexpected aliases.';
  end if;

  select commercial_code.configuration_id
  into v_5c_configuration_id
  from public.commercial_configuration_codes as commercial_code
  join public.commercial_configurations as configuration
    on configuration.id = commercial_code.configuration_id
  join public.items as installation_kit
    on installation_kit.id = configuration.installation_kit_id
  where commercial_code.code = '5C'
    and commercial_code.is_active
    and configuration.is_active
    and configuration.servo_id = v_servo_5inv028_id
    and installation_kit.code = 'KT-25';

  if not found then
    raise exception using
      errcode = '23514',
      message =
        'Commercial catalog correction aborted: protected code 5C diverged.';
  end if;

  select commercial_code.configuration_id
  into v_5w_configuration_id
  from public.commercial_configuration_codes as commercial_code
  join public.commercial_configurations as configuration
    on configuration.id = commercial_code.configuration_id
  join public.items as installation_kit
    on installation_kit.id = configuration.installation_kit_id
  where commercial_code.code = '5W'
    and commercial_code.is_active
    and configuration.is_active
    and configuration.servo_id = v_servo_5inv028_id
    and installation_kit.code = 'KT-47';

  if not found then
    raise exception using
      errcode = '23514',
      message =
        'Commercial catalog correction aborted: protected code 5W diverged.';
  end if;

  select commercial_code.configuration_id
  into v_9c_configuration_id
  from public.commercial_configuration_codes as commercial_code
  join public.commercial_configurations as configuration
    on configuration.id = commercial_code.configuration_id
  join public.items as installation_kit
    on installation_kit.id = configuration.installation_kit_id
  where commercial_code.code = '9C'
    and commercial_code.is_active
    and configuration.is_active
    and configuration.servo_id = v_servo_9inv_id
    and installation_kit.code = 'KT-74';

  if not found then
    raise exception using
      errcode = '23514',
      message =
        'Commercial catalog correction aborted: protected code 9C diverged.';
  end if;

  select array_agg(
    compatibility.repair_kit_id
    order by compatibility.repair_kit_id
  )
  into v_source_repair_ids
  from public.servo_repair_compatibility as compatibility
  where compatibility.servo_id = v_servo_6_id;

  if v_source_repair_ids
    is distinct from array[v_repair_066_id]::uuid[] then
    raise exception using
      errcode = '23514',
      message =
        'Commercial catalog correction aborted: servo 6 repair compatibility set diverged.';
  end if;

  select coalesce(
    jsonb_object_agg(
      commercial_code.id::text,
      commercial_code.configuration_id::text
      order by commercial_code.id
    ),
    '{}'::jsonb
  )
  into v_unrelated_aliases_before
  from public.commercial_configuration_codes as commercial_code
  where commercial_code.id not in (
    v_code_9d_id,
    v_code_5z_id,
    v_code_6p_id,
    v_code_6r_id
  );

  insert into public.items (
    id,
    code,
    description,
    item_type,
    minimum_stock,
    is_active,
    created_at,
    updated_at
  )
  values (
    v_servo_6rb_id,
    '6RB',
    'SERVO VF-040 Rebaixado',
    'SERVO',
    0,
    true,
    v_now,
    v_now
  );

  insert into public.servo_models (
    item_id,
    model,
    notes,
    created_at
  )
  values (
    v_servo_6rb_id,
    'VF-040 Rebaixado',
    'Servo rebaixado, flange de 42 mm, corpo zincado amarelo, referência 028/AG',
    v_now
  );

  insert into public.servo_repair_compatibility (
    servo_id,
    repair_kit_id,
    created_at
  )
  select
    v_servo_6rb_id,
    compatibility.repair_kit_id,
    v_now
  from public.servo_repair_compatibility as compatibility
  where compatibility.servo_id = v_servo_6_id
  order by compatibility.repair_kit_id;

  get diagnostics v_affected_rows = row_count;

  if v_affected_rows <> cardinality(v_source_repair_ids) then
    raise exception using
      errcode = '23514',
      message =
        'Commercial catalog correction aborted: not all servo 6 repair compatibilities were copied.';
  end if;

  insert into public.commercial_configurations (
    id,
    description,
    servo_id,
    installation_kit_id,
    is_active,
    created_at,
    updated_at
  )
  values
    (
      v_configuration_9d_id,
      'SERVO MBF-032 Invertido 028 + KT-31',
      v_servo_9inv_id,
      v_kit_31_id,
      true,
      v_now,
      v_now
    ),
    (
      v_configuration_5z_id,
      'SERVO MBF-040 Invertido 028 + KT-59',
      v_servo_5inv028_id,
      v_kit_59_id,
      true,
      v_now,
      v_now
    ),
    (
      v_configuration_6p_id,
      'SERVO VF-040 Rebaixado + KT-71',
      v_servo_6rb_id,
      v_kit_71_id,
      true,
      v_now,
      v_now
    ),
    (
      v_configuration_6r_id,
      'SERVO VF-040 Rebaixado + KT-64',
      v_servo_6rb_id,
      v_kit_64_id,
      true,
      v_now,
      v_now
    );

  update public.commercial_configuration_codes as commercial_code
  set configuration_id = case commercial_code.id
        when v_code_9d_id then v_configuration_9d_id
        when v_code_5z_id then v_configuration_5z_id
        when v_code_6p_id then v_configuration_6p_id
        when v_code_6r_id then v_configuration_6r_id
        else commercial_code.configuration_id
      end,
      updated_at = v_now
  where commercial_code.id in (
    v_code_9d_id,
    v_code_5z_id,
    v_code_6p_id,
    v_code_6r_id
  );

  get diagnostics v_affected_rows = row_count;

  if v_affected_rows <> 4 then
    raise exception using
      errcode = '23514',
      message =
        'Commercial catalog correction aborted: not all four target commercial codes were redirected.';
  end if;

  if exists (
    select 1
    from public.commercial_configuration_codes
    where configuration_id in (
      v_old_configuration_5z_id,
      v_old_configuration_6p_id,
      v_old_configuration_6r_id
    )
  ) or exists (
    select 1
    from public.configuration_stock_balances
    where configuration_id in (
      v_old_configuration_5z_id,
      v_old_configuration_6p_id,
      v_old_configuration_6r_id
    )
      and quantity <> 0
  ) or exists (
    select 1
    from public.configuration_stock_movements
    where configuration_id in (
      v_old_configuration_5z_id,
      v_old_configuration_6p_id,
      v_old_configuration_6r_id
    )
  ) or exists (
    select 1
    from public.assembly_operations
    where configuration_id in (
      v_old_configuration_5z_id,
      v_old_configuration_6p_id,
      v_old_configuration_6r_id
    )
  ) then
    raise exception using
      errcode = '23514',
      message =
        'Commercial catalog correction aborted: a legacy configuration still has aliases, balance, or history.';
  end if;

  update public.commercial_configurations
  set is_active = false,
      updated_at = v_now
  where id in (
    v_old_configuration_5z_id,
    v_old_configuration_6p_id,
    v_old_configuration_6r_id
  )
    and is_active;

  get diagnostics v_affected_rows = row_count;

  if v_affected_rows <> 3 then
    raise exception using
      errcode = '23514',
      message =
        'Commercial catalog correction aborted: not all three exclusive legacy configurations were deactivated.';
  end if;

  if exists (
    select 1
    from (
      values
        (
          v_code_9a_id,
          '9A',
          v_old_configuration_9a_id,
          v_servo_9_id,
          v_kit_31_id
        ),
        (
          v_code_9d_id,
          '9D',
          v_configuration_9d_id,
          v_servo_9inv_id,
          v_kit_31_id
        ),
        (
          v_code_5z_id,
          '5Z',
          v_configuration_5z_id,
          v_servo_5inv028_id,
          v_kit_59_id
        ),
        (
          v_code_6p_id,
          '6P',
          v_configuration_6p_id,
          v_servo_6rb_id,
          v_kit_71_id
        ),
        (
          v_code_6r_id,
          '6R',
          v_configuration_6r_id,
          v_servo_6rb_id,
          v_kit_64_id
        )
    ) as expected (
      code_id,
      code,
      configuration_id,
      servo_id,
      installation_kit_id
    )
    left join public.commercial_configuration_codes as commercial_code
      on commercial_code.id = expected.code_id
    left join public.commercial_configurations as configuration
      on configuration.id = commercial_code.configuration_id
    where commercial_code.id is null
      or commercial_code.code is distinct from expected.code
      or commercial_code.configuration_id
        is distinct from expected.configuration_id
      or commercial_code.is_active is distinct from true
      or configuration.servo_id is distinct from expected.servo_id
      or configuration.installation_kit_id
        is distinct from expected.installation_kit_id
      or configuration.is_active is distinct from true
  ) then
    raise exception using
      errcode = '23514',
      message =
        'Commercial catalog correction aborted: a corrected code failed post-validation.';
  end if;

  if v_old_configuration_9a_id = v_configuration_9d_id
    or v_configuration_6p_id = v_configuration_6r_id then
    raise exception using
      errcode = '23514',
      message =
        'Commercial catalog correction aborted: corrected configurations are not distinct as required.';
  end if;

  if (
    select array_agg(commercial_code.code order by commercial_code.code)
    from public.commercial_configuration_codes as commercial_code
    where commercial_code.configuration_id = v_old_configuration_9a_id
  ) is distinct from array['9A']::text[]
    or (
      select array_agg(commercial_code.code order by commercial_code.code)
      from public.commercial_configuration_codes as commercial_code
      where commercial_code.configuration_id = v_configuration_9d_id
    ) is distinct from array['9D']::text[]
    or (
      select array_agg(commercial_code.code order by commercial_code.code)
      from public.commercial_configuration_codes as commercial_code
      where commercial_code.configuration_id = v_configuration_5z_id
    ) is distinct from array['5Z']::text[]
    or (
      select array_agg(commercial_code.code order by commercial_code.code)
      from public.commercial_configuration_codes as commercial_code
      where commercial_code.configuration_id = v_configuration_6p_id
    ) is distinct from array['6P']::text[]
    or (
      select array_agg(commercial_code.code order by commercial_code.code)
      from public.commercial_configuration_codes as commercial_code
      where commercial_code.configuration_id = v_configuration_6r_id
    ) is distinct from array['6R']::text[] then
    raise exception using
      errcode = '23514',
      message =
        'Commercial catalog correction aborted: corrected alias sets failed post-validation.';
  end if;

  if not exists (
    select 1
    from public.items as item
    join public.servo_models as servo
      on servo.item_id = item.id
    where item.id = v_servo_6rb_id
      and item.code = '6RB'
      and item.description = 'SERVO VF-040 Rebaixado'
      and item.item_type = 'SERVO'
      and item.minimum_stock = 0
      and item.is_active
      and servo.model = 'VF-040 Rebaixado'
      and servo.notes =
        'Servo rebaixado, flange de 42 mm, corpo zincado amarelo, referência 028/AG'
  ) then
    raise exception using
      errcode = '23514',
      message =
        'Commercial catalog correction aborted: servo 6RB failed post-validation.';
  end if;

  select array_agg(
    compatibility.repair_kit_id
    order by compatibility.repair_kit_id
  )
  into v_source_repair_ids_after
  from public.servo_repair_compatibility as compatibility
  where compatibility.servo_id = v_servo_6_id;

  select array_agg(
    compatibility.repair_kit_id
    order by compatibility.repair_kit_id
  )
  into v_new_repair_ids
  from public.servo_repair_compatibility as compatibility
  where compatibility.servo_id = v_servo_6rb_id;

  if v_source_repair_ids_after is distinct from v_source_repair_ids
    or v_new_repair_ids is distinct from v_source_repair_ids_after then
    raise exception using
      errcode = '23514',
      message =
        'Commercial catalog correction aborted: servo 6RB repair compatibilities do not match servo 6.';
  end if;

  if not exists (
    select 1
    from public.commercial_configuration_codes as commercial_code
    join public.commercial_configurations as configuration
      on configuration.id = commercial_code.configuration_id
    join public.items as installation_kit
      on installation_kit.id = configuration.installation_kit_id
    where commercial_code.code = '5C'
      and commercial_code.configuration_id = v_5c_configuration_id
      and commercial_code.is_active
      and configuration.is_active
      and configuration.servo_id = v_servo_5inv028_id
      and installation_kit.code = 'KT-25'
  ) or not exists (
    select 1
    from public.commercial_configuration_codes as commercial_code
    join public.commercial_configurations as configuration
      on configuration.id = commercial_code.configuration_id
    join public.items as installation_kit
      on installation_kit.id = configuration.installation_kit_id
    where commercial_code.code = '5W'
      and commercial_code.configuration_id = v_5w_configuration_id
      and commercial_code.is_active
      and configuration.is_active
      and configuration.servo_id = v_servo_5inv028_id
      and installation_kit.code = 'KT-47'
  ) or not exists (
    select 1
    from public.commercial_configuration_codes as commercial_code
    join public.commercial_configurations as configuration
      on configuration.id = commercial_code.configuration_id
    join public.items as installation_kit
      on installation_kit.id = configuration.installation_kit_id
    where commercial_code.code = '9C'
      and commercial_code.configuration_id = v_9c_configuration_id
      and commercial_code.is_active
      and configuration.is_active
      and configuration.servo_id = v_servo_9inv_id
      and installation_kit.code = 'KT-74'
  ) then
    raise exception using
      errcode = '23514',
      message =
        'Commercial catalog correction aborted: a protected code changed unexpectedly.';
  end if;

  select coalesce(
    jsonb_object_agg(
      commercial_code.id::text,
      commercial_code.configuration_id::text
      order by commercial_code.id
    ),
    '{}'::jsonb
  )
  into v_unrelated_aliases_after
  from public.commercial_configuration_codes as commercial_code
  where commercial_code.id not in (
    v_code_9d_id,
    v_code_5z_id,
    v_code_6p_id,
    v_code_6r_id
  );

  if v_unrelated_aliases_after is distinct from v_unrelated_aliases_before then
    raise exception using
      errcode = '23514',
      message =
        'Commercial catalog correction aborted: an unrelated commercial alias moved unexpectedly.';
  end if;

  if exists (
    select 1
    from public.commercial_configurations as configuration
    where configuration.id in (
      v_old_configuration_5z_id,
      v_old_configuration_6p_id,
      v_old_configuration_6r_id
    )
      and (
        configuration.is_active
        or exists (
          select 1
          from public.commercial_configuration_codes as commercial_code
          where commercial_code.configuration_id =
            configuration.id
        )
      )
  ) then
    raise exception using
      errcode = '23514',
      message =
        'Commercial catalog correction aborted: a legacy exclusive configuration remains active or aliased.';
  end if;

  if not exists (
    select 1
    from public.commercial_configurations
    where id = v_old_configuration_9a_id
      and is_active
      and servo_id = v_servo_9_id
      and installation_kit_id = v_kit_31_id
  ) then
    raise exception using
      errcode = '23514',
      message =
        'Commercial catalog correction aborted: original 9A configuration was not preserved.';
  end if;

  if exists (
    select 1
    from public.stock_balances
    where item_id = v_servo_6rb_id
  ) or exists (
    select 1
    from public.configuration_stock_balances
    where configuration_id in (
      v_configuration_9d_id,
      v_configuration_5z_id,
      v_configuration_6p_id,
      v_configuration_6r_id
    )
  ) then
    raise exception using
      errcode = '23514',
      message =
        'Commercial catalog correction aborted: balance rows were created for new catalog records.';
  end if;

  if exists (select 1 from public.movement_batches)
    or exists (select 1 from public.inbound_batch_lines)
    or exists (select 1 from public.outbound_batch_lines)
    or exists (select 1 from public.stock_movements)
    or exists (select 1 from public.configuration_stock_movements)
    or exists (select 1 from public.assembly_operations)
    or exists (
      select 1
      from public.stock_balances
      where quantity <> 0
    )
    or exists (
      select 1
      from public.configuration_stock_balances
      where quantity <> 0
    ) then
    raise exception using
      errcode = '23514',
      message =
        'Commercial catalog correction aborted: operational state changed during the migration.';
  end if;
end;
$$;

commit;
