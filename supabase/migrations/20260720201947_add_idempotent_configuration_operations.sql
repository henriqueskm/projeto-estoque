alter table public.assembly_operations
add column commercial_configuration_code_id uuid
  references public.commercial_configuration_codes (id) on delete set null,
add column commercial_code_snapshot text;

alter table public.assembly_operations
add constraint assembly_operations_commercial_code_snapshot_check check (
  commercial_code_snapshot is null
  or btrim(commercial_code_snapshot) <> ''
),
add constraint assembly_operations_commercial_code_reference_check check (
  commercial_configuration_code_id is null
  or commercial_code_snapshot is not null
);

comment on column public.assembly_operations.commercial_configuration_code_id is
  'Commercial alias selected for the operation when it still exists. The physical stock remains owned by configuration_id.';

comment on column public.assembly_operations.commercial_code_snapshot is
  'Immutable textual snapshot of the commercial alias selected for the operation.';

create index assembly_operations_commercial_configuration_code_id_idx
  on public.assembly_operations (commercial_configuration_code_id)
  where commercial_configuration_code_id is not null;

create table private.configuration_operation_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  user_name_snapshot text,
  idempotency_key uuid not null,
  operation_type text not null,
  configuration_id uuid not null
    references public.commercial_configurations (id) on delete restrict,
  commercial_configuration_code_id uuid
    references public.commercial_configuration_codes (id) on delete set null,
  commercial_code_snapshot text,
  quantity integer not null,
  description text,
  movement_batch_id uuid
    references public.movement_batches (id) on delete restrict,
  servo_id uuid references public.items (id) on delete restrict,
  installation_kit_id uuid references public.items (id) on delete restrict,
  servo_quantity_before integer,
  servo_quantity_after integer,
  kit_quantity_before integer,
  kit_quantity_after integer,
  configuration_quantity_before integer,
  configuration_quantity_after integer,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint configuration_operation_requests_operation_type_check check (
    operation_type in ('ASSEMBLY', 'DISASSEMBLY')
  ),
  constraint configuration_operation_requests_quantity_check check (
    quantity > 0
  ),
  constraint configuration_operation_requests_description_check check (
    description is null
    or (btrim(description) <> '' and char_length(description) <= 500)
  ),
  constraint configuration_operation_requests_commercial_code_check check (
    commercial_code_snapshot is null
    or btrim(commercial_code_snapshot) <> ''
  ),
  constraint configuration_operation_requests_commercial_code_reference_check check (
    commercial_configuration_code_id is null
    or commercial_code_snapshot is not null
  ),
  constraint configuration_operation_requests_completion_check check (
    (
      movement_batch_id is null
      and servo_id is null
      and installation_kit_id is null
      and servo_quantity_before is null
      and servo_quantity_after is null
      and kit_quantity_before is null
      and kit_quantity_after is null
      and configuration_quantity_before is null
      and configuration_quantity_after is null
      and completed_at is null
    )
    or
    (
      movement_batch_id is not null
      and servo_id is not null
      and installation_kit_id is not null
      and servo_quantity_before >= 0
      and servo_quantity_after >= 0
      and kit_quantity_before >= 0
      and kit_quantity_after >= 0
      and configuration_quantity_before >= 0
      and configuration_quantity_after >= 0
      and completed_at is not null
      and servo_quantity_after = servo_quantity_before + (
        case operation_type
          when 'ASSEMBLY' then -quantity
          else quantity
        end
      )
      and kit_quantity_after = kit_quantity_before + (
        case operation_type
          when 'ASSEMBLY' then -quantity
          else quantity
        end
      )
      and configuration_quantity_after = configuration_quantity_before + (
        case operation_type
          when 'ASSEMBLY' then quantity
          else -quantity
        end
      )
    )
  )
);

comment on table private.configuration_operation_requests is
  'Private canonical requests and immutable receipts for idempotent manual assembly and disassembly operations.';

create unique index configuration_operation_requests_user_key_uidx
  on private.configuration_operation_requests (user_id, idempotency_key)
  where user_id is not null;

create unique index configuration_operation_requests_movement_batch_uidx
  on private.configuration_operation_requests (movement_batch_id)
  where movement_batch_id is not null;

create index configuration_operation_requests_configuration_id_idx
  on private.configuration_operation_requests (configuration_id);

create index configuration_operation_requests_commercial_code_id_idx
  on private.configuration_operation_requests (
    commercial_configuration_code_id
  )
  where commercial_configuration_code_id is not null;

revoke all privileges on table private.configuration_operation_requests
from public, anon, authenticated;

create function private.execute_configuration_operation(
  p_operation_type text,
  p_configuration_id uuid,
  p_quantity integer,
  p_idempotency_key uuid,
  p_commercial_code text,
  p_description text,
  p_user_id uuid,
  p_user_name text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
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

revoke all on function private.execute_configuration_operation(
  text,
  uuid,
  integer,
  uuid,
  text,
  text,
  uuid,
  text
) from public, anon, authenticated;

revoke all on function public.assemble_commercial_configuration(
  uuid,
  integer,
  text,
  text
) from public, anon, authenticated;

drop function public.assemble_commercial_configuration(
  uuid,
  integer,
  text,
  text
);

revoke all on function public.disassemble_commercial_configuration(
  uuid,
  integer,
  text,
  text
) from public, anon, authenticated;

drop function public.disassemble_commercial_configuration(
  uuid,
  integer,
  text,
  text
);

create function public.assemble_commercial_configuration(
  p_configuration_id uuid,
  p_quantity integer,
  p_idempotency_key uuid,
  p_commercial_code text default null,
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

revoke all on function public.assemble_commercial_configuration(
  uuid,
  integer,
  uuid,
  text,
  text
) from public, anon, authenticated;

grant execute on function public.assemble_commercial_configuration(
  uuid,
  integer,
  uuid,
  text,
  text
) to authenticated;

create function public.disassemble_commercial_configuration(
  p_configuration_id uuid,
  p_quantity integer,
  p_idempotency_key uuid,
  p_commercial_code text default null,
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

revoke all on function public.disassemble_commercial_configuration(
  uuid,
  integer,
  uuid,
  text,
  text
) from public, anon, authenticated;

grant execute on function public.disassemble_commercial_configuration(
  uuid,
  integer,
  uuid,
  text,
  text
) to authenticated;
