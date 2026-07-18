create table public.outbound_batch_lines (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null
    references public.movement_batches (id) on delete restrict,
  item_id uuid references public.items (id) on delete restrict,
  commercial_configuration_code_id uuid
    references public.commercial_configuration_codes (id) on delete restrict,
  quantity integer not null,
  assembled_quantity_used integer not null default 0,
  auto_assembled_quantity integer not null default 0,
  created_at timestamptz not null default now(),
  constraint outbound_batch_lines_target_check check (
    num_nonnulls(item_id, commercial_configuration_code_id) = 1
  ),
  constraint outbound_batch_lines_quantity_check check (quantity > 0),
  constraint outbound_batch_lines_assembled_quantity_used_check check (
    assembled_quantity_used >= 0
    and assembled_quantity_used <= quantity
  ),
  constraint outbound_batch_lines_auto_assembled_quantity_check check (
    auto_assembled_quantity >= 0
    and auto_assembled_quantity <= quantity
  ),
  constraint outbound_batch_lines_allocation_check check (
    (
      item_id is not null
      and assembled_quantity_used = 0
      and auto_assembled_quantity = 0
    )
    or (
      commercial_configuration_code_id is not null
      and assembled_quantity_used::bigint
        + auto_assembled_quantity::bigint = quantity::bigint
    )
  )
);

comment on table public.outbound_batch_lines is
  'Consolidated requested lines for an outbound batch. Commercial aliases remain separate for audit and statistics.';

create unique index outbound_batch_lines_batch_item_uidx
  on public.outbound_batch_lines (batch_id, item_id)
  where item_id is not null;

create unique index outbound_batch_lines_batch_commercial_code_uidx
  on public.outbound_batch_lines (
    batch_id,
    commercial_configuration_code_id
  )
  where commercial_configuration_code_id is not null;

create index outbound_batch_lines_batch_id_idx
  on public.outbound_batch_lines (batch_id);

create index outbound_batch_lines_item_id_idx
  on public.outbound_batch_lines (item_id)
  where item_id is not null;

create index outbound_batch_lines_commercial_code_id_idx
  on public.outbound_batch_lines (commercial_configuration_code_id)
  where commercial_configuration_code_id is not null;

alter table public.outbound_batch_lines enable row level security;

create policy outbound_batch_lines_select_active_users
on public.outbound_batch_lines
for select
to authenticated
using ((select private.is_active_profile()));

revoke all privileges on table public.outbound_batch_lines
from anon, authenticated;

grant select on table public.outbound_batch_lines
to authenticated;

create function private.stock_outbound_items(
  p_lines jsonb,
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

revoke all on function private.stock_outbound_items(
  jsonb,
  uuid,
  uuid,
  text,
  text
) from public, anon, authenticated;

create function public.stock_outbound_items(
  p_lines jsonb,
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

revoke all on function public.stock_outbound_items(jsonb, uuid, text)
from public, anon, authenticated;

grant execute on function public.stock_outbound_items(jsonb, uuid, text)
to authenticated;
