do $$
declare
  v_servo public.items%rowtype;
  v_installation_kit public.items%rowtype;
  v_servo_model text;
  v_configuration public.commercial_configurations%rowtype;
  v_existing_configuration_code text;
begin
  insert into public.items (code, description, item_type)
  values ('2', 'SERVO MBF-025', 'SERVO')
  on conflict (code) do nothing;

  select *
  into v_servo
  from public.items
  where code = '2';

  if not found then
    raise exception using
      errcode = '23514',
      message = 'Could not resolve the servo item with code 2.';
  end if;

  if v_servo.description is distinct from 'SERVO MBF-025'
    or v_servo.item_type is distinct from 'SERVO' then
    raise exception using
      errcode = '23514',
      message = 'Item code 2 conflicts with the expected catalog data: description SERVO MBF-025 and item_type SERVO.';
  end if;

  insert into public.servo_models (item_id, model)
  values (v_servo.id, 'MBF-025')
  on conflict (item_id) do nothing;

  select model
  into v_servo_model
  from public.servo_models
  where item_id = v_servo.id;

  if not found or v_servo_model is distinct from 'MBF-025' then
    raise exception using
      errcode = '23514',
      message = 'Servo item code 2 conflicts with the expected model MBF-025.';
  end if;

  insert into public.items (code, description, item_type)
  values ('KT-18', 'Kit de instalação KT-18', 'INSTALLATION_KIT')
  on conflict (code) do nothing;

  select *
  into v_installation_kit
  from public.items
  where code = 'KT-18';

  if not found then
    raise exception using
      errcode = '23514',
      message = 'Could not resolve the installation kit item with code KT-18.';
  end if;

  if v_installation_kit.description is distinct from 'Kit de instalação KT-18'
    or v_installation_kit.item_type is distinct from 'INSTALLATION_KIT' then
    raise exception using
      errcode = '23514',
      message = 'Item code KT-18 conflicts with the expected catalog data: description Kit de instalação KT-18 and item_type INSTALLATION_KIT.';
  end if;

  insert into public.installation_kits (item_id)
  values (v_installation_kit.id)
  on conflict (item_id) do nothing;

  if not exists (
    select 1
    from public.installation_kits
    where item_id = v_installation_kit.id
  ) then
    raise exception using
      errcode = '23514',
      message = 'Could not associate item code KT-18 with installation_kits.';
  end if;

  -- 2A is a commercial configuration, not the physical installation kit code.
  insert into public.commercial_configurations (
    code,
    description,
    servo_id,
    installation_kit_id
  )
  values (
    '2A',
    'SERVO MBF-025 + KIT KT-18',
    v_servo.id,
    v_installation_kit.id
  )
  on conflict do nothing;

  select *
  into v_configuration
  from public.commercial_configurations
  where code = '2A';

  if not found then
    select code
    into v_existing_configuration_code
    from public.commercial_configurations
    where servo_id = v_servo.id
      and installation_kit_id = v_installation_kit.id;

    raise exception using
      errcode = '23505',
      message = case
        when v_existing_configuration_code is not null then format(
          'Servo code 2 and installation kit code KT-18 are already assigned to commercial configuration %s instead of 2A.',
          v_existing_configuration_code
        )
        else 'Could not create commercial configuration code 2A.'
      end;
  end if;

  if v_configuration.description is distinct from 'SERVO MBF-025 + KIT KT-18'
    or v_configuration.servo_id is distinct from v_servo.id
    or v_configuration.installation_kit_id is distinct from v_installation_kit.id then
    raise exception using
      errcode = '23514',
      message = 'Commercial configuration code 2A conflicts with the expected servo code 2, installation kit code KT-18, or description.';
  end if;
end;
$$;
