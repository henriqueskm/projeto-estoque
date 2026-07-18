create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, name)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'name', ''),
      nullif(new.raw_user_meta_data ->> 'full_name', '')
    )
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public;
revoke execute on function public.handle_new_user() from anon, authenticated;

create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();

insert into public.profiles (id, name)
select
  id,
  coalesce(
    nullif(raw_user_meta_data ->> 'name', ''),
    nullif(raw_user_meta_data ->> 'full_name', '')
  )
from auth.users
on conflict (id) do nothing;

alter table public.movement_batches
add column user_name_snapshot text;

alter table public.movement_batches
add constraint movement_batches_user_id_fkey
foreign key (user_id)
references public.profiles (id)
on delete set null;

create index movement_batches_user_id_idx
  on public.movement_batches (user_id);

create schema if not exists private;

revoke all on schema private from public;
grant usage on schema private to authenticated;

create function private.is_active_profile()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and is_active
  );
$$;

revoke execute on function private.is_active_profile() from public;
revoke execute on function private.is_active_profile() from anon;
grant execute on function private.is_active_profile() to authenticated;

alter function public.stock_inbound_item(uuid, integer, uuid, text, text)
set schema private;

alter function public.stock_outbound_item(uuid, integer, uuid, text, text)
set schema private;

alter function public.assemble_commercial_configuration(
  uuid,
  integer,
  uuid,
  text,
  text
)
set schema private;

alter function public.disassemble_commercial_configuration(
  uuid,
  integer,
  uuid,
  text,
  text
)
set schema private;

revoke all on function private.stock_inbound_item(
  uuid,
  integer,
  uuid,
  text,
  text
) from public, anon, authenticated;

revoke all on function private.stock_outbound_item(
  uuid,
  integer,
  uuid,
  text,
  text
) from public, anon, authenticated;

revoke all on function private.assemble_commercial_configuration(
  uuid,
  integer,
  uuid,
  text,
  text
) from public, anon, authenticated;

revoke all on function private.disassemble_commercial_configuration(
  uuid,
  integer,
  uuid,
  text,
  text
) from public, anon, authenticated;

create function public.stock_inbound_item(
  p_item_id uuid,
  p_quantity integer,
  p_source text,
  p_description text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_user_name text;
  v_batch_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception using
      errcode = '28000',
      message = 'An authenticated user is required.';
  end if;

  select name
  into v_user_name
  from public.profiles
  where id = v_user_id
    and is_active;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'The authenticated user does not have an active profile.';
  end if;

  v_batch_id := private.stock_inbound_item(
    p_item_id,
    p_quantity,
    v_user_id,
    p_source,
    p_description
  );

  update public.movement_batches
  set user_name_snapshot = v_user_name
  where id = v_batch_id;

  return v_batch_id;
end;
$$;

revoke execute on function public.stock_inbound_item(
  uuid,
  integer,
  text,
  text
) from public, anon;
grant execute on function public.stock_inbound_item(
  uuid,
  integer,
  text,
  text
) to authenticated;

create function public.stock_outbound_item(
  p_item_id uuid,
  p_quantity integer,
  p_source text,
  p_description text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_user_name text;
  v_batch_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception using
      errcode = '28000',
      message = 'An authenticated user is required.';
  end if;

  select name
  into v_user_name
  from public.profiles
  where id = v_user_id
    and is_active;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'The authenticated user does not have an active profile.';
  end if;

  v_batch_id := private.stock_outbound_item(
    p_item_id,
    p_quantity,
    v_user_id,
    p_source,
    p_description
  );

  update public.movement_batches
  set user_name_snapshot = v_user_name
  where id = v_batch_id;

  return v_batch_id;
end;
$$;

revoke execute on function public.stock_outbound_item(
  uuid,
  integer,
  text,
  text
) from public, anon;
grant execute on function public.stock_outbound_item(
  uuid,
  integer,
  text,
  text
) to authenticated;

create function public.assemble_commercial_configuration(
  p_configuration_id uuid,
  p_quantity integer,
  p_source text,
  p_description text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_user_name text;
  v_batch_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception using
      errcode = '28000',
      message = 'An authenticated user is required.';
  end if;

  select name
  into v_user_name
  from public.profiles
  where id = v_user_id
    and is_active;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'The authenticated user does not have an active profile.';
  end if;

  v_batch_id := private.assemble_commercial_configuration(
    p_configuration_id,
    p_quantity,
    v_user_id,
    p_source,
    p_description
  );

  update public.movement_batches
  set user_name_snapshot = v_user_name
  where id = v_batch_id;

  return v_batch_id;
end;
$$;

revoke execute on function public.assemble_commercial_configuration(
  uuid,
  integer,
  text,
  text
) from public, anon;
grant execute on function public.assemble_commercial_configuration(
  uuid,
  integer,
  text,
  text
) to authenticated;

create function public.disassemble_commercial_configuration(
  p_configuration_id uuid,
  p_quantity integer,
  p_source text,
  p_description text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_user_name text;
  v_batch_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception using
      errcode = '28000',
      message = 'An authenticated user is required.';
  end if;

  select name
  into v_user_name
  from public.profiles
  where id = v_user_id
    and is_active;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'The authenticated user does not have an active profile.';
  end if;

  v_batch_id := private.disassemble_commercial_configuration(
    p_configuration_id,
    p_quantity,
    v_user_id,
    p_source,
    p_description
  );

  update public.movement_batches
  set user_name_snapshot = v_user_name
  where id = v_batch_id;

  return v_batch_id;
end;
$$;

revoke execute on function public.disassemble_commercial_configuration(
  uuid,
  integer,
  text,
  text
) from public, anon;
grant execute on function public.disassemble_commercial_configuration(
  uuid,
  integer,
  text,
  text
) to authenticated;

alter table public.profiles enable row level security;
alter table public.items enable row level security;
alter table public.servo_models enable row level security;
alter table public.installation_kits enable row level security;
alter table public.repair_kits enable row level security;
alter table public.loose_parts enable row level security;
alter table public.commercial_configurations enable row level security;
alter table public.servo_repair_compatibility enable row level security;
alter table public.stock_balances enable row level security;
alter table public.configuration_stock_balances enable row level security;
alter table public.movement_batches enable row level security;
alter table public.stock_movements enable row level security;
alter table public.configuration_stock_movements enable row level security;
alter table public.assembly_operations enable row level security;

create policy profiles_select_active_users
on public.profiles
for select
to authenticated
using ((select private.is_active_profile()));

create policy items_select_active_users
on public.items
for select
to authenticated
using ((select private.is_active_profile()));

create policy servo_models_select_active_users
on public.servo_models
for select
to authenticated
using ((select private.is_active_profile()));

create policy installation_kits_select_active_users
on public.installation_kits
for select
to authenticated
using ((select private.is_active_profile()));

create policy repair_kits_select_active_users
on public.repair_kits
for select
to authenticated
using ((select private.is_active_profile()));

create policy loose_parts_select_active_users
on public.loose_parts
for select
to authenticated
using ((select private.is_active_profile()));

create policy commercial_configurations_select_active_users
on public.commercial_configurations
for select
to authenticated
using ((select private.is_active_profile()));

create policy servo_repair_compatibility_select_active_users
on public.servo_repair_compatibility
for select
to authenticated
using ((select private.is_active_profile()));

create policy stock_balances_select_active_users
on public.stock_balances
for select
to authenticated
using ((select private.is_active_profile()));

create policy configuration_stock_balances_select_active_users
on public.configuration_stock_balances
for select
to authenticated
using ((select private.is_active_profile()));

create policy movement_batches_select_active_users
on public.movement_batches
for select
to authenticated
using ((select private.is_active_profile()));

create policy stock_movements_select_active_users
on public.stock_movements
for select
to authenticated
using ((select private.is_active_profile()));

create policy configuration_stock_movements_select_active_users
on public.configuration_stock_movements
for select
to authenticated
using ((select private.is_active_profile()));

create policy assembly_operations_select_active_users
on public.assembly_operations
for select
to authenticated
using ((select private.is_active_profile()));

revoke all privileges on table
  public.profiles,
  public.items,
  public.servo_models,
  public.installation_kits,
  public.repair_kits,
  public.loose_parts,
  public.commercial_configurations,
  public.servo_repair_compatibility,
  public.stock_balances,
  public.configuration_stock_balances,
  public.movement_batches,
  public.stock_movements,
  public.configuration_stock_movements,
  public.assembly_operations
from anon, authenticated;

grant select on table
  public.profiles,
  public.items,
  public.servo_models,
  public.installation_kits,
  public.repair_kits,
  public.loose_parts,
  public.commercial_configurations,
  public.servo_repair_compatibility,
  public.stock_balances,
  public.configuration_stock_balances,
  public.movement_batches,
  public.stock_movements,
  public.configuration_stock_movements,
  public.assembly_operations
to authenticated;
