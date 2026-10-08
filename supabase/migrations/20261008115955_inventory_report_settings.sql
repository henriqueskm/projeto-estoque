-- Shared presentation settings only; no balance, catalog or movement is changed.
begin;

create table public.inventory_report_settings (
  singleton boolean primary key default true check (singleton),
  category_order text[] not null default array[
    'SERVO_WITH_KIT','SERVO_LOOSE','INSTALLATION_KIT','REPAIR_KIT','LOOSE_PART','BUNDLE'
  ],
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete restrict,
  constraint inventory_report_category_order_complete check (
    array_ndims(category_order) = 1
    and array_lower(category_order, 1) = 1
    and cardinality(category_order) = 6
    and array_position(category_order, null) is null
    and category_order @> array['SERVO_WITH_KIT','SERVO_LOOSE','INSTALLATION_KIT','REPAIR_KIT','LOOSE_PART','BUNDLE']::text[]
    and category_order <@ array['SERVO_WITH_KIT','SERVO_LOOSE','INSTALLATION_KIT','REPAIR_KIT','LOOSE_PART','BUNDLE']::text[]
  )
);

insert into public.inventory_report_settings (singleton) values (true);
alter table public.inventory_report_settings enable row level security;
revoke all on public.inventory_report_settings from public, anon, authenticated;
grant select on public.inventory_report_settings to authenticated;
grant update (category_order) on public.inventory_report_settings to authenticated;

create policy inventory_report_settings_read on public.inventory_report_settings
  for select to authenticated using ((select private.is_active_profile()));
create policy inventory_report_settings_update on public.inventory_report_settings
  for update to authenticated
  using ((select private.is_active_profile()))
  with check ((select private.is_active_profile()) and updated_by = (select auth.uid()));

create function private.audit_inventory_report_settings()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function private.audit_inventory_report_settings() from public, anon, authenticated;
create trigger audit_inventory_report_settings before update
  on public.inventory_report_settings for each row
  execute function private.audit_inventory_report_settings();

comment on table public.inventory_report_settings is
  'Singleton company-wide inventory report presentation order. Structural settings: preserve during an operational reset.';
commit;
