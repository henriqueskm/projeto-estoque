begin;

create table public.commercial_bundles (
  id uuid primary key default gen_random_uuid(),
  description text not null,
  minimum_stock integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commercial_bundles_description_check check (
    btrim(description) <> '' and char_length(description) <= 500
  ),
  constraint commercial_bundles_minimum_stock_check check (
    minimum_stock >= 0
  )
);

create table public.commercial_bundle_codes (
  id uuid primary key default gen_random_uuid(),
  bundle_id uuid not null
    references public.commercial_bundles (id) on delete restrict,
  code text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commercial_bundle_codes_code_check check (
    btrim(code) <> ''
    and code = btrim(code)
    and char_length(code) <= 120
  )
);

create table public.commercial_bundle_components (
  id uuid primary key default gen_random_uuid(),
  bundle_id uuid not null
    references public.commercial_bundles (id) on delete restrict,
  quantity_per_bundle integer not null,
  item_id uuid references public.items (id) on delete restrict,
  configuration_id uuid
    references public.commercial_configurations (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commercial_bundle_components_quantity_check check (
    quantity_per_bundle > 0
  ),
  constraint commercial_bundle_components_target_check check (
    (item_id is not null and configuration_id is null)
    or (item_id is null and configuration_id is not null)
  )
);

create unique index commercial_bundle_components_item_uidx
  on public.commercial_bundle_components (bundle_id, item_id)
  where item_id is not null;

create unique index commercial_bundle_components_configuration_uidx
  on public.commercial_bundle_components (bundle_id, configuration_id)
  where configuration_id is not null;

create index commercial_bundle_codes_bundle_id_idx
  on public.commercial_bundle_codes (bundle_id);

create index commercial_bundle_components_bundle_id_idx
  on public.commercial_bundle_components (bundle_id);

create index commercial_bundle_components_item_id_idx
  on public.commercial_bundle_components (item_id)
  where item_id is not null;

create index commercial_bundle_components_configuration_id_idx
  on public.commercial_bundle_components (configuration_id)
  where configuration_id is not null;

create table public.bundle_stock_balances (
  bundle_id uuid primary key
    references public.commercial_bundles (id) on delete restrict,
  quantity integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint bundle_stock_balances_quantity_check check (quantity >= 0)
);

create table public.bundle_stock_movements (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null
    references public.movement_batches (id) on delete restrict,
  bundle_id uuid not null
    references public.commercial_bundles (id) on delete restrict,
  quantity_change integer not null,
  quantity_before integer not null,
  quantity_after integer not null,
  created_at timestamptz not null default now(),
  constraint bundle_stock_movements_quantity_change_check check (
    quantity_change <> 0
  ),
  constraint bundle_stock_movements_quantity_before_check check (
    quantity_before >= 0
  ),
  constraint bundle_stock_movements_quantity_after_check check (
    quantity_after >= 0
  ),
  constraint bundle_stock_movements_quantity_consistency_check check (
    quantity_after = quantity_before + quantity_change
  )
);

create table public.bundle_assembly_operations (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null unique
    references public.movement_batches (id) on delete restrict,
  bundle_id uuid not null
    references public.commercial_bundles (id) on delete restrict,
  operation_type text not null,
  quantity integer not null,
  commercial_bundle_code_snapshot text not null,
  recipe_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  constraint bundle_assembly_operations_type_check check (
    operation_type in ('ASSEMBLY', 'DISASSEMBLY')
  ),
  constraint bundle_assembly_operations_quantity_check check (quantity > 0),
  constraint bundle_assembly_operations_code_check check (
    btrim(commercial_bundle_code_snapshot) <> ''
  ),
  constraint bundle_assembly_operations_recipe_check check (
    jsonb_typeof(recipe_snapshot) = 'array'
    and jsonb_array_length(recipe_snapshot) > 0
  )
);

create index bundle_stock_movements_batch_id_idx
  on public.bundle_stock_movements (batch_id);

create index bundle_stock_movements_bundle_id_idx
  on public.bundle_stock_movements (bundle_id);

create index bundle_stock_movements_created_at_idx
  on public.bundle_stock_movements (created_at);

create index bundle_assembly_operations_bundle_id_idx
  on public.bundle_assembly_operations (bundle_id);

create index bundle_assembly_operations_created_at_idx
  on public.bundle_assembly_operations (created_at);

create table private.bundle_operation_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  user_name_snapshot text,
  idempotency_key uuid not null,
  operation_type text not null,
  bundle_id uuid not null
    references public.commercial_bundles (id) on delete restrict,
  bundle_code_snapshot text not null,
  quantity integer not null,
  description text,
  movement_batch_id uuid
    references public.movement_batches (id) on delete restrict,
  result jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint bundle_operation_requests_operation_type_check check (
    operation_type in ('ASSEMBLY', 'DISASSEMBLY')
  ),
  constraint bundle_operation_requests_code_check check (
    btrim(bundle_code_snapshot) <> ''
  ),
  constraint bundle_operation_requests_quantity_check check (quantity > 0),
  constraint bundle_operation_requests_description_check check (
    description is null
    or (btrim(description) <> '' and char_length(description) <= 500)
  ),
  constraint bundle_operation_requests_completion_check check (
    (movement_batch_id is null and result is null and completed_at is null)
    or
    (movement_batch_id is not null and result is not null and completed_at is not null)
  )
);

create unique index bundle_operation_requests_user_key_uidx
  on private.bundle_operation_requests (user_id, idempotency_key)
  where user_id is not null;

create unique index bundle_operation_requests_batch_uidx
  on private.bundle_operation_requests (movement_batch_id)
  where movement_batch_id is not null;

create index bundle_operation_requests_bundle_id_idx
  on private.bundle_operation_requests (bundle_id);

create table private.bundle_adjustment_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  user_name_snapshot text,
  idempotency_key uuid not null,
  bundle_id uuid not null
    references public.commercial_bundles (id) on delete restrict,
  counted_quantity integer not null,
  expected_quantity integer not null,
  reason text not null,
  movement_batch_id uuid
    references public.movement_batches (id) on delete restrict,
  quantity_before integer,
  quantity_change integer,
  quantity_after integer,
  result jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint bundle_adjustment_requests_counted_check check (
    counted_quantity >= 0
  ),
  constraint bundle_adjustment_requests_expected_check check (
    expected_quantity >= 0
  ),
  constraint bundle_adjustment_requests_reason_check check (
    btrim(reason) <> '' and char_length(reason) <= 500
  ),
  constraint bundle_adjustment_requests_completion_check check (
    (
      movement_batch_id is null
      and quantity_before is null
      and quantity_change is null
      and quantity_after is null
      and result is null
      and completed_at is null
    )
    or
    (
      quantity_before >= 0
      and quantity_change is not null
      and quantity_after >= 0
      and quantity_after = counted_quantity
      and quantity_after = quantity_before + quantity_change
      and result is not null
      and completed_at is not null
      and (
        (quantity_change = 0 and movement_batch_id is null)
        or (quantity_change <> 0 and movement_batch_id is not null)
      )
    )
  )
);

create unique index bundle_adjustment_requests_user_key_uidx
  on private.bundle_adjustment_requests (user_id, idempotency_key)
  where user_id is not null;

create unique index bundle_adjustment_requests_batch_uidx
  on private.bundle_adjustment_requests (movement_batch_id)
  where movement_batch_id is not null;

create index bundle_adjustment_requests_bundle_id_idx
  on private.bundle_adjustment_requests (bundle_id);

revoke all privileges on table
  private.bundle_operation_requests,
  private.bundle_adjustment_requests
from public, anon, authenticated, service_role;

create function private.touch_commercial_bundle_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.touch_commercial_bundle_updated_at()
from public, anon, authenticated, service_role;

create trigger commercial_bundles_touch_updated_at
before update on public.commercial_bundles
for each row execute function private.touch_commercial_bundle_updated_at();

create trigger commercial_bundle_codes_touch_updated_at
before update on public.commercial_bundle_codes
for each row execute function private.touch_commercial_bundle_updated_at();

create trigger commercial_bundle_components_touch_updated_at
before update on public.commercial_bundle_components
for each row execute function private.touch_commercial_bundle_updated_at();

create function private.protect_commercial_bundle_recipe()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bundle_id uuid;
begin
  if tg_op = 'UPDATE'
    and old.bundle_id is not distinct from new.bundle_id
    and old.item_id is not distinct from new.item_id
    and old.configuration_id is not distinct from new.configuration_id
    and old.quantity_per_bundle is not distinct from new.quantity_per_bundle then
    return new;
  end if;

  for v_bundle_id in
    select distinct candidate.bundle_id
    from (
      select case when tg_op <> 'INSERT' then old.bundle_id end as bundle_id
      union all
      select case when tg_op <> 'DELETE' then new.bundle_id end
    ) as candidate
    where candidate.bundle_id is not null
    order by candidate.bundle_id
  loop
    perform 1
    from public.commercial_bundles as bundle
    where bundle.id = v_bundle_id
    for update;

    if exists (
      select 1
      from public.bundle_stock_balances as balance
      where balance.bundle_id = v_bundle_id
        and balance.quantity > 0
    ) or exists (
      select 1
      from public.bundle_stock_movements as movement
      where movement.bundle_id = v_bundle_id
    ) then
      raise exception using
        errcode = '55000',
        message = format(
          'Recipe for commercial bundle %s is immutable after first use.',
          v_bundle_id
        );
    end if;
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

revoke all on function private.protect_commercial_bundle_recipe()
from public, anon, authenticated, service_role;

create trigger commercial_bundle_components_protect_used_recipe
before insert or update or delete on public.commercial_bundle_components
for each row execute function private.protect_commercial_bundle_recipe();

create function private.assert_commercial_bundle_has_recipe()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_bundle_id uuid;
  v_bundle_ids uuid[];
begin
  if tg_table_name = 'commercial_bundles' then
    v_bundle_ids := array[new.id];
  elsif tg_op = 'DELETE' then
    v_bundle_ids := array[old.bundle_id];
  elsif tg_op = 'UPDATE' then
    v_bundle_ids := array[old.bundle_id, new.bundle_id];
  else
    v_bundle_ids := array[new.bundle_id];
  end if;

  foreach v_bundle_id in array v_bundle_ids
  loop
    if exists (
      select 1
      from public.commercial_bundles as bundle
      where bundle.id = v_bundle_id
        and bundle.is_active
    ) and not exists (
      select 1
      from public.commercial_bundle_components as component
      where component.bundle_id = v_bundle_id
    ) then
      raise exception using
        errcode = '23514',
        message = format(
          'Active commercial bundle %s must have a non-empty recipe.',
          v_bundle_id
        );
    end if;
  end loop;

  return null;
end;
$$;

revoke all on function private.assert_commercial_bundle_has_recipe()
from public, anon, authenticated, service_role;

create constraint trigger commercial_bundles_require_recipe
after insert or update on public.commercial_bundles
deferrable initially deferred
for each row execute function private.assert_commercial_bundle_has_recipe();

create constraint trigger commercial_bundle_components_require_recipe
after insert or update or delete on public.commercial_bundle_components
deferrable initially deferred
for each row execute function private.assert_commercial_bundle_has_recipe();

create function private.protect_bundle_request_receipt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = '55000',
      message = 'Bundle idempotency receipts are immutable.';
  end if;

  if old.user_id is distinct from new.user_id
    or old.user_name_snapshot is distinct from new.user_name_snapshot
    or old.idempotency_key is distinct from new.idempotency_key
    or old.operation_type is distinct from new.operation_type
    or old.bundle_id is distinct from new.bundle_id
    or old.bundle_code_snapshot is distinct from new.bundle_code_snapshot
    or old.quantity is distinct from new.quantity
    or old.description is distinct from new.description
    or old.created_at is distinct from new.created_at
    or old.completed_at is not null
    or new.completed_at is null
    or new.movement_batch_id is null
    or new.result is null then
    raise exception using
      errcode = '55000',
      message = 'Bundle idempotency receipts are immutable.';
  end if;

  return new;
end;
$$;

create function private.protect_bundle_adjustment_receipt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = '55000',
      message = 'Bundle adjustment receipts are immutable.';
  end if;

  if old.user_id is distinct from new.user_id
    or old.user_name_snapshot is distinct from new.user_name_snapshot
    or old.idempotency_key is distinct from new.idempotency_key
    or old.bundle_id is distinct from new.bundle_id
    or old.counted_quantity is distinct from new.counted_quantity
    or old.expected_quantity is distinct from new.expected_quantity
    or old.reason is distinct from new.reason
    or old.created_at is distinct from new.created_at
    or old.completed_at is not null
    or new.completed_at is null
    or new.result is null then
    raise exception using
      errcode = '55000',
      message = 'Bundle adjustment receipts are immutable.';
  end if;

  return new;
end;
$$;

revoke all on function private.protect_bundle_request_receipt()
from public, anon, authenticated, service_role;

revoke all on function private.protect_bundle_adjustment_receipt()
from public, anon, authenticated, service_role;

create trigger bundle_operation_requests_immutable_receipt
before update or delete on private.bundle_operation_requests
for each row execute function private.protect_bundle_request_receipt();

create trigger bundle_adjustment_requests_immutable_receipt
before update or delete on private.bundle_adjustment_requests
for each row execute function private.protect_bundle_adjustment_receipt();

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

  select item.code
  into v_conflict_code
  from public.items as item
  where (tg_table_name <> 'items' or item.id <> new.id)
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
  where (
      tg_table_name <> 'commercial_configuration_codes'
      or commercial_code.id <> new.id
    )
    and private.catalog_codes_conflict(commercial_code.code, new.code)
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

  select bundle_code.code
  into v_conflict_code
  from public.commercial_bundle_codes as bundle_code
  where (
      tg_table_name <> 'commercial_bundle_codes'
      or bundle_code.id <> new.id
    )
    and private.catalog_codes_conflict(bundle_code.code, new.code)
  order by bundle_code.code
  limit 1
  for share;

  if found then
    raise exception using
      errcode = '23514',
      message = format(
        'Code %s conflicts with commercial bundle code %s.',
        new.code,
        v_conflict_code
      );
  end if;

  if tg_table_name not in (
    'items',
    'commercial_configuration_codes',
    'commercial_bundle_codes'
  ) then
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
from public, anon, authenticated, service_role;

create trigger commercial_bundle_codes_enforce_catalog_code_namespace
before insert or update of code on public.commercial_bundle_codes
for each row execute function private.enforce_catalog_code_namespace();

alter table public.commercial_bundles enable row level security;
alter table public.commercial_bundle_codes enable row level security;
alter table public.commercial_bundle_components enable row level security;
alter table public.bundle_stock_balances enable row level security;
alter table public.bundle_stock_movements enable row level security;
alter table public.bundle_assembly_operations enable row level security;

create policy commercial_bundles_select_active_users
on public.commercial_bundles
for select
to authenticated
using ((select private.is_active_profile()));

create policy commercial_bundle_codes_select_active_users
on public.commercial_bundle_codes
for select
to authenticated
using ((select private.is_active_profile()));

create policy commercial_bundle_components_select_active_users
on public.commercial_bundle_components
for select
to authenticated
using ((select private.is_active_profile()));

create policy bundle_stock_balances_select_active_users
on public.bundle_stock_balances
for select
to authenticated
using ((select private.is_active_profile()));

create policy bundle_stock_movements_select_active_users
on public.bundle_stock_movements
for select
to authenticated
using ((select private.is_active_profile()));

create policy bundle_assembly_operations_select_active_users
on public.bundle_assembly_operations
for select
to authenticated
using ((select private.is_active_profile()));

revoke all privileges on table
  public.commercial_bundles,
  public.commercial_bundle_codes,
  public.commercial_bundle_components,
  public.bundle_stock_balances,
  public.bundle_stock_movements,
  public.bundle_assembly_operations
from public, anon, authenticated;

grant select on table
  public.commercial_bundles,
  public.commercial_bundle_codes,
  public.commercial_bundle_components,
  public.bundle_stock_balances,
  public.bundle_stock_movements,
  public.bundle_assembly_operations
to authenticated;

create function private.register_1hc_bundle()
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_bundle_id uuid;
  v_existing_bundle_id uuid;
  v_configuration_id uuid;
  v_configuration_count integer;
  v_item_ids uuid[];
  v_item_count integer;
  v_conflict_code text;
  v_policy record;
  v_expected_recipe jsonb;
  v_existing_recipe jsonb;
begin
  select *
  into strict v_policy
  from private.catalog_code_write_policy('1HC');

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_policy.lock_identity, 0)
  );

  select count(*), min(commercial_code.configuration_id::text)::uuid
  into v_configuration_count, v_configuration_id
  from public.commercial_configuration_codes as commercial_code
  join public.commercial_configurations as configuration
    on configuration.id = commercial_code.configuration_id
  where commercial_code.code = '1H'
    and commercial_code.is_active
    and configuration.is_active;

  if v_configuration_count <> 1 or v_configuration_id is null then
    raise exception using
      errcode = '23514',
      message = '1HC registration requires exactly one active 1H commercial configuration.';
  end if;

  select
    count(*),
    array_agg(item.id order by item.code)
  into v_item_count, v_item_ids
  from public.items as item
  join public.loose_parts as loose_part on loose_part.item_id = item.id
  where item.code = any (array['CIL', 'EMP', 'RES', 'COT'])
    and item.item_type = 'LOOSE_PART'
    and item.is_active;

  if v_item_count <> 4
    or v_item_ids is null
    or array_length(v_item_ids, 1) <> 4 then
    raise exception using
      errcode = '23514',
      message = '1HC registration requires active LOOSE_PART items CIL, EMP, RES, and COT.';
  end if;

  if exists (
    select 1
    from unnest(array['CIL', 'EMP', 'RES', 'COT']) as required(code)
    where (
      select count(*)
      from public.items as item
      join public.loose_parts as loose_part on loose_part.item_id = item.id
      where item.code = required.code
        and item.item_type = 'LOOSE_PART'
        and item.is_active
    ) <> 1
  ) then
    raise exception using
      errcode = '23514',
      message = '1HC registration requires each loose-part code to resolve exactly once.';
  end if;

  select item.code
  into v_conflict_code
  from public.items as item
  where private.catalog_codes_conflict(item.code, '1HC')
  order by item.code
  limit 1
  for share;

  if found then
    raise exception using
      errcode = '23514',
      message = format('1HC conflicts with physical catalog code %s.', v_conflict_code);
  end if;

  select commercial_code.code
  into v_conflict_code
  from public.commercial_configuration_codes as commercial_code
  where private.catalog_codes_conflict(commercial_code.code, '1HC')
  order by commercial_code.code
  limit 1
  for share;

  if found then
    raise exception using
      errcode = '23514',
      message = format(
        '1HC conflicts with commercial configuration code %s.',
        v_conflict_code
      );
  end if;

  select bundle_code.bundle_id
  into v_existing_bundle_id
  from public.commercial_bundle_codes as bundle_code
  where private.catalog_codes_conflict(bundle_code.code, '1HC')
  order by bundle_code.code
  limit 1
  for share;

  if found then
    if not exists (
      select 1
      from public.commercial_bundle_codes as bundle_code
      join public.commercial_bundles as bundle
        on bundle.id = bundle_code.bundle_id
      where bundle_code.bundle_id = v_existing_bundle_id
        and bundle_code.code = '1HC'
        and bundle_code.is_active
        and bundle.description = 'Conjunto comercial 1HC'
        and bundle.is_active
    ) then
      raise exception using
        errcode = '23514',
        message = 'Existing 1HC bundle identity does not match the approved definition.';
    end if;

    v_bundle_id := v_existing_bundle_id;
  else
    insert into public.commercial_bundles (
      description,
      minimum_stock,
      is_active
    )
    values ('Conjunto comercial 1HC', 0, true)
    returning id into v_bundle_id;

    insert into public.commercial_bundle_codes (
      bundle_id,
      code,
      is_active
    )
    values (v_bundle_id, '1HC', true);

    insert into public.commercial_bundle_components (
      bundle_id,
      quantity_per_bundle,
      configuration_id
    )
    values (v_bundle_id, 1, v_configuration_id);

    insert into public.commercial_bundle_components (
      bundle_id,
      quantity_per_bundle,
      item_id
    )
    select v_bundle_id, 1, item.id
    from public.items as item
    where item.code = any (array['CIL', 'EMP', 'RES', 'COT'])
      and item.item_type = 'LOOSE_PART'
      and item.is_active
    order by item.code;
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'kind', case
        when component.item_id is not null then 'ITEM'
        else 'COMMERCIAL_CONFIGURATION'
      end,
      'item_id', component.item_id,
      'configuration_id', component.configuration_id,
      'quantity_per_bundle', component.quantity_per_bundle
    )
    order by
      case when component.item_id is not null then 1 else 0 end,
      coalesce(component.item_id, component.configuration_id)
  )
  into v_existing_recipe
  from public.commercial_bundle_components as component
  where component.bundle_id = v_bundle_id;

  select jsonb_agg(value order by sort_group, target_id)
  into v_expected_recipe
  from (
    select
      0 as sort_group,
      v_configuration_id as target_id,
      jsonb_build_object(
        'kind', 'COMMERCIAL_CONFIGURATION',
        'item_id', null,
        'configuration_id', v_configuration_id,
        'quantity_per_bundle', 1
      ) as value
    union all
    select
      1,
      item_id,
      jsonb_build_object(
        'kind', 'ITEM',
        'item_id', item_id,
        'configuration_id', null,
        'quantity_per_bundle', 1
      )
    from unnest(v_item_ids) as item_id
  ) as expected;

  if v_existing_recipe is distinct from v_expected_recipe then
    raise exception using
      errcode = '23514',
      message = 'The stored 1HC recipe does not match 1H + CIL + EMP + RES + COT.';
  end if;

  return v_bundle_id;
end;
$$;

revoke all on function private.register_1hc_bundle()
from public, anon, authenticated, service_role;

do $$
declare
  v_target_code_count integer;
  v_loose_part_count integer;
  v_conflict_code text;
begin
  select catalog.code
  into v_conflict_code
  from (
    select item.code from public.items as item
    union all
    select code.code from public.commercial_configuration_codes as code
    union all
    select code.code from public.commercial_bundle_codes as code
  ) as catalog
  where private.catalog_codes_conflict(catalog.code, '1HC')
  order by catalog.code
  limit 1;

  if found then
    raise exception using
      errcode = '23514',
      message = format(
        '1HC registration cannot be deferred because catalog code %s already conflicts with 1HC.',
        v_conflict_code
      );
  end if;

  select count(*)
  into v_target_code_count
  from public.items as item
  where item.code = any (array['CIL', 'EMP', 'RES', 'COT']);

  select count(*)
  into v_loose_part_count
  from public.loose_parts;

  if v_target_code_count = 0 and v_loose_part_count = 0 then
    raise notice '1HC registration deferred: the clean versioned catalog has no loose parts. The strict private.register_1hc_bundle() guard remains available for a catalog-complete deployment.';
  else
    perform private.register_1hc_bundle();
  end if;
end;
$$;

create function private.commercial_bundle_recipe_snapshot(p_bundle_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'kind', case
          when component.item_id is not null then 'ITEM'
          else 'COMMERCIAL_CONFIGURATION'
        end,
        'component_id', coalesce(
          component.item_id,
          component.configuration_id
        ),
        'code', item.code,
        'commercial_codes', case
          when component.configuration_id is null then null
          else (
            select coalesce(
              jsonb_agg(code.code order by code.code),
              '[]'::jsonb
            )
            from public.commercial_configuration_codes as code
            where code.configuration_id = component.configuration_id
              and code.is_active
          )
        end,
        'quantity_per_bundle', component.quantity_per_bundle
      )
      order by
        case when component.configuration_id is not null then 0 else 1 end,
        coalesce(component.configuration_id, component.item_id)
    ),
    '[]'::jsonb
  )
  from public.commercial_bundle_components as component
  left join public.items as item on item.id = component.item_id
  where component.bundle_id = p_bundle_id;
$$;

create function private.commercial_bundle_maximum_assemblable(
  p_bundle_id uuid
)
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(min(available_quantity / quantity_per_bundle), 0)::integer
  from (
    select
      component.quantity_per_bundle,
      case
        when component.item_id is not null then coalesce(item_balance.quantity, 0)
        else coalesce(configuration_balance.quantity, 0)
      end as available_quantity
    from public.commercial_bundle_components as component
    left join public.stock_balances as item_balance
      on item_balance.item_id = component.item_id
    left join public.configuration_stock_balances as configuration_balance
      on configuration_balance.configuration_id = component.configuration_id
    where component.bundle_id = p_bundle_id
  ) as availability;
$$;

revoke all on function private.commercial_bundle_recipe_snapshot(uuid)
from public, anon, authenticated, service_role;

revoke all on function private.commercial_bundle_maximum_assemblable(uuid)
from public, anon, authenticated, service_role;

create function public.get_commercial_bundle_maximum_assemblable(
  p_bundle_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception using
      errcode = '28000',
      message = 'An authenticated user is required.';
  end if;

  if not exists (
    select 1
    from public.profiles as profile
    where profile.id = v_user_id
      and profile.is_active
  ) then
    raise exception using
      errcode = '42501',
      message = 'The authenticated user does not have an active profile.';
  end if;

  if not exists (
    select 1
    from public.commercial_bundles as bundle
    where bundle.id = p_bundle_id
      and bundle.is_active
  ) then
    raise exception using
      errcode = '22023',
      message = format(
        'Commercial bundle %s does not exist or is inactive.',
        p_bundle_id
      );
  end if;

  return private.commercial_bundle_maximum_assemblable(p_bundle_id);
end;
$$;

revoke all on function public.get_commercial_bundle_maximum_assemblable(uuid)
from public, anon, authenticated, service_role;

grant execute on function public.get_commercial_bundle_maximum_assemblable(uuid)
to authenticated;

create function private.execute_commercial_bundle_operation(
  p_operation_type text,
  p_bundle_code text,
  p_quantity integer,
  p_idempotency_key uuid,
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
  v_normalized_code text;
  v_normalized_description text;
  v_bundle_id uuid;
  v_request_id uuid;
  v_existing private.bundle_operation_requests%rowtype;
  v_batch_id uuid;
  v_other_batch_id uuid;
  v_recipe_snapshot jsonb;
  v_component record;
  v_component_count integer;
  v_active_component_count integer;
  v_required bigint;
  v_quantity_before integer;
  v_quantity_after bigint;
  v_bundle_before integer;
  v_bundle_after bigint;
  v_bundle_change bigint;
  v_maximum_before integer;
  v_component_movements jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  if p_user_id is null then
    raise exception using
      errcode = '22023',
      message = 'p_user_id is required for a commercial bundle operation.';
  end if;

  if p_operation_type not in ('ASSEMBLY', 'DISASSEMBLY') then
    raise exception using
      errcode = '22023',
      message = 'p_operation_type must be ASSEMBLY or DISASSEMBLY.';
  end if;

  v_normalized_code := btrim(p_bundle_code);
  if v_normalized_code is null or v_normalized_code = '' then
    raise exception using
      errcode = '22023',
      message = 'p_bundle_code is required.';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception using
      errcode = '22023',
      message = 'p_quantity must be a positive PostgreSQL integer.';
  end if;

  if p_idempotency_key is null then
    raise exception using
      errcode = '22023',
      message = 'p_idempotency_key is required for a commercial bundle operation.';
  end if;

  v_normalized_description := nullif(btrim(p_description), '');
  if v_normalized_description is not null
    and char_length(v_normalized_description) > 500 then
    raise exception using
      errcode = '22023',
      message = 'p_description must contain at most 500 characters.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'bundle-request:' || p_user_id::text || ':' || p_idempotency_key::text,
      0
    )
  );

  select request.*
  into v_existing
  from private.bundle_operation_requests as request
  where request.user_id = p_user_id
    and request.idempotency_key = p_idempotency_key
  for share;

  if found then
    if v_existing.completed_at is null or v_existing.result is null then
      raise exception using
        errcode = '23505',
        message = 'The existing commercial bundle operation could not be resolved.';
    end if;

    if v_existing.operation_type is distinct from p_operation_type
      or v_existing.bundle_code_snapshot is distinct from v_normalized_code
      or v_existing.quantity is distinct from p_quantity
      or v_existing.description is distinct from v_normalized_description then
      raise exception using
        errcode = '22023',
        message = 'p_idempotency_key has already been used with a different commercial bundle operation.';
    end if;

    select batch.id
    into v_other_batch_id
    from public.movement_batches as batch
    where batch.user_id = p_user_id
      and batch.idempotency_key = p_idempotency_key;

    if not found or v_other_batch_id is distinct from v_existing.movement_batch_id then
      raise exception using
        errcode = '23514',
        message = 'The movement batch for the existing commercial bundle operation could not be resolved.';
    end if;

    return v_existing.result;
  end if;

  if exists (
    select 1
    from private.bundle_adjustment_requests as request
    where request.user_id = p_user_id
      and request.idempotency_key = p_idempotency_key
  ) or exists (
    select 1
    from public.movement_batches as batch
    where batch.user_id = p_user_id
      and batch.idempotency_key = p_idempotency_key
  ) then
    raise exception using
      errcode = '22023',
      message = 'p_idempotency_key has already been used by another stock operation.';
  end if;

  select bundle.id
  into v_bundle_id
  from public.commercial_bundle_codes as bundle_code
  join public.commercial_bundles as bundle on bundle.id = bundle_code.bundle_id
  where bundle_code.code = v_normalized_code
    and bundle_code.is_active
    and bundle.is_active
  for share of bundle_code, bundle;

  if not found then
    raise exception using
      errcode = '22023',
      message = format(
        'Commercial bundle code %s does not exist or is inactive.',
        v_normalized_code
      );
  end if;

  insert into private.bundle_operation_requests (
    user_id,
    user_name_snapshot,
    idempotency_key,
    operation_type,
    bundle_id,
    bundle_code_snapshot,
    quantity,
    description
  )
  values (
    p_user_id,
    p_user_name,
    p_idempotency_key,
    p_operation_type,
    v_bundle_id,
    v_normalized_code,
    p_quantity,
    v_normalized_description
  )
  returning id into v_request_id;

  perform component.id
  from public.commercial_bundle_components as component
  where component.bundle_id = v_bundle_id
  order by
    case when component.configuration_id is not null then 0 else 1 end,
    coalesce(component.configuration_id, component.item_id)
  for share;

  select count(*)
  into v_component_count
  from public.commercial_bundle_components as component
  where component.bundle_id = v_bundle_id;

  if v_component_count = 0 then
    raise exception using
      errcode = '23514',
      message = format('Commercial bundle %s has no recipe.', v_bundle_id);
  end if;

  perform configuration.id
  from public.commercial_configurations as configuration
  join public.commercial_bundle_components as component
    on component.configuration_id = configuration.id
  where component.bundle_id = v_bundle_id
  order by configuration.id
  for share of configuration;

  perform item.id
  from public.items as item
  join public.commercial_bundle_components as component
    on component.item_id = item.id
  where component.bundle_id = v_bundle_id
  order by item.id
  for share of item;

  select count(*)
  into v_active_component_count
  from public.commercial_bundle_components as component
  left join public.items as item on item.id = component.item_id
  left join public.commercial_configurations as configuration
    on configuration.id = component.configuration_id
  where component.bundle_id = v_bundle_id
    and (
      (component.item_id is not null and item.is_active)
      or (component.configuration_id is not null and configuration.is_active)
    );

  if v_active_component_count <> v_component_count then
    raise exception using
      errcode = '23514',
      message = format(
        'Commercial bundle %s contains an inactive or missing component.',
        v_bundle_id
      );
  end if;

  v_recipe_snapshot := private.commercial_bundle_recipe_snapshot(v_bundle_id);

  insert into public.configuration_stock_balances (
    configuration_id,
    quantity
  )
  select component.configuration_id, 0
  from public.commercial_bundle_components as component
  where component.bundle_id = v_bundle_id
    and component.configuration_id is not null
  order by component.configuration_id
  on conflict (configuration_id) do nothing;

  perform balance.configuration_id
  from public.configuration_stock_balances as balance
  join public.commercial_bundle_components as component
    on component.configuration_id = balance.configuration_id
  where component.bundle_id = v_bundle_id
  order by balance.configuration_id
  for update of balance;

  insert into public.stock_balances (item_id, quantity)
  select component.item_id, 0
  from public.commercial_bundle_components as component
  where component.bundle_id = v_bundle_id
    and component.item_id is not null
  order by component.item_id
  on conflict (item_id) do nothing;

  perform balance.item_id
  from public.stock_balances as balance
  join public.commercial_bundle_components as component
    on component.item_id = balance.item_id
  where component.bundle_id = v_bundle_id
  order by balance.item_id
  for update of balance;

  insert into public.bundle_stock_balances (bundle_id, quantity)
  values (v_bundle_id, 0)
  on conflict (bundle_id) do nothing;

  select balance.quantity
  into v_bundle_before
  from public.bundle_stock_balances as balance
  where balance.bundle_id = v_bundle_id
  for update;

  if v_bundle_before is null then
    raise exception using
      errcode = '23514',
      message = 'The commercial bundle balance could not be locked.';
  end if;

  v_maximum_before := private.commercial_bundle_maximum_assemblable(
    v_bundle_id
  );

  if p_operation_type = 'ASSEMBLY'
    and v_maximum_before < p_quantity then
    raise exception using
      errcode = '23514',
      message = format(
        'Insufficient free component stock for bundle %s: maximum %s, requested %s.',
        v_normalized_code,
        v_maximum_before,
        p_quantity
      );
  end if;

  if p_operation_type = 'DISASSEMBLY'
    and v_bundle_before < p_quantity then
    raise exception using
      errcode = '23514',
      message = format(
        'Insufficient assembled stock for bundle %s: available %s, requested %s.',
        v_normalized_code,
        v_bundle_before,
        p_quantity
      );
  end if;

  for v_component in
    select component.*
    from public.commercial_bundle_components as component
    where component.bundle_id = v_bundle_id
    order by
      case when component.configuration_id is not null then 0 else 1 end,
      coalesce(component.configuration_id, component.item_id)
  loop
    v_required := v_component.quantity_per_bundle::bigint * p_quantity::bigint;

    if v_required > 2147483647 then
      raise exception using
        errcode = '22003',
        message = 'Commercial bundle component quantity exceeds the PostgreSQL integer range.';
    end if;

    if v_component.configuration_id is not null then
      select balance.quantity
      into v_quantity_before
      from public.configuration_stock_balances as balance
      where balance.configuration_id = v_component.configuration_id;
    else
      select balance.quantity
      into v_quantity_before
      from public.stock_balances as balance
      where balance.item_id = v_component.item_id;
    end if;

    if p_operation_type = 'ASSEMBLY' then
      v_quantity_after := v_quantity_before::bigint - v_required;
    else
      v_quantity_after := v_quantity_before::bigint + v_required;
    end if;

    if v_quantity_after < 0 then
      raise exception using
        errcode = '23514',
        message = 'Commercial bundle assembly would make a component balance negative.';
    end if;

    if v_quantity_after > 2147483647 then
      raise exception using
        errcode = '22003',
        message = 'Commercial bundle disassembly would overflow a component balance.';
    end if;
  end loop;

  v_bundle_change := case
    when p_operation_type = 'ASSEMBLY' then p_quantity::bigint
    else -p_quantity::bigint
  end;
  v_bundle_after := v_bundle_before::bigint + v_bundle_change;

  if v_bundle_after < 0 or v_bundle_after > 2147483647 then
    raise exception using
      errcode = '22003',
      message = 'Commercial bundle operation would exceed the bundle balance range.';
  end if;

  begin
    insert into public.movement_batches (
      movement_type,
      source,
      user_id,
      user_name_snapshot,
      description,
      idempotency_key
    )
    values (
      p_operation_type,
      'MANUAL',
      p_user_id,
      p_user_name,
      v_normalized_description,
      p_idempotency_key
    )
    returning id into v_batch_id;
  exception
    when unique_violation then
      raise exception using
        errcode = '22023',
        message = 'p_idempotency_key has already been used by another stock operation.';
  end;

  for v_component in
    select component.*
    from public.commercial_bundle_components as component
    where component.bundle_id = v_bundle_id
    order by
      case when component.configuration_id is not null then 0 else 1 end,
      coalesce(component.configuration_id, component.item_id)
  loop
    v_required := v_component.quantity_per_bundle::bigint * p_quantity::bigint;

    if v_component.configuration_id is not null then
      select balance.quantity
      into v_quantity_before
      from public.configuration_stock_balances as balance
      where balance.configuration_id = v_component.configuration_id;

      v_quantity_after := v_quantity_before::bigint + case
        when p_operation_type = 'ASSEMBLY' then -v_required
        else v_required
      end;

      update public.configuration_stock_balances
      set quantity = v_quantity_after::integer,
          updated_at = now()
      where configuration_id = v_component.configuration_id;

      insert into public.configuration_stock_movements (
        batch_id,
        configuration_id,
        quantity_change,
        quantity_before,
        quantity_after
      )
      values (
        v_batch_id,
        v_component.configuration_id,
        (v_quantity_after - v_quantity_before)::integer,
        v_quantity_before,
        v_quantity_after::integer
      );

      v_component_movements := v_component_movements || jsonb_build_array(
        jsonb_build_object(
          'kind', 'COMMERCIAL_CONFIGURATION',
          'component_id', v_component.configuration_id,
          'quantity_before', v_quantity_before,
          'quantity_change', (v_quantity_after - v_quantity_before)::integer,
          'quantity_after', v_quantity_after::integer
        )
      );
    else
      select balance.quantity
      into v_quantity_before
      from public.stock_balances as balance
      where balance.item_id = v_component.item_id;

      v_quantity_after := v_quantity_before::bigint + case
        when p_operation_type = 'ASSEMBLY' then -v_required
        else v_required
      end;

      update public.stock_balances
      set quantity = v_quantity_after::integer,
          updated_at = now()
      where item_id = v_component.item_id;

      insert into public.stock_movements (
        batch_id,
        item_id,
        quantity_change,
        quantity_before,
        quantity_after
      )
      values (
        v_batch_id,
        v_component.item_id,
        (v_quantity_after - v_quantity_before)::integer,
        v_quantity_before,
        v_quantity_after::integer
      );

      v_component_movements := v_component_movements || jsonb_build_array(
        jsonb_build_object(
          'kind', 'ITEM',
          'component_id', v_component.item_id,
          'quantity_before', v_quantity_before,
          'quantity_change', (v_quantity_after - v_quantity_before)::integer,
          'quantity_after', v_quantity_after::integer
        )
      );
    end if;
  end loop;

  update public.bundle_stock_balances
  set quantity = v_bundle_after::integer,
      updated_at = now()
  where bundle_id = v_bundle_id;

  insert into public.bundle_stock_movements (
    batch_id,
    bundle_id,
    quantity_change,
    quantity_before,
    quantity_after
  )
  values (
    v_batch_id,
    v_bundle_id,
    v_bundle_change::integer,
    v_bundle_before,
    v_bundle_after::integer
  );

  insert into public.bundle_assembly_operations (
    batch_id,
    bundle_id,
    operation_type,
    quantity,
    commercial_bundle_code_snapshot,
    recipe_snapshot
  )
  values (
    v_batch_id,
    v_bundle_id,
    p_operation_type,
    p_quantity,
    v_normalized_code,
    v_recipe_snapshot
  );

  v_result := jsonb_build_object(
    'movement_batch_id', v_batch_id,
    'operation_type', p_operation_type,
    'bundle_id', v_bundle_id,
    'bundle_code', v_normalized_code,
    'quantity', p_quantity,
    'bundle_quantity_before', v_bundle_before,
    'bundle_quantity_after', v_bundle_after::integer,
    'maximum_assemblable_before', v_maximum_before,
    'component_movements', v_component_movements,
    'operation_applied', true
  );

  update private.bundle_operation_requests
  set movement_batch_id = v_batch_id,
      result = v_result,
      completed_at = now()
  where id = v_request_id;

  return v_result;
end;
$$;

revoke all on function private.execute_commercial_bundle_operation(
  text,
  text,
  integer,
  uuid,
  text,
  uuid,
  text
) from public, anon, authenticated, service_role;

create function public.assemble_commercial_bundle(
  p_bundle_code text,
  p_quantity integer,
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

  return private.execute_commercial_bundle_operation(
    'ASSEMBLY',
    p_bundle_code,
    p_quantity,
    p_idempotency_key,
    p_description,
    v_user_id,
    v_user_name
  );
end;
$$;

create function public.disassemble_commercial_bundle(
  p_bundle_code text,
  p_quantity integer,
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

  return private.execute_commercial_bundle_operation(
    'DISASSEMBLY',
    p_bundle_code,
    p_quantity,
    p_idempotency_key,
    p_description,
    v_user_id,
    v_user_name
  );
end;
$$;

revoke all on function public.assemble_commercial_bundle(
  text,
  integer,
  uuid,
  text
) from public, anon, authenticated, service_role;

revoke all on function public.disassemble_commercial_bundle(
  text,
  integer,
  uuid,
  text
) from public, anon, authenticated, service_role;

grant execute on function public.assemble_commercial_bundle(
  text,
  integer,
  uuid,
  text
) to authenticated;

grant execute on function public.disassemble_commercial_bundle(
  text,
  integer,
  uuid,
  text
) to authenticated;

create function private.adjust_commercial_bundle_stock_checked(
  p_bundle_id uuid,
  p_counted_quantity integer,
  p_expected_quantity integer,
  p_reason text,
  p_idempotency_key uuid,
  p_user_id uuid,
  p_user_name text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_normalized_reason text;
  v_existing private.bundle_adjustment_requests%rowtype;
  v_request_id uuid;
  v_quantity_before integer;
  v_quantity_change bigint;
  v_batch_id uuid;
  v_other_batch_id uuid;
  v_result jsonb;
begin
  if p_user_id is null then
    raise exception using
      errcode = '22023',
      message = 'p_user_id is required for a commercial bundle adjustment.';
  end if;

  if p_bundle_id is null then
    raise exception using
      errcode = '22023',
      message = 'p_bundle_id is required for a commercial bundle adjustment.';
  end if;

  if p_counted_quantity is null or p_counted_quantity < 0 then
    raise exception using
      errcode = '22023',
      message = 'p_counted_quantity must be a non-negative PostgreSQL integer.';
  end if;

  if p_expected_quantity is null or p_expected_quantity < 0 then
    raise exception using
      errcode = '22023',
      message = 'p_expected_quantity must be a non-negative PostgreSQL integer.';
  end if;

  v_normalized_reason := btrim(p_reason);
  if v_normalized_reason is null
    or v_normalized_reason = ''
    or char_length(v_normalized_reason) > 500 then
    raise exception using
      errcode = '22023',
      message = 'p_reason must contain between 1 and 500 characters.';
  end if;

  if p_idempotency_key is null then
    raise exception using
      errcode = '22023',
      message = 'p_idempotency_key is required for a commercial bundle adjustment.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'bundle-request:' || p_user_id::text || ':' || p_idempotency_key::text,
      0
    )
  );

  select request.*
  into v_existing
  from private.bundle_adjustment_requests as request
  where request.user_id = p_user_id
    and request.idempotency_key = p_idempotency_key
  for share;

  if found then
    if v_existing.completed_at is null or v_existing.result is null then
      raise exception using
        errcode = '23505',
        message = 'The existing commercial bundle adjustment could not be resolved.';
    end if;

    if v_existing.bundle_id is distinct from p_bundle_id
      or v_existing.counted_quantity is distinct from p_counted_quantity
      or v_existing.expected_quantity is distinct from p_expected_quantity
      or v_existing.reason is distinct from v_normalized_reason then
      raise exception using
        errcode = '22023',
        message = 'p_idempotency_key has already been used with a different commercial bundle adjustment.';
    end if;

    if v_existing.movement_batch_id is not null then
      select batch.id
      into v_other_batch_id
      from public.movement_batches as batch
      where batch.user_id = p_user_id
        and batch.idempotency_key = p_idempotency_key;

      if not found or v_other_batch_id is distinct from v_existing.movement_batch_id then
        raise exception using
          errcode = '23514',
          message = 'The movement batch for the existing commercial bundle adjustment could not be resolved.';
      end if;
    end if;

    return v_existing.result;
  end if;

  if exists (
    select 1
    from private.bundle_operation_requests as request
    where request.user_id = p_user_id
      and request.idempotency_key = p_idempotency_key
  ) or exists (
    select 1
    from public.movement_batches as batch
    where batch.user_id = p_user_id
      and batch.idempotency_key = p_idempotency_key
  ) then
    raise exception using
      errcode = '22023',
      message = 'p_idempotency_key has already been used by another stock operation.';
  end if;

  perform 1
  from public.commercial_bundles as bundle
  where bundle.id = p_bundle_id
    and bundle.is_active
  for share;

  if not found then
    raise exception using
      errcode = '22023',
      message = format(
        'Commercial bundle %s does not exist or is inactive.',
        p_bundle_id
      );
  end if;

  insert into private.bundle_adjustment_requests (
    user_id,
    user_name_snapshot,
    idempotency_key,
    bundle_id,
    counted_quantity,
    expected_quantity,
    reason
  )
  values (
    p_user_id,
    p_user_name,
    p_idempotency_key,
    p_bundle_id,
    p_counted_quantity,
    p_expected_quantity,
    v_normalized_reason
  )
  returning id into v_request_id;

  insert into public.bundle_stock_balances (bundle_id, quantity)
  values (p_bundle_id, 0)
  on conflict (bundle_id) do nothing;

  select balance.quantity
  into v_quantity_before
  from public.bundle_stock_balances as balance
  where balance.bundle_id = p_bundle_id
  for update;

  if v_quantity_before is null then
    raise exception using
      errcode = '23514',
      message = 'The commercial bundle balance could not be locked for adjustment.';
  end if;

  if v_quantity_before is distinct from p_expected_quantity then
    raise exception using
      errcode = '40001',
      message = 'bundle_stock_adjustment_quantity_conflict';
  end if;

  v_quantity_change := p_counted_quantity::bigint - v_quantity_before::bigint;

  if v_quantity_change < -2147483648::bigint
    or v_quantity_change > 2147483647::bigint then
    raise exception using
      errcode = '22003',
      message = 'Commercial bundle adjustment exceeds the PostgreSQL integer range.';
  end if;

  if v_quantity_change = 0 then
    v_result := jsonb_build_object(
      'movement_batch_id', null,
      'adjustment_applied', false,
      'bundle_id', p_bundle_id,
      'quantity_before', v_quantity_before,
      'quantity_change', 0,
      'quantity_after', p_counted_quantity
    );

    update private.bundle_adjustment_requests
    set quantity_before = v_quantity_before,
        quantity_change = 0,
        quantity_after = p_counted_quantity,
        result = v_result,
        completed_at = now()
    where id = v_request_id;

    return v_result;
  end if;

  begin
    insert into public.movement_batches (
      movement_type,
      source,
      user_id,
      user_name_snapshot,
      description,
      idempotency_key
    )
    values (
      'ADJUSTMENT',
      'MANUAL',
      p_user_id,
      p_user_name,
      v_normalized_reason,
      p_idempotency_key
    )
    returning id into v_batch_id;
  exception
    when unique_violation then
      raise exception using
        errcode = '22023',
        message = 'p_idempotency_key has already been used by another stock operation.';
  end;

  update public.bundle_stock_balances
  set quantity = p_counted_quantity,
      updated_at = now()
  where bundle_id = p_bundle_id;

  insert into public.bundle_stock_movements (
    batch_id,
    bundle_id,
    quantity_change,
    quantity_before,
    quantity_after
  )
  values (
    v_batch_id,
    p_bundle_id,
    v_quantity_change::integer,
    v_quantity_before,
    p_counted_quantity
  );

  v_result := jsonb_build_object(
    'movement_batch_id', v_batch_id,
    'adjustment_applied', true,
    'bundle_id', p_bundle_id,
    'quantity_before', v_quantity_before,
    'quantity_change', v_quantity_change::integer,
    'quantity_after', p_counted_quantity
  );

  update private.bundle_adjustment_requests
  set movement_batch_id = v_batch_id,
      quantity_before = v_quantity_before,
      quantity_change = v_quantity_change::integer,
      quantity_after = p_counted_quantity,
      result = v_result,
      completed_at = now()
  where id = v_request_id;

  return v_result;
end;
$$;

create function public.adjust_commercial_bundle_stock_checked(
  p_bundle_id uuid,
  p_counted_quantity integer,
  p_expected_quantity integer,
  p_reason text,
  p_idempotency_key uuid
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

  return private.adjust_commercial_bundle_stock_checked(
    p_bundle_id,
    p_counted_quantity,
    p_expected_quantity,
    p_reason,
    p_idempotency_key,
    v_user_id,
    v_user_name
  );
end;
$$;

revoke all on function private.adjust_commercial_bundle_stock_checked(
  uuid,
  integer,
  integer,
  text,
  uuid,
  uuid,
  text
) from public, anon, authenticated, service_role;

revoke all on function public.adjust_commercial_bundle_stock_checked(
  uuid,
  integer,
  integer,
  text,
  uuid
) from public, anon, authenticated, service_role;

grant execute on function public.adjust_commercial_bundle_stock_checked(
  uuid,
  integer,
  integer,
  text,
  uuid
) to authenticated;

comment on table public.commercial_bundles is
  'Commercially named assembled sets whose stock and recipe are distinct from physical items and servo-plus-kit configurations.';

comment on table public.commercial_bundle_components is
  'A non-nested bundle recipe. Each row consumes either a free item balance or a free assembled configuration balance.';

comment on table public.bundle_stock_balances is
  'Available assembled bundle stock. Components embedded in this balance remain physically present but are not free for another assembly.';

comment on table public.bundle_stock_movements is
  'Immutable quantity ledger for assembled commercial bundle balances.';

comment on table public.bundle_assembly_operations is
  'Assembly/disassembly audit with the selected bundle code and full recipe snapshot at execution time.';

comment on function private.register_1hc_bundle() is
  'Fail-closed 1HC catalog registration resolved by active business codes, never environment-specific UUIDs.';

comment on function public.get_commercial_bundle_maximum_assemblable(uuid) is
  'Returns capacity from free item/configuration balances only; embedded components are intentionally excluded.';

comment on function public.adjust_commercial_bundle_stock_checked(
  uuid,
  integer,
  integer,
  text,
  uuid
) is
  'Applies an idempotent absolute bundle count only when the locked balance equals the caller displayed quantity.';

commit;
