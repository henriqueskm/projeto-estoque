alter table public.commercial_configurations
add column minimum_stock integer not null default 0,
add constraint commercial_configurations_minimum_stock_check check (
  minimum_stock >= 0
);

comment on column public.commercial_configurations.minimum_stock is
  'Minimum mounted quantity for the physical configuration. Zero disables minimum-stock alerts.';

create table public.configuration_minimum_stock_changes (
  id uuid primary key default gen_random_uuid(),
  configuration_id uuid not null
    references public.commercial_configurations (id) on delete restrict,
  previous_minimum_stock integer not null,
  new_minimum_stock integer not null,
  user_id uuid references public.profiles (id) on delete set null,
  user_name_snapshot text,
  created_at timestamptz not null default now(),
  constraint configuration_minimum_stock_changes_previous_value_check check (
    previous_minimum_stock >= 0
  ),
  constraint configuration_minimum_stock_changes_new_value_check check (
    new_minimum_stock >= 0
  ),
  constraint configuration_minimum_stock_changes_distinct_values_check check (
    previous_minimum_stock <> new_minimum_stock
  )
);

comment on table public.configuration_minimum_stock_changes is
  'Audit history for physical commercial-configuration minimum-stock settings. Aliases sharing a configuration share the same setting.';

create index configuration_minimum_stock_changes_configuration_id_idx
  on public.configuration_minimum_stock_changes (configuration_id);

create index configuration_minimum_stock_changes_user_id_idx
  on public.configuration_minimum_stock_changes (user_id);

create index configuration_minimum_stock_changes_created_at_idx
  on public.configuration_minimum_stock_changes (created_at);

alter table public.configuration_minimum_stock_changes enable row level security;

create policy configuration_minimum_stock_changes_select_active_users
on public.configuration_minimum_stock_changes
for select
to authenticated
using ((select private.is_active_profile()));

revoke all privileges on table public.configuration_minimum_stock_changes
from public, anon, authenticated;

grant select on table public.configuration_minimum_stock_changes
to authenticated;

create function private.set_configuration_minimum_stock(
  p_configuration_id uuid,
  p_minimum_stock integer,
  p_user_id uuid,
  p_user_name text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_previous_minimum_stock integer;
  v_change_id uuid;
begin
  if p_user_id is null then
    raise exception using
      errcode = '22023',
      message = 'p_user_id is required to change configuration minimum stock.';
  end if;

  if p_minimum_stock is null or p_minimum_stock < 0 then
    raise exception using
      errcode = '22023',
      message = 'p_minimum_stock must be a non-negative PostgreSQL integer.';
  end if;

  select configuration.minimum_stock
  into v_previous_minimum_stock
  from public.commercial_configurations as configuration
  where configuration.id = p_configuration_id
  for update;

  if not found then
    raise exception using
      errcode = '22023',
      message = format(
        'Commercial configuration %s does not exist.',
        p_configuration_id
      );
  end if;

  if v_previous_minimum_stock = p_minimum_stock then
    return jsonb_build_object(
      'change_applied', false,
      'change_id', null,
      'previous_minimum_stock', v_previous_minimum_stock,
      'new_minimum_stock', p_minimum_stock
    );
  end if;

  update public.commercial_configurations
  set minimum_stock = p_minimum_stock,
      updated_at = now()
  where id = p_configuration_id;

  insert into public.configuration_minimum_stock_changes (
    configuration_id,
    previous_minimum_stock,
    new_minimum_stock,
    user_id,
    user_name_snapshot
  )
  values (
    p_configuration_id,
    v_previous_minimum_stock,
    p_minimum_stock,
    p_user_id,
    p_user_name
  )
  returning id into v_change_id;

  return jsonb_build_object(
    'change_applied', true,
    'change_id', v_change_id,
    'previous_minimum_stock', v_previous_minimum_stock,
    'new_minimum_stock', p_minimum_stock
  );
end;
$$;

revoke all on function private.set_configuration_minimum_stock(
  uuid,
  integer,
  uuid,
  text
) from public, anon, authenticated;

create function public.set_configuration_minimum_stock(
  p_configuration_id uuid,
  p_minimum_stock integer
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

  return private.set_configuration_minimum_stock(
    p_configuration_id,
    p_minimum_stock,
    v_user_id,
    v_user_name
  );
end;
$$;

revoke all on function public.set_configuration_minimum_stock(uuid, integer)
from public, anon, authenticated;

grant execute on function public.set_configuration_minimum_stock(uuid, integer)
to authenticated;
