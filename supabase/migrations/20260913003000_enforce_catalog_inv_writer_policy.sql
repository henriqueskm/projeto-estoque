begin;

create or replace function private.catalog_code_write_policy(p_code text)
returns table (
  normalized_code text,
  canonical_code text,
  lock_identity text,
  modifier_family text,
  is_modifier_base boolean
)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_code text;
  v_modifier_parts text[];
begin
  v_code := btrim(p_code);

  if p_code is distinct from v_code then
    raise exception using
      errcode = '22023',
      message = 'Catalog codes cannot contain leading or trailing whitespace.';
  end if;

  if v_code is null or v_code = '' then
    raise exception using
      errcode = '22023',
      message = 'Catalog code is required.';
  end if;

  if char_length(v_code) > 120 then
    raise exception using
      errcode = '22023',
      message = 'Catalog code must have at most 120 characters.';
  end if;

  if v_code !~ '^[A-Za-z0-9]+([-/][A-Za-z0-9]+)*$' then
    raise exception using
      errcode = '22023',
      message = format(
        'Catalog code %s uses an unsupported format.',
        v_code
      );
  end if;

  v_modifier_parts := regexp_match(
    upper(v_code),
    '^([0-9]+)-?(INV|DESL)([0-9]*)$'
  );

  if v_modifier_parts is null
    and upper(v_code) ~ '^[0-9]+.*(INV|DESL)' then
    raise exception using
      errcode = '22023',
      message = format(
        'Catalog code %s uses an unsupported INV/DESL format.',
        v_code
      );
  end if;

  if v_modifier_parts is not null then
    normalized_code := v_code;
    modifier_family := v_modifier_parts[1] || v_modifier_parts[2];
    canonical_code := modifier_family || v_modifier_parts[3];
    lock_identity := modifier_family;
    is_modifier_base := v_modifier_parts[3] = '';
    return next;
    return;
  end if;

  normalized_code := v_code;
  canonical_code := upper(v_code);
  lock_identity := canonical_code;
  modifier_family := null;
  is_modifier_base := false;
  return next;
end;
$$;

revoke all on function private.catalog_code_write_policy(text)
from public, anon, authenticated;

create or replace function private.catalog_codes_conflict(
  p_left_code text,
  p_right_code text
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_left record;
  v_right record;
begin
  select *
  into strict v_left
  from private.catalog_code_write_policy(p_left_code);

  select *
  into strict v_right
  from private.catalog_code_write_policy(p_right_code);

  return
    v_left.canonical_code = v_right.canonical_code
    or (
      v_left.modifier_family is not null
      and v_left.modifier_family = v_right.modifier_family
      and (v_left.is_modifier_base or v_right.is_modifier_base)
    );
end;
$$;

revoke all on function private.catalog_codes_conflict(text, text)
from public, anon, authenticated;

do $$
declare
  v_code text;
  v_left_code text;
  v_right_code text;
begin
  for v_code in
    select item.code from public.items as item
    union all
    select commercial_code.code
    from public.commercial_configuration_codes as commercial_code
  loop
    begin
      perform 1 from private.catalog_code_write_policy(v_code);
    exception
      when others then
        raise exception using
          errcode = '23514',
          message = format(
            'Unified catalog writer policy cannot be applied: existing code %s is invalid (%s).',
            v_code,
            sqlerrm
          );
    end;
  end loop;

  with catalog_codes as (
    select
      'ITEM:' || item.id::text as catalog_key,
      item.code
    from public.items as item
    union all
    select
      'COMMERCIAL_CODE:' || commercial_code.id::text,
      commercial_code.code
    from public.commercial_configuration_codes as commercial_code
  )
  select left_code.code, right_code.code
  into v_left_code, v_right_code
  from catalog_codes as left_code
  join catalog_codes as right_code
    on left_code.catalog_key < right_code.catalog_key
   and private.catalog_codes_conflict(
     left_code.code,
     right_code.code
   )
  order by left_code.code, right_code.code
  limit 1;

  if found then
    raise exception using
      errcode = '23514',
      message = format(
        'Unified catalog writer policy cannot be applied: existing codes %s and %s conflict semantically.',
        v_left_code,
        v_right_code
      );
  end if;
end;
$$;

create or replace function private.enforce_catalog_code_namespace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy record;
  v_conflict_code text;
begin
  select *
  into strict v_policy
  from private.catalog_code_write_policy(new.code);

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_policy.lock_identity, 0)
  );

  if tg_table_name = 'items' then
    select item.code
    into v_conflict_code
    from public.items as item
    where item.id <> new.id
      and private.catalog_codes_conflict(item.code, new.code)
    order by item.code
    limit 1
    for share;

    if found then
      raise exception using
        errcode = '23514',
        message = format(
          'Code %s conflicts with physical catalog item code %s.',
          new.code,
          v_conflict_code
        );
    end if;

    select commercial_code.code
    into v_conflict_code
    from public.commercial_configuration_codes as commercial_code
    where private.catalog_codes_conflict(
      commercial_code.code,
      new.code
    )
    order by commercial_code.code
    limit 1
    for share;

    if found then
      raise exception using
        errcode = '23514',
        message = format(
          'Code %s conflicts with commercial configuration code %s.',
          new.code,
          v_conflict_code
        );
    end if;
  elsif tg_table_name = 'commercial_configuration_codes' then
    select commercial_code.code
    into v_conflict_code
    from public.commercial_configuration_codes as commercial_code
    where commercial_code.id <> new.id
      and private.catalog_codes_conflict(
        commercial_code.code,
        new.code
      )
    order by commercial_code.code
    limit 1
    for share;

    if found then
      raise exception using
        errcode = '23514',
        message = format(
          'Code %s conflicts with commercial configuration code %s.',
          new.code,
          v_conflict_code
        );
    end if;

    select item.code
    into v_conflict_code
    from public.items as item
    where private.catalog_codes_conflict(item.code, new.code)
    order by item.code
    limit 1
    for share;

    if found then
      raise exception using
        errcode = '23514',
        message = format(
          'Code %s conflicts with physical catalog item code %s.',
          new.code,
          v_conflict_code
        );
    end if;
  else
    raise exception using
      errcode = '55000',
      message = format(
        'Catalog namespace trigger cannot run on table %s.',
        tg_table_name
      );
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_catalog_code_namespace()
from public, anon, authenticated;

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
  v_policy record;
  v_conflict_code text;
  v_item_id uuid;
  v_item_code text;
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

  select *
  into strict v_policy
  from private.catalog_code_write_policy(v_code);

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
    pg_catalog.hashtextextended(v_policy.lock_identity, 0)
  );

  select commercial_code.code
  into v_conflict_code
  from public.commercial_configuration_codes as commercial_code
  where private.catalog_codes_conflict(commercial_code.code, v_code)
  order by commercial_code.code
  limit 1
  for share;

  if found then
    raise exception using
      errcode = '23514',
      message = format(
        'Code %s conflicts with commercial configuration code %s.',
        v_code,
        v_conflict_code
      );
  end if;

  select
    item.id,
    item.code,
    item.item_type,
    item.description,
    item.is_active
  into
    v_item_id,
    v_item_code,
    v_item_type,
    v_item_description,
    v_item_is_active
  from public.items as item
  where private.catalog_codes_conflict(item.code, v_code)
  order by
    case when item.code = v_code then 0 else 1 end,
    item.code
  limit 1
  for update;

  if found and v_item_code <> v_code then
    raise exception using
      errcode = '23514',
      message = format(
        'Code %s conflicts with existing catalog code %s.',
        v_code,
        v_item_code
      );
  end if;

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
    returning id, code, item_type, description, is_active
    into
      v_item_id,
      v_item_code,
      v_item_type,
      v_item_description,
      v_item_is_active;

    if not found then
      select
        item.id,
        item.code,
        item.item_type,
        item.description,
        item.is_active
      into
        v_item_id,
        v_item_code,
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
  v_lock_key bigint;
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

  if jsonb_typeof(p_lines) = 'array' then
    for v_lock_key in
      select distinct pg_catalog.hashtextextended(
        policy.lock_identity,
        0
      )
      from jsonb_array_elements(p_lines) as payload_line(value)
      cross join lateral private.catalog_code_write_policy(
        payload_line.value ->> 'code'
      ) as policy
      where payload_line.value ->> 'kind' = 'NEW_LOOSE_PART'
        and jsonb_typeof(payload_line.value -> 'code') = 'string'
      order by 1
    loop
      perform pg_catalog.pg_advisory_xact_lock(v_lock_key);
    end loop;
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

comment on function private.catalog_code_write_policy(text) is
  'Defines the authoritative canonical identity and lock family for catalog writes without rewriting stored business codes.';

comment on function private.catalog_codes_conflict(text, text) is
  'Detects exact/case/separator equivalence and conflicts between an INV/DESL family base and its numbered variants.';

commit;
