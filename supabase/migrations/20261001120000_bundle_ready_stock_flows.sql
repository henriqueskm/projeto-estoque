-- Extend the canonical APIs without rewriting their legacy ITEM/configuration
-- workers. A ready bundle is received/shipped, never implicitly assembled.
begin;

alter function public.stock_inbound_lines(jsonb, uuid, text) set schema private;
alter function private.stock_inbound_lines(jsonb, uuid, text)
  rename to stock_inbound_lines_before_bundle_flow;
alter function public.stock_outbound_items(jsonb, uuid, text, boolean) set schema private;
alter function private.stock_outbound_items(jsonb, uuid, text, boolean)
  rename to stock_outbound_items_before_bundle_flow;
revoke all on function private.stock_inbound_lines_before_bundle_flow(jsonb, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function private.stock_outbound_items_before_bundle_flow(jsonb, uuid, text, boolean)
  from public, anon, authenticated, service_role;

create table public.bundle_batch_lines (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.movement_batches(id) on delete restrict,
  bundle_code_id uuid not null references public.commercial_bundle_codes(id) on delete restrict,
  bundle_id uuid not null references public.commercial_bundles(id) on delete restrict,
  code_snapshot text not null check (length(btrim(code_snapshot)) > 0),
  quantity integer not null check (quantity > 0),
  created_at timestamptz not null default now(),
  unique (batch_id, bundle_code_id)
);
create index bundle_batch_lines_code_idx on public.bundle_batch_lines(bundle_code_id);
create index bundle_batch_lines_bundle_idx on public.bundle_batch_lines(bundle_id);
alter table public.bundle_batch_lines enable row level security;
revoke all on public.bundle_batch_lines from public, anon, authenticated, service_role;
grant select on public.bundle_batch_lines to authenticated;
create policy bundle_batch_lines_internal_read on public.bundle_batch_lines
  for select to authenticated using (exists (
    select 1 from public.profiles as profile
    where profile.id = (select auth.uid()) and profile.is_active
  ));

create table private.bundle_stock_flow_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  idempotency_key uuid not null,
  direction text not null check (direction in ('INBOUND', 'OUTBOUND')),
  payload jsonb not null check (jsonb_typeof(payload) = 'array'),
  description text,
  allow_auto_assembly boolean not null,
  movement_batch_id uuid not null references public.movement_batches(id) on delete restrict,
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now()
);
create unique index bundle_stock_flow_requests_user_key_uidx
  on private.bundle_stock_flow_requests(user_id, idempotency_key) where user_id is not null;
create unique index bundle_stock_flow_requests_batch_uidx
  on private.bundle_stock_flow_requests(movement_batch_id);
alter table private.bundle_stock_flow_requests enable row level security;
revoke all on private.bundle_stock_flow_requests from public, anon, authenticated, service_role;

create function private.guard_bundle_stock_flow_receipt()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  -- Preserve immutable receipts, including payload/result, while allowing only
  -- the FK's anonymization when a profile is removed.
  if tg_op = 'UPDATE' and old.user_id is not null and new.user_id is null
    and (to_jsonb(old) - 'user_id') = (to_jsonb(new) - 'user_id') then
    return new;
  end if;
  raise exception using errcode = '23514', message = 'Bundle stock flow receipts are immutable.';
end;
$$;
revoke all on function private.guard_bundle_stock_flow_receipt() from public, anon, authenticated, service_role;
create trigger bundle_stock_flow_receipts_immutable before update or delete
  on private.bundle_stock_flow_requests for each row
  execute function private.guard_bundle_stock_flow_receipt();

create function private.stock_flow_with_ready_bundles(
  p_direction text, p_lines jsonb, p_idempotency_key uuid,
  p_description text, p_allow_auto_assembly boolean
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_user_name text;
  v_description text := nullif(btrim(p_description), '');
  v_line jsonb;
  v_kind text;
  v_field text;
  v_identity text;
  v_quantity numeric;
  v_normalized jsonb := '[]';
  v_payload jsonb;
  v_legacy_lines jsonb;
  v_bundle_lines jsonb;
  v_existing private.bundle_stock_flow_requests%rowtype;
  v_record record;
  v_bundle_id uuid;
  v_batch_id uuid;
  v_before integer;
  v_after bigint;
  v_result jsonb;
  v_bundle_quantity bigint;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'An authenticated user is required.';
  end if;
  select profile.name into v_user_name from public.profiles as profile
    where profile.id = v_user_id and profile.is_active for share;
  if not found then
    raise exception using errcode = '42501', message = 'An active profile is required.';
  end if;
  if p_idempotency_key is null or p_direction not in ('INBOUND', 'OUTBOUND')
    or p_allow_auto_assembly is null or length(v_description) > 500 then
    raise exception using errcode = '22023', message = 'Invalid stock flow request.';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception using errcode = '22023', message = 'p_lines must be a non-empty JSON array.';
  end if;
  if jsonb_array_length(p_lines) not between 1 and 500 then
    raise exception using errcode = '22023', message = 'Invalid number of stock flow lines.';
  end if;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_kind := v_line ->> 'kind';
    if jsonb_typeof(v_line) is distinct from 'object' or v_kind is null
      or v_kind not in ('ITEM', 'COMMERCIAL_CODE', 'BUNDLE_CODE', 'NEW_LOOSE_PART')
      or (v_kind = 'NEW_LOOSE_PART' and p_direction <> 'INBOUND')
      or jsonb_typeof(v_line -> 'quantity') is distinct from 'number' then
      raise exception using errcode = '22023', message = 'Invalid stock flow line.';
    end if;
    v_quantity := (v_line ->> 'quantity')::numeric;
    if v_quantity <> trunc(v_quantity) or v_quantity not between 1 and 2147483647 then
      raise exception using errcode = '22003', message = 'Quantity must be a positive integer within range.';
    end if;
    if v_kind = 'NEW_LOOSE_PART' then
      if v_line - array['kind', 'code', 'description', 'quantity'] <> '{}'::jsonb
        or jsonb_typeof(v_line -> 'code') is distinct from 'string'
        or jsonb_typeof(v_line -> 'description') is distinct from 'string'
        or length(btrim(v_line ->> 'code')) not between 1 and 120
        or length(btrim(v_line ->> 'description')) not between 1 and 500 then
        raise exception using errcode = '22023', message = 'Invalid new loose part.';
      end if;
      v_normalized := v_normalized || jsonb_build_array(jsonb_build_object(
        'kind', v_kind, 'identity', btrim(v_line ->> 'code'),
        'description', lower(btrim(v_line ->> 'description')), 'quantity', v_quantity
      ));
    else
      v_field := case v_kind when 'ITEM' then 'item_id'
        when 'COMMERCIAL_CODE' then 'commercial_code_id' else 'bundle_code_id' end;
      if v_line - array['kind', v_field, 'quantity'] <> '{}'::jsonb
        or jsonb_typeof(v_line -> v_field) is distinct from 'string'
        or (v_line ->> v_field) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception using errcode = '22023', message = 'Invalid stock flow target.';
      end if;
      v_identity := ((v_line ->> v_field)::uuid)::text;
      v_normalized := v_normalized || jsonb_build_array(jsonb_build_object(
        'kind', v_kind, 'identity', v_identity, 'quantity', v_quantity
      ));
    end if;
  end loop;
  if exists (select 1 from jsonb_array_elements(v_normalized) as line(value)
    group by value ->> 'kind', value ->> 'identity'
    having sum((value ->> 'quantity')::numeric) > 2147483647
      or count(distinct value ->> 'description') > 1) then
    raise exception using errcode = '22023', message = 'Conflicting or overflowing consolidated lines.';
  end if;
  select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'kind', normalized.kind, 'identity', normalized.identity,
    'description', normalized.description, 'quantity', normalized.quantity
  )) order by normalized.kind, normalized.identity) into v_payload
  from (select value ->> 'kind' as kind, value ->> 'identity' as identity,
    min(value ->> 'description') as description, sum((value ->> 'quantity')::numeric) as quantity
    from jsonb_array_elements(v_normalized) as line(value)
    group by value ->> 'kind', value ->> 'identity') as normalized;

  -- Same lock family as bundle assembly/adjustment, including no-op adjustments.
  -- Always acquire it before any catalog or balance lock.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'bundle-request:' || v_user_id::text || ':' || p_idempotency_key::text, 0));
  select * into v_existing from private.bundle_stock_flow_requests as request
    where request.user_id = v_user_id and request.idempotency_key = p_idempotency_key for share;
  if found then
    if v_existing.direction <> p_direction or v_existing.payload <> v_payload
      or v_existing.description is distinct from v_description
      or v_existing.allow_auto_assembly <> p_allow_auto_assembly then
      raise exception using errcode = '22023', message = 'idempotency_key has already been used with a different payload.';
    end if;
    return v_existing.result;
  end if;
  if exists (select 1 from private.bundle_operation_requests as request
    where request.user_id = v_user_id and request.idempotency_key = p_idempotency_key)
    or exists (select 1 from private.bundle_adjustment_requests as request
    where request.user_id = v_user_id and request.idempotency_key = p_idempotency_key) then
    raise exception using errcode = '22023', message = 'idempotency_key has already been used by another operation.';
  end if;
  select coalesce(jsonb_agg(value), '[]'::jsonb) into v_legacy_lines
    from jsonb_array_elements(p_lines) as line(value) where value ->> 'kind' <> 'BUNDLE_CODE';
  select coalesce(jsonb_agg(value), '[]'::jsonb) into v_bundle_lines
    from jsonb_array_elements(v_payload) as line(value) where value ->> 'kind' = 'BUNDLE_CODE';
  if jsonb_array_length(v_bundle_lines) = 0 then
    if p_direction = 'INBOUND' then
      return private.stock_inbound_lines_before_bundle_flow(p_lines, p_idempotency_key, p_description);
    else
      return private.stock_outbound_items_before_bundle_flow(p_lines, p_idempotency_key, p_description, p_allow_auto_assembly);
    end if;
  end if;
  if exists (select 1 from public.movement_batches as batch
    where batch.user_id = v_user_id and batch.idempotency_key = p_idempotency_key) then
    raise exception using errcode = '22023', message = 'idempotency_key has already been used by another operation.';
  end if;

  for v_record in select (value ->> 'identity')::uuid as id
    from jsonb_array_elements(v_bundle_lines) as line(value) order by id loop
    select code.bundle_id into v_bundle_id from public.commercial_bundle_codes as code
      where code.id = v_record.id and code.is_active for share;
    if not found then
      raise exception using errcode = '22023', message = 'Bundle code does not exist or is inactive.';
    end if;
  end loop;
  for v_record in select distinct code.bundle_id from public.commercial_bundle_codes as code
    join jsonb_array_elements(v_bundle_lines) as line(value) on code.id = (value ->> 'identity')::uuid
    order by code.bundle_id loop
    perform 1 from public.commercial_bundles as bundle
      where bundle.id = v_record.bundle_id and bundle.is_active for share;
    if not found then
      raise exception using errcode = '22023', message = 'Bundle does not exist or is inactive.';
    end if;
  end loop;

  -- Legacy workers acquire configuration then item balances. Bundle balances
  -- come last, matching explicit bundle assembly/disassembly's resource order.
  if jsonb_array_length(v_legacy_lines) > 0 then
    if p_direction = 'INBOUND' then
      v_result := private.stock_inbound_lines_before_bundle_flow(v_legacy_lines, p_idempotency_key, p_description);
    else
      v_result := private.stock_outbound_items_before_bundle_flow(v_legacy_lines, p_idempotency_key, p_description, p_allow_auto_assembly);
    end if;
    v_batch_id := (v_result ->> 'movement_batch_id')::uuid;
  elsif p_direction = 'INBOUND' then
    insert into public.movement_batches(movement_type, source, user_id, user_name_snapshot, description, idempotency_key)
      values ('INBOUND', 'MANUAL', v_user_id, v_user_name, v_description, p_idempotency_key) returning id into v_batch_id;
    v_result := jsonb_build_object('lines_processed', 0, 'total_quantity', 0, 'commercial_quantity', 0);
  else
    insert into public.movement_batches(movement_type, source, user_id, user_name_snapshot, description, idempotency_key)
      values ('OUTBOUND', 'MANUAL', v_user_id, v_user_name, v_description, p_idempotency_key) returning id into v_batch_id;
    v_result := jsonb_build_object('lines_processed', 0, 'total_quantity', 0, 'auto_assembled_quantity', 0);
  end if;
  v_bundle_quantity := 0;
  for v_record in select code.bundle_id, sum((value ->> 'quantity')::bigint) as quantity
    from jsonb_array_elements(v_bundle_lines) as line(value)
    join public.commercial_bundle_codes as code on code.id = (value ->> 'identity')::uuid
    group by code.bundle_id order by code.bundle_id loop
    if v_record.quantity > 2147483647 then
      raise exception using errcode = '22003', message = 'Bundle quantity exceeds integer range.';
    end if;
    if p_direction = 'INBOUND' then
      insert into public.bundle_stock_balances(bundle_id, quantity)
        values (v_record.bundle_id, 0) on conflict (bundle_id) do nothing;
    end if;
    select balance.quantity into v_before from public.bundle_stock_balances as balance
      where balance.bundle_id = v_record.bundle_id for update;
    v_before := coalesce(v_before, 0);
    v_after := v_before::bigint + case p_direction when 'INBOUND' then v_record.quantity else -v_record.quantity end;
    if v_after < 0 then
      raise exception using errcode = '23514', message = 'Insufficient stock of ready commercial bundle. Explicit assembly is required.';
    end if;
    if v_after > 2147483647 then
      raise exception using errcode = '22003', message = 'Bundle balance exceeds integer range.';
    end if;
    update public.bundle_stock_balances set quantity = v_after::integer, updated_at = now()
      where bundle_id = v_record.bundle_id;
    insert into public.bundle_stock_movements(batch_id, bundle_id, quantity_change, quantity_before, quantity_after)
      values (v_batch_id, v_record.bundle_id,
        (v_after - v_before)::integer, v_before, v_after::integer);
    v_bundle_quantity := v_bundle_quantity + v_record.quantity;
  end loop;
  insert into public.bundle_batch_lines(batch_id, bundle_code_id, bundle_id, code_snapshot, quantity)
    select v_batch_id, code.id, code.bundle_id, code.code, (value ->> 'quantity')::integer
    from jsonb_array_elements(v_bundle_lines) as line(value)
    join public.commercial_bundle_codes as code on code.id = (value ->> 'identity')::uuid;
  v_result := v_result || jsonb_build_object('movement_batch_id', v_batch_id,
    'lines_processed', (v_result ->> 'lines_processed')::integer + jsonb_array_length(v_bundle_lines),
    'total_quantity', (v_result ->> 'total_quantity')::bigint + v_bundle_quantity,
    'bundle_quantity', v_bundle_quantity);
  insert into private.bundle_stock_flow_requests(user_id, idempotency_key, direction, payload,
    description, allow_auto_assembly, movement_batch_id, result)
    values (v_user_id, p_idempotency_key, p_direction, v_payload,
      v_description, p_allow_auto_assembly, v_batch_id, v_result);
  return v_result;
end;
$$;
revoke all on function private.stock_flow_with_ready_bundles(text, jsonb, uuid, text, boolean)
  from public, anon, authenticated, service_role;

create function public.stock_inbound_lines(p_lines jsonb, p_idempotency_key uuid, p_description text default null)
returns jsonb language sql security definer set search_path = '' as $$
  select private.stock_flow_with_ready_bundles('INBOUND', p_lines, p_idempotency_key, p_description, false);
$$;
create function public.stock_outbound_items(p_lines jsonb, p_idempotency_key uuid, p_description text, p_allow_auto_assembly boolean)
returns jsonb language sql security definer set search_path = '' as $$
  select private.stock_flow_with_ready_bundles('OUTBOUND', p_lines, p_idempotency_key, p_description, p_allow_auto_assembly);
$$;
revoke all on function public.stock_inbound_lines(jsonb, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.stock_inbound_lines(jsonb, uuid, text) to authenticated;
revoke all on function public.stock_outbound_items(jsonb, uuid, text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.stock_outbound_items(jsonb, uuid, text, boolean) to authenticated;

commit;
