\set ON_ERROR_STOP on

begin;
set local standard_conforming_strings = on;
set local lock_timeout = '5s';
set local statement_timeout = '10min';

select set_config('nk_reset.execution_mode', :'execution_mode', false);
select set_config('nk_reset.confirm_phrase', :'confirm_phrase', false);
select set_config('nk_reset.backup_ack', :'backup_ack', false);
select set_config('nk_reset.operations_paused_ack', :'operations_paused_ack', false);
select set_config('nk_reset.expected_database_name', :'expected_database_name', false);
select set_config('nk_reset.expected_migration_count', :'expected_migration_count', false);
select set_config('nk_reset.expected_latest_migration', :'expected_latest_migration', false);
select set_config('nk_reset.expected_migration_fingerprint', :'expected_migration_fingerprint', false);
select set_config('nk_reset.expected_schema_fingerprint', :'expected_schema_fingerprint', false);
select set_config('nk_reset.expected_catalog_fingerprint', :'expected_catalog_fingerprint', false);
select set_config('nk_reset.expected_items', :'expected_items', false);
select set_config('nk_reset.expected_servo_models', :'expected_servo_models', false);
select set_config('nk_reset.expected_installation_kits', :'expected_installation_kits', false);
select set_config('nk_reset.expected_repair_kits', :'expected_repair_kits', false);
select set_config('nk_reset.expected_loose_parts', :'expected_loose_parts', false);
select set_config('nk_reset.expected_configurations', :'expected_configurations', false);
select set_config('nk_reset.expected_commercial_codes', :'expected_commercial_codes', false);
select set_config('nk_reset.expected_compatibilities', :'expected_compatibilities', false);
select set_config('nk_reset.expected_auth_users', :'expected_auth_users', false);
select set_config('nk_reset.expected_profiles', :'expected_profiles', false);
select set_config('nk_reset.expected_memberships', :'expected_memberships', false);
select set_config('nk_reset.expected_bucket_id', :'expected_bucket_id', false);
select set_config('nk_reset.expected_referenced_images', :'expected_referenced_images', false);
select set_config('nk_reset.expected_storage_objects', :'expected_storage_objects', false);
select set_config('nk_reset.approved_loose_parts', :'approved_loose_parts', true);
select set_config('nk_reset.expected_post_catalog_fingerprint', :'expected_post_catalog_fingerprint', true);
select set_config('nk_reset.expected_foreign_key_fingerprint', :'expected_foreign_key_fingerprint', true);
select set_config('nk_reset.expected_vehicle_brands', :'expected_vehicle_brands', true);
select set_config('nk_reset.expected_vehicle_applications', :'expected_vehicle_applications', true);
select set_config('nk_reset.required_relations', :'required_relations', false);
select set_config('nk_reset.push_subscription_action', :'push_subscription_action', false);
select set_config('nk_reset.force_validation_failure', :'force_validation_failure', false);

create function pg_temp.deployment_reset_schema_fingerprint()
returns text
language sql
stable
as $$
  with schema_parts as (
    select 'column|' || table_schema || '.' || table_name || '|' || ordinal_position || '|' || column_name || '|' || data_type || '|' || is_nullable || '|' || coalesce(column_default, '') as value
    from information_schema.columns
    where table_schema in ('public', 'private')
    union all
    select 'constraint|' || namespace.nspname || '|' || constraint_row.conname || '|' || pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
    from pg_catalog.pg_constraint as constraint_row
    join pg_catalog.pg_namespace as namespace on namespace.oid = constraint_row.connamespace
    where namespace.nspname in ('public', 'private')
    union all
    select 'function|' || namespace.nspname || '.' || procedure.proname || '|' || pg_catalog.pg_get_function_identity_arguments(procedure.oid) || '|' || pg_catalog.pg_get_functiondef(procedure.oid)
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname in ('public', 'private')
    union all
    select 'policy|' || schemaname || '.' || tablename || '|' || policyname || '|' || permissive || '|' || roles::text || '|' || coalesce(cmd, '') || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '')
    from pg_catalog.pg_policies
    where schemaname in ('public', 'storage')
    union all
    select 'trigger|' || namespace.nspname || '.' || relation.relname || '|' || trigger_row.tgname || '|' || pg_catalog.pg_get_triggerdef(trigger_row.oid, true) || '|' || trigger_row.tgenabled::text
    from pg_catalog.pg_trigger as trigger_row
    join pg_catalog.pg_class as relation on relation.oid = trigger_row.tgrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname in ('public', 'private') and not trigger_row.tgisinternal
    union all
    select 'rls|' || namespace.nspname || '.' || relation.relname || '|' || relation.relrowsecurity::text || '|' || relation.relforcerowsecurity::text
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname in ('public', 'private') and relation.relkind in ('r', 'p')
    union all
    select 'index|' || namespace.nspname || '.' || relation.relname || '|' || pg_catalog.pg_get_indexdef(index_row.indexrelid)
    from pg_catalog.pg_index as index_row
    join pg_catalog.pg_class as relation on relation.oid = index_row.indrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname in ('public', 'private')
    union all
    select 'view|' || namespace.nspname || '.' || relation.relname || '|' || pg_catalog.pg_get_viewdef(relation.oid, true)
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public' and relation.relkind = 'v'
  )
  select md5(string_agg(value, E'\n' order by value)) from schema_parts;
$$;

create function pg_temp.deployment_reset_catalog_fingerprint(p_excluded uuid[] default '{}'::uuid[])
returns text
language sql
stable
as $$
  with catalog_rows as (
    select 'items' kind, id::text row_key, md5((to_jsonb(t) - 'minimum_stock')::text) row_hash from public.items t
    union all select 'servo_models', item_id::text, md5(to_jsonb(t)::text) from public.servo_models t
    union all select 'installation_kits', item_id::text, md5(to_jsonb(t)::text) from public.installation_kits t
    union all select 'repair_kits', item_id::text, md5(to_jsonb(t)::text) from public.repair_kits t
    union all select 'loose_parts', item_id::text, md5(to_jsonb(t)::text) from public.loose_parts t
    union all select 'commercial_configurations', id::text, md5((to_jsonb(t) - 'minimum_stock')::text) from public.commercial_configurations t
    union all select 'commercial_configuration_codes', id::text, md5(to_jsonb(t)::text) from public.commercial_configuration_codes t
    union all select 'servo_repair_compatibility', servo_id::text || ':' || repair_kit_id::text, md5(to_jsonb(t)::text) from public.servo_repair_compatibility t
    union all select 'vehicle_application_brands', id::text, md5(to_jsonb(t)::text) from public.vehicle_application_brands t
    union all select 'vehicle_applications', id::text, md5(to_jsonb(t)::text) from public.vehicle_applications t
  )
  select md5(string_agg(kind || '|' || row_key || '|' || row_hash, E'\n' order by kind, row_key)) from catalog_rows
  where not (kind in ('items', 'loose_parts') and row_key = any(p_excluded::text[]));
$$;

-- Block concurrent writes before any snapshot, and keep the FK order explicit.
lock table public.push_notification_events,
  public.supplier_order_bulk_pickup_operations,
  public.safisa_portal_events,
  public.safisa_order_authorizations,
  public.supplier_order_stock_entry_lines,
  public.supplier_order_stock_entries,
  public.supplier_order_events,
  public.supplier_order_items,
  public.supplier_orders,
  private.configuration_operation_requests,
  private.stock_adjustment_requests,
  public.assembly_operations,
  public.inbound_batch_lines,
  public.outbound_batch_lines,
  public.stock_movements,
  public.configuration_stock_movements,
  public.movement_batches,
  public.stock_balances,
  public.configuration_stock_balances,
  public.minimum_stock_changes,
  public.configuration_minimum_stock_changes,
  public.items,
  public.loose_parts,
  public.servo_models,
  public.installation_kits,
  public.repair_kits,
  public.commercial_configurations,
  public.commercial_configuration_codes,
  public.servo_repair_compatibility,
  public.vehicle_application_brands,
  public.vehicle_applications,
  public.profiles,
  public.safisa_portal_members,
  public.push_subscriptions,
  auth.users,
  storage.buckets,
  storage.objects,
  supabase_migrations.schema_migrations in share row exclusive mode;

create temporary table deployment_reset_approved_parts on commit drop as
select (value ->> 'id')::uuid as id, value as identity
from jsonb_array_elements(:'approved_loose_parts'::jsonb);

create temporary table deployment_reset_expected_counts (
  relation_name text primary key, expected bigint not null, affected bigint
) on commit drop;
insert into deployment_reset_expected_counts
select 'public.push_notification_events', count(*) from public.push_notification_events
union all
select 'public.supplier_order_bulk_pickup_operations', count(*) from public.supplier_order_bulk_pickup_operations
union all
select 'public.safisa_portal_events', count(*) from public.safisa_portal_events
union all
select 'public.safisa_order_authorizations', count(*) from public.safisa_order_authorizations
union all
select 'public.supplier_order_stock_entry_lines', count(*) from public.supplier_order_stock_entry_lines
union all
select 'public.supplier_order_stock_entries', count(*) from public.supplier_order_stock_entries
union all
select 'public.supplier_order_events', count(*) from public.supplier_order_events
union all
select 'public.supplier_order_items', count(*) from public.supplier_order_items
union all
select 'public.supplier_orders', count(*) from public.supplier_orders
union all
select 'private.configuration_operation_requests', count(*) from private.configuration_operation_requests
union all
select 'private.stock_adjustment_requests', count(*) from private.stock_adjustment_requests
union all
select 'public.assembly_operations', count(*) from public.assembly_operations
union all
select 'public.inbound_batch_lines', count(*) from public.inbound_batch_lines
union all
select 'public.outbound_batch_lines', count(*) from public.outbound_batch_lines
union all
select 'public.stock_movements', count(*) from public.stock_movements
union all
select 'public.configuration_stock_movements', count(*) from public.configuration_stock_movements
union all
select 'public.movement_batches', count(*) from public.movement_batches
union all
select 'public.stock_balances', count(*) from public.stock_balances
union all
select 'public.configuration_stock_balances', count(*) from public.configuration_stock_balances
union all
select 'public.minimum_stock_changes', count(*) from public.minimum_stock_changes
union all
select 'public.configuration_minimum_stock_changes', count(*) from public.configuration_minimum_stock_changes;
insert into deployment_reset_expected_counts values
 ('public.loose_parts', (select count(*) from deployment_reset_approved_parts), null),
 ('public.items', (select count(*) from deployment_reset_approved_parts), null),
 ('items.minimum_stock', (select count(*) from public.items where minimum_stock <> 0), null),
 ('configurations.minimum_stock', (select count(*) from public.commercial_configurations where minimum_stock <> 0), null),
 ('supplier_order_items.readiness', (select count(*) from public.supplier_order_items), null);

create function pg_temp.deployment_reset_assert_affected(p_relation text, p_affected bigint)
returns void language plpgsql as $assert$
declare expected_count bigint;
begin
 select expected into strict expected_count from deployment_reset_expected_counts where relation_name = p_relation;
 if p_affected <> expected_count then
  raise exception 'Exact ROW_COUNT validation failed for %.', p_relation;
 end if;
 update deployment_reset_expected_counts set affected = p_affected where relation_name = p_relation;
end;
$assert$;

create function pg_temp.deployment_reset_fk_fingerprint()
returns text language sql stable as $fk$
 select md5(string_agg(ns.nspname || '.' || cs.relname || '|' || co.conname || '|' ||
   nt.nspname || '.' || ct.relname || '|' || pg_get_constraintdef(co.oid, true),
   E'\n' order by ns.nspname, cs.relname, co.conname))
 from pg_constraint co
 join pg_class cs on cs.oid = co.conrelid join pg_class ct on ct.oid = co.confrelid
 join pg_namespace ns on ns.oid = cs.relnamespace join pg_namespace nt on nt.oid = ct.relnamespace
 where co.contype = 'f' and (ns.nspname in ('public', 'private') or nt.nspname in ('public', 'private'));
$fk$;

create temporary table deployment_reset_snapshot (
  schema_fingerprint text not null,
  catalog_fingerprint text not null,
  migration_fingerprint text not null,
  migration_count integer not null,
  latest_migration text not null,
  auth_fingerprint text,
  auth_count bigint not null,
  profiles_fingerprint text,
  profiles_count bigint not null,
  memberships_fingerprint text,
  memberships_count bigint not null,
  storage_fingerprint text,
  storage_count bigint not null,
  bucket_fingerprint text,
  push_core_fingerprint text,
  push_fingerprint text,
  push_count bigint not null
) on commit drop;

insert into deployment_reset_snapshot
select
  pg_temp.deployment_reset_schema_fingerprint(),
  pg_temp.deployment_reset_catalog_fingerprint(),
  (select md5(string_agg(version || '|' || coalesce(name, ''), E'\n' order by version)) from supabase_migrations.schema_migrations),
  (select count(*) from supabase_migrations.schema_migrations),
  (select max(version) from supabase_migrations.schema_migrations),
  (select md5(string_agg(to_jsonb(auth_user)::text, E'\n' order by auth_user.id)) from auth.users as auth_user),
  (select count(*) from auth.users),
  (select md5(string_agg(to_jsonb(profile)::text, E'\n' order by profile.id)) from public.profiles as profile),
  (select count(*) from public.profiles),
  (select md5(string_agg(to_jsonb(member)::text, E'\n' order by member.user_id)) from public.safisa_portal_members as member),
  (select count(*) from public.safisa_portal_members),
  (select md5(string_agg(to_jsonb(storage_object)::text, E'\n' order by storage_object.id)) from storage.objects as storage_object where storage_object.bucket_id = :'expected_bucket_id'),
  (select count(*) from storage.objects where bucket_id = :'expected_bucket_id'),
  (select md5(string_agg(to_jsonb(bucket)::text, E'\n' order by bucket.id)) from storage.buckets as bucket where bucket.id = :'expected_bucket_id'),
  (select md5(string_agg(md5(user_id::text) || md5(device_id::text) || md5(firebase_installation_id), E'\n' order by id)) from public.push_subscriptions),
  (select md5(string_agg(to_jsonb(t)::text, E'\n' order by id)) from public.push_subscriptions t),
  (select count(*) from public.push_subscriptions);

do $guard$
declare
  snapshot deployment_reset_snapshot%rowtype;
  required_relation text;
begin
  select * into strict snapshot from deployment_reset_snapshot;

  if current_setting('nk_reset.execution_mode') <> 'EXECUTE'
    or current_setting('nk_reset.confirm_phrase') <> 'CONFIRMAR RESET DE IMPLANTACAO ESTOQUENK'
    or current_setting('nk_reset.backup_ack') <> 'BACKUP_VALIDATED'
    or current_setting('nk_reset.operations_paused_ack') <> 'OPERATIONS_PAUSED' then
    raise exception 'Deployment reset acknowledgements are incomplete.';
  end if;

  if current_database() <> current_setting('nk_reset.expected_database_name') then
    raise exception 'Database identifier guard failed.';
  end if;

  if snapshot.migration_count <> current_setting('nk_reset.expected_migration_count')::integer
    or snapshot.latest_migration <> current_setting('nk_reset.expected_latest_migration')
    or snapshot.migration_fingerprint <> current_setting('nk_reset.expected_migration_fingerprint') then
    raise exception 'Migration history guard failed.';
  end if;

  if snapshot.schema_fingerprint <> current_setting('nk_reset.expected_schema_fingerprint') then
    raise exception 'Schema fingerprint guard failed.';
  end if;

  if snapshot.catalog_fingerprint <> current_setting('nk_reset.expected_catalog_fingerprint') then
    raise exception 'Catalog fingerprint guard failed.';
  end if;

  if (select count(*) from public.items) <> current_setting('nk_reset.expected_items')::integer
    or (select count(*) from public.servo_models) <> current_setting('nk_reset.expected_servo_models')::integer
    or (select count(*) from public.installation_kits) <> current_setting('nk_reset.expected_installation_kits')::integer
    or (select count(*) from public.repair_kits) <> current_setting('nk_reset.expected_repair_kits')::integer
    or (select count(*) from public.loose_parts) <> current_setting('nk_reset.expected_loose_parts')::integer
    or (select count(*) from public.commercial_configurations) <> current_setting('nk_reset.expected_configurations')::integer
    or (select count(*) from public.commercial_configuration_codes) <> current_setting('nk_reset.expected_commercial_codes')::integer
    or (select count(*) from public.servo_repair_compatibility) <> current_setting('nk_reset.expected_compatibilities')::integer then
    raise exception 'Catalog count guard failed.';
  end if;

  if (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'code', i.code,
      'description', i.description, 'item_type', i.item_type,
      'is_active', i.is_active, 'notes', l.notes) order by i.id), '[]'::jsonb)
      from public.loose_parts l join public.items i on i.id = l.item_id)
      is distinct from (select coalesce(jsonb_agg(identity order by id), '[]'::jsonb) from deployment_reset_approved_parts)
    or (select count(distinct id) from deployment_reset_approved_parts) <>
      (select count(*) from deployment_reset_approved_parts) then
    raise exception 'Exact approved loose-part identity guard failed.';
  end if;

  if pg_temp.deployment_reset_catalog_fingerprint((select array_agg(id) from deployment_reset_approved_parts))
      is distinct from current_setting('nk_reset.expected_post_catalog_fingerprint')
    or pg_temp.deployment_reset_fk_fingerprint() is distinct from current_setting('nk_reset.expected_foreign_key_fingerprint')
    or (select count(*) from public.vehicle_application_brands) <> current_setting('nk_reset.expected_vehicle_brands')::integer
    or (select count(*) from public.vehicle_applications) <> current_setting('nk_reset.expected_vehicle_applications')::integer then
    raise exception 'Expected catalog delta/application/FK guard failed.';
  end if;

  if exists (select 1 from public.servo_models where item_id in (select id from deployment_reset_approved_parts))
    or exists (select 1 from public.installation_kits where item_id in (select id from deployment_reset_approved_parts))
    or exists (select 1 from public.repair_kits where item_id in (select id from deployment_reset_approved_parts))
    or exists (select 1 from public.commercial_configurations where servo_id in (select id from deployment_reset_approved_parts) or installation_kit_id in (select id from deployment_reset_approved_parts))
    or exists (select 1 from public.servo_repair_compatibility where servo_id in (select id from deployment_reset_approved_parts) or repair_kit_id in (select id from deployment_reset_approved_parts))
    or exists (select 1 from public.vehicle_applications a join public.items i on i.code = a.source_kit_code or i.code = a.source_servo_label where i.id in (select id from deployment_reset_approved_parts)) then
    raise exception 'Approved loose parts have protected structural references; human decision required.';
  end if;

  if snapshot.auth_count <> current_setting('nk_reset.expected_auth_users')::integer
    or snapshot.profiles_count <> current_setting('nk_reset.expected_profiles')::integer
    or snapshot.memberships_count <> current_setting('nk_reset.expected_memberships')::integer then
    raise exception 'Auth/profile/membership guard failed.';
  end if;

  if (select count(*) from storage.buckets where id = current_setting('nk_reset.expected_bucket_id')) <> 1
    or (select count(*) from public.commercial_configurations where image_path is not null) <> current_setting('nk_reset.expected_referenced_images')::integer
    or (select count(*) from storage.objects where bucket_id = current_setting('nk_reset.expected_bucket_id')) <> current_setting('nk_reset.expected_storage_objects')::integer
    or (select count(*) from storage.objects where bucket_id = current_setting('nk_reset.expected_bucket_id') and name in (select image_path from public.commercial_configurations where image_path is not null)) <> current_setting('nk_reset.expected_referenced_images')::integer then
    raise exception 'Storage preservation guard failed.';
  end if;

  foreach required_relation in array string_to_array(current_setting('nk_reset.required_relations'), ',') loop
    if to_regclass(required_relation) is null then
      raise exception 'Required structural relation is missing.';
    end if;
  end loop;

  if not exists (
    select 1 from pg_catalog.pg_trigger as trigger_row
    join pg_catalog.pg_class as relation on relation.oid = trigger_row.tgrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'safisa_portal_events'
      and trigger_row.tgname = 'safisa_portal_events_reject_mutation'
      and trigger_row.tgenabled = 'O'
  ) then
    raise exception 'Safisa immutable-event trigger guard failed.';
  end if;
end;
$guard$;

do $delete_push$ declare affected bigint; begin
  delete from public.supplier_order_bulk_pickup_operations;
  get diagnostics affected = row_count;
  perform pg_temp.deployment_reset_assert_affected('public.supplier_order_bulk_pickup_operations', affected);
  delete from public.push_notification_events;
  get diagnostics affected = row_count;
  perform pg_temp.deployment_reset_assert_affected('public.push_notification_events', affected);
end; $delete_push$;

alter table public.safisa_portal_events disable trigger safisa_portal_events_reject_mutation;
do $delete_safisa$ declare affected bigint; begin
  -- Only the explicitly audited event types; a new type makes ROW_COUNT fail.
  delete from public.safisa_portal_events where event_type in ('MEMBER_STATUS_CHANGED', 'ORDER_PUBLISHED', 'ORDER_REVOKED', 'READY_QUANTITY_INCREMENTED', 'READY_QUANTITIES_ALL_MARKED');
  get diagnostics affected = row_count;
  perform pg_temp.deployment_reset_assert_affected('public.safisa_portal_events', affected);
end; $delete_safisa$;
alter table public.safisa_portal_events enable trigger safisa_portal_events_reject_mutation;

do $delete_operational$ declare affected bigint; begin
  delete from public.safisa_order_authorizations;
  get diagnostics affected = row_count;
  perform pg_temp.deployment_reset_assert_affected('public.safisa_order_authorizations', affected);
  delete from public.supplier_order_stock_entry_lines;
  get diagnostics affected = row_count;
  perform pg_temp.deployment_reset_assert_affected('public.supplier_order_stock_entry_lines', affected);
  delete from public.supplier_order_stock_entries;
  get diagnostics affected = row_count;
  perform pg_temp.deployment_reset_assert_affected('public.supplier_order_stock_entries', affected);
  delete from public.supplier_order_events;
  get diagnostics affected = row_count;
  perform pg_temp.deployment_reset_assert_affected('public.supplier_order_events', affected);
  update public.supplier_order_items set ready_quantity = 0, picked_quantity = 0, stocked_quantity = 0, cancelled_quantity = 0;
  get diagnostics affected = row_count;
  perform pg_temp.deployment_reset_assert_affected('supplier_order_items.readiness', affected);
  delete from public.supplier_order_items;
  get diagnostics affected = row_count;
  perform pg_temp.deployment_reset_assert_affected('public.supplier_order_items', affected);
  delete from public.supplier_orders;
  get diagnostics affected = row_count;
  perform pg_temp.deployment_reset_assert_affected('public.supplier_orders', affected);
  delete from private.configuration_operation_requests;
  get diagnostics affected = row_count;
  perform pg_temp.deployment_reset_assert_affected('private.configuration_operation_requests', affected);
  delete from private.stock_adjustment_requests;
  get diagnostics affected = row_count;
  perform pg_temp.deployment_reset_assert_affected('private.stock_adjustment_requests', affected);
  delete from public.assembly_operations;
  get diagnostics affected = row_count;
  perform pg_temp.deployment_reset_assert_affected('public.assembly_operations', affected);
  delete from public.inbound_batch_lines;
  get diagnostics affected = row_count;
  perform pg_temp.deployment_reset_assert_affected('public.inbound_batch_lines', affected);
  delete from public.outbound_batch_lines;
  get diagnostics affected = row_count;
  perform pg_temp.deployment_reset_assert_affected('public.outbound_batch_lines', affected);
  delete from public.stock_movements;
  get diagnostics affected = row_count;
  perform pg_temp.deployment_reset_assert_affected('public.stock_movements', affected);
  delete from public.configuration_stock_movements;
  get diagnostics affected = row_count;
  perform pg_temp.deployment_reset_assert_affected('public.configuration_stock_movements', affected);
  delete from public.movement_batches;
  get diagnostics affected = row_count;
  perform pg_temp.deployment_reset_assert_affected('public.movement_batches', affected);
  delete from public.stock_balances;
  get diagnostics affected = row_count;
  perform pg_temp.deployment_reset_assert_affected('public.stock_balances', affected);
  delete from public.configuration_stock_balances;
  get diagnostics affected = row_count;
  perform pg_temp.deployment_reset_assert_affected('public.configuration_stock_balances', affected);
  delete from public.minimum_stock_changes;
  get diagnostics affected = row_count;
  perform pg_temp.deployment_reset_assert_affected('public.minimum_stock_changes', affected);
  delete from public.configuration_minimum_stock_changes;
  get diagnostics affected = row_count;
  perform pg_temp.deployment_reset_assert_affected('public.configuration_minimum_stock_changes', affected);
  update public.items set minimum_stock = 0 where minimum_stock <> 0;
  get diagnostics affected = row_count;
  perform pg_temp.deployment_reset_assert_affected('items.minimum_stock', affected);
  update public.commercial_configurations set minimum_stock = 0 where minimum_stock <> 0;
  get diagnostics affected = row_count;
  perform pg_temp.deployment_reset_assert_affected('configurations.minimum_stock', affected);
  delete from public.loose_parts where item_id in (select id from deployment_reset_approved_parts);
  get diagnostics affected = row_count;
  perform pg_temp.deployment_reset_assert_affected('public.loose_parts', affected);
  delete from public.items where id in (select id from deployment_reset_approved_parts);
  get diagnostics affected = row_count;
  perform pg_temp.deployment_reset_assert_affected('public.items', affected);
end; $delete_operational$;

do $push$
begin
  case current_setting('nk_reset.push_subscription_action')
    when 'PRESERVE' then null;
    when 'DISABLE' then
      update public.push_subscriptions set enabled = false, updated_at = now() where enabled;
    when 'DELETE' then
      delete from public.push_subscriptions;
    else
      raise exception 'Invalid push subscription action.';
  end case;
end;
$push$;

do $validate$
declare
  snapshot deployment_reset_snapshot%rowtype;
  operational_rows bigint;
begin
  select * into strict snapshot from deployment_reset_snapshot;

  select
      (select count(*) from public.movement_batches)
    + (select count(*) from public.stock_movements)
    + (select count(*) from public.configuration_stock_movements)
    + (select count(*) from public.assembly_operations)
    + (select count(*) from public.inbound_batch_lines)
    + (select count(*) from public.outbound_batch_lines)
    + (select count(*) from public.supplier_orders)
    + (select count(*) from public.supplier_order_items)
    + (select count(*) from public.supplier_order_events)
    + (select count(*) from public.supplier_order_stock_entries)
    + (select count(*) from public.supplier_order_stock_entry_lines)
    + (select count(*) from public.safisa_order_authorizations)
    + (select count(*) from public.safisa_portal_events)
    + (select count(*) from public.push_notification_events)
    + (select count(*) from public.supplier_order_bulk_pickup_operations)
    + (select count(*) from private.stock_adjustment_requests)
    + (select count(*) from private.configuration_operation_requests)
    + (select count(*) from public.stock_balances)
    + (select count(*) from public.configuration_stock_balances)
    + (select count(*) from public.minimum_stock_changes)
    + (select count(*) from public.configuration_minimum_stock_changes)
  into operational_rows;

  if operational_rows <> 0
    or exists (select 1 from public.items where minimum_stock <> 0)
    or exists (select 1 from public.commercial_configurations where minimum_stock <> 0) then
    raise exception 'Post-reset operational validation failed.';
  end if;

  if pg_temp.deployment_reset_catalog_fingerprint() is distinct from current_setting('nk_reset.expected_post_catalog_fingerprint')
    or pg_temp.deployment_reset_schema_fingerprint() <> snapshot.schema_fingerprint
    or (select md5(string_agg(version || '|' || coalesce(name, ''), E'\n' order by version)) from supabase_migrations.schema_migrations) <> snapshot.migration_fingerprint then
    raise exception 'Catalog/schema/migration preservation validation failed.';
  end if;

  if exists (select 1 from public.items where id in (select id from deployment_reset_approved_parts))
    or exists (select 1 from public.loose_parts)
    or (select count(*) from public.items) <> current_setting('nk_reset.expected_items')::integer - (select count(*) from deployment_reset_approved_parts)
    or exists (select 1 from deployment_reset_expected_counts where affected is null or affected <> expected) then
    raise exception 'Exact authorized catalog deletion/ROW_COUNT validation failed.';
  end if;

  if (select count(*) from auth.users) <> snapshot.auth_count
    or (select md5(string_agg(to_jsonb(auth_user)::text, E'\n' order by auth_user.id)) from auth.users as auth_user) is distinct from snapshot.auth_fingerprint
    or (select count(*) from public.profiles) <> snapshot.profiles_count
    or (select md5(string_agg(to_jsonb(profile)::text, E'\n' order by profile.id)) from public.profiles as profile) is distinct from snapshot.profiles_fingerprint
    or (select count(*) from public.safisa_portal_members) <> snapshot.memberships_count
    or (select md5(string_agg(to_jsonb(member)::text, E'\n' order by member.user_id)) from public.safisa_portal_members as member) is distinct from snapshot.memberships_fingerprint then
    raise exception 'Identity/membership preservation validation failed.';
  end if;

  if (select count(*) from storage.objects where bucket_id = current_setting('nk_reset.expected_bucket_id')) <> snapshot.storage_count
    or (select md5(string_agg(to_jsonb(storage_object)::text, E'\n' order by storage_object.id)) from storage.objects as storage_object where storage_object.bucket_id = current_setting('nk_reset.expected_bucket_id')) is distinct from snapshot.storage_fingerprint
    or (select md5(string_agg(to_jsonb(bucket)::text, E'\n' order by bucket.id)) from storage.buckets as bucket where bucket.id = current_setting('nk_reset.expected_bucket_id')) is distinct from snapshot.bucket_fingerprint
    or (select count(*) from storage.objects where bucket_id = current_setting('nk_reset.expected_bucket_id') and name in (select image_path from public.commercial_configurations where image_path is not null)) <> current_setting('nk_reset.expected_referenced_images')::integer then
    raise exception 'Storage preservation validation failed.';
  end if;

  if current_setting('nk_reset.push_subscription_action') = 'PRESERVE' and (
      (select count(*) from public.push_subscriptions) <> snapshot.push_count
      or (select md5(string_agg(to_jsonb(t)::text, E'\n' order by id)) from public.push_subscriptions t) is distinct from snapshot.push_fingerprint
      or (select md5(string_agg(md5(user_id::text) || md5(device_id::text) || md5(firebase_installation_id), E'\n' order by id)) from public.push_subscriptions) is distinct from snapshot.push_core_fingerprint
    ) then
    raise exception 'Push subscription preserve validation failed.';
  elsif current_setting('nk_reset.push_subscription_action') = 'DISABLE' and (
      (select count(*) from public.push_subscriptions) <> snapshot.push_count
      or exists (select 1 from public.push_subscriptions where enabled)
      or (select md5(string_agg(md5(user_id::text) || md5(device_id::text) || md5(firebase_installation_id), E'\n' order by id)) from public.push_subscriptions) is distinct from snapshot.push_core_fingerprint
    ) then
    raise exception 'Push subscription disable validation failed.';
  elsif current_setting('nk_reset.push_subscription_action') = 'DELETE' and exists (select 1 from public.push_subscriptions) then
    raise exception 'Push subscription delete validation failed.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_trigger as trigger_row
    join pg_catalog.pg_class as relation on relation.oid = trigger_row.tgrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'safisa_portal_events'
      and trigger_row.tgname = 'safisa_portal_events_reject_mutation'
      and trigger_row.tgenabled = 'O'
  ) then
    raise exception 'Safisa immutable-event trigger was not restored.';
  end if;

  if current_setting('nk_reset.force_validation_failure') = 'true' then
    raise exception 'Intentional local rollback validation failure.';
  end if;
end;
$validate$;

select jsonb_build_object(
  'reportType', 'RESET_OPERACIONAL_EXECUTED',
  'project', jsonb_build_object('name', :'expected_project_name', 'ref', :'identified_project_ref', 'database', current_database()),
  'pushSubscriptionAction', :'push_subscription_action',
  'operationalRowsRemaining', 0,
  'itemBalanceRows', (select count(*) from public.stock_balances),
  'configurationBalanceRows', (select count(*) from public.configuration_stock_balances),
  'itemsWithMinimum', (select count(*) from public.items where minimum_stock <> 0),
  'configurationsWithMinimum', (select count(*) from public.commercial_configurations where minimum_stock <> 0),
  'catalogFingerprint', pg_temp.deployment_reset_catalog_fingerprint(),
  'schemaFingerprint', pg_temp.deployment_reset_schema_fingerprint(),
  'committed', true
)::text;

commit;
