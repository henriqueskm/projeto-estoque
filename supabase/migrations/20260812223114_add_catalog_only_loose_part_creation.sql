alter table public.items
add column created_by uuid
  references public.profiles(id)
  on delete set null,
add column created_by_name_snapshot text;

alter table public.items
add constraint items_created_by_name_snapshot_check
check (
  (created_by is null and created_by_name_snapshot is null)
  or nullif(btrim(created_by_name_snapshot), '') is not null
);

comment on column public.items.created_by is
  'Authenticated profile that created the catalog item when authorship is available. Legacy rows remain null.';

comment on column public.items.created_by_name_snapshot is
  'Immutable display-name snapshot for catalog creation audit. Legacy rows remain null.';

create or replace function private.resolve_or_create_loose_part(
  p_code text,
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
  v_code text;
  v_description text;
  v_user_name text;
  v_item_id uuid;
  v_item_type text;
  v_item_description text;
  v_item_is_active boolean;
  v_created boolean := false;
begin
  v_code := btrim(p_code);
  v_description := btrim(p_description);
  v_user_name := btrim(p_user_name);

  if p_user_id is null then
    raise exception using
      errcode = '22023',
      message = 'p_user_id is required to create or resolve a loose part.';
  end if;

  if v_user_name is null or v_user_name = '' then
    raise exception using
      errcode = '22023',
      message = 'p_user_name is required to create or resolve a loose part.';
  end if;

  if v_code is null or v_code = '' then
    raise exception using
      errcode = '22023',
      message = 'Loose-part code is required.';
  end if;

  if char_length(v_code) > 120 then
    raise exception using
      errcode = '22023',
      message = 'Loose-part code must have at most 120 characters.';
  end if;

  if v_description is null or v_description = '' then
    raise exception using
      errcode = '22023',
      message = 'Loose-part description is required.';
  end if;

  if char_length(v_description) > 500 then
    raise exception using
      errcode = '22023',
      message = 'Loose-part description must have at most 500 characters.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_code, 0)
  );

  perform 1
  from public.commercial_configuration_codes as commercial_code
  where commercial_code.code = v_code
  for share;

  if found then
    raise exception using
      errcode = '23514',
      message = format(
        'Code %s already belongs to a commercial configuration code.',
        v_code
      );
  end if;

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
  where item.code = v_code
  for update;

  if not found then
    insert into public.items (
      code,
      description,
      item_type,
      minimum_stock,
      is_active,
      created_by,
      created_by_name_snapshot
    )
    values (
      v_code,
      v_description,
      'LOOSE_PART',
      0,
      true,
      p_user_id,
      v_user_name
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
      where item.code = v_code
      for update;
    else
      v_created := true;

      insert into public.loose_parts (item_id)
      values (v_item_id);
    end if;
  end if;

  if v_item_id is null then
    raise exception using
      errcode = '23503',
      message = format(
        'Loose-part code %s could not be resolved.',
        v_code
      );
  end if;

  if v_item_type <> 'LOOSE_PART' then
    raise exception using
      errcode = '23514',
      message = format(
        'Code %s already belongs to another item type.',
        v_code
      );
  end if;

  if not v_item_is_active then
    raise exception using
      errcode = '23514',
      message = format(
        'Loose-part code %s is inactive.',
        v_code
      );
  end if;

  if lower(btrim(v_item_description)) <> lower(v_description) then
    raise exception using
      errcode = '23514',
      message = format(
        'Code %s already has a different description.',
        v_code
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
        v_code
      );
  end if;

  return jsonb_build_object(
    'item_id', v_item_id,
    'code', v_code,
    'description', v_item_description,
    'item_type', v_item_type,
    'created', v_created
  );
end;
$$;

revoke all on function private.resolve_or_create_loose_part(
  text,
  text,
  uuid,
  text
) from public, anon, authenticated;

create or replace function public.create_loose_part(
  p_code text,
  p_description text
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

  if nullif(btrim(v_user_name), '') is null then
    raise exception using
      errcode = '42501',
      message = 'The authenticated user profile must have a name.';
  end if;

  return private.resolve_or_create_loose_part(
    p_code,
    p_description,
    v_user_id,
    v_user_name
  );
end;
$$;

revoke all on function public.create_loose_part(text, text)
from public, anon, authenticated;

grant execute on function public.create_loose_part(text, text)
to authenticated;

create or replace function private.stock_inbound_lines_with_loose_parts(
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
  v_payload_line jsonb;
  v_payload_index integer := 0;
  v_payload_kind text;
  v_payload_quantity numeric;
  v_normalized_lines jsonb;
  v_resolved_lines jsonb := '[]'::jsonb;
  v_new_code text;
  v_new_description text;
  v_loose_part_result jsonb;
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

    v_loose_part_result := private.resolve_or_create_loose_part(
      v_new_code,
      v_new_description,
      p_user_id,
      p_user_name
    );
    v_item_id := (v_loose_part_result ->> 'item_id')::uuid;

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

revoke all on function private.stock_inbound_lines_with_loose_parts(
  jsonb,
  uuid,
  uuid,
  text,
  text
) from public, anon, authenticated;

create or replace function public.stock_inbound_lines(
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

  return private.stock_inbound_lines_with_loose_parts(
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
