create table public.inbound_batch_lines (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null
    references public.movement_batches (id) on delete restrict,
  item_id uuid references public.items (id) on delete restrict,
  commercial_configuration_code_id uuid
    references public.commercial_configuration_codes (id) on delete restrict,
  quantity integer not null,
  created_at timestamptz not null default now(),
  constraint inbound_batch_lines_target_check check (
    num_nonnulls(item_id, commercial_configuration_code_id) = 1
  ),
  constraint inbound_batch_lines_quantity_check check (quantity > 0)
);

comment on table public.inbound_batch_lines is
  'Consolidated requested lines for an inbound batch. Commercial aliases remain separate for audit.';

create unique index inbound_batch_lines_batch_item_uidx
  on public.inbound_batch_lines (batch_id, item_id)
  where item_id is not null;

create unique index inbound_batch_lines_batch_commercial_code_uidx
  on public.inbound_batch_lines (
    batch_id,
    commercial_configuration_code_id
  )
  where commercial_configuration_code_id is not null;

create index inbound_batch_lines_batch_id_idx
  on public.inbound_batch_lines (batch_id);

create index inbound_batch_lines_item_id_idx
  on public.inbound_batch_lines (item_id)
  where item_id is not null;

create index inbound_batch_lines_commercial_code_id_idx
  on public.inbound_batch_lines (commercial_configuration_code_id)
  where commercial_configuration_code_id is not null;

alter table public.inbound_batch_lines enable row level security;

create policy inbound_batch_lines_select_active_users
on public.inbound_batch_lines
for select
to authenticated
using ((select private.is_active_profile()));

revoke all privileges on table public.inbound_batch_lines
from public, anon, authenticated;

grant select on table public.inbound_batch_lines
to authenticated;

create function private.stock_inbound_lines(
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

revoke all on function private.stock_inbound_lines(
  jsonb,
  uuid,
  uuid,
  text,
  text
) from public, anon, authenticated;

create function public.stock_inbound_lines(
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

  return private.stock_inbound_lines(
    p_lines,
    p_idempotency_key,
    v_user_id,
    v_user_name,
    p_description
  );
end;
$$;

revoke all on function public.stock_inbound_lines(jsonb, uuid, text)
from public, anon, authenticated;

grant execute on function public.stock_inbound_lines(jsonb, uuid, text)
to authenticated;
