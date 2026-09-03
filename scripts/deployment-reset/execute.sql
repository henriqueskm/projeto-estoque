\set ON_ERROR_STOP on

begin;
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
select set_config('nk_reset.expected_dynamic_item_ids', :'expected_dynamic_item_ids', false);
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

create function pg_temp.deployment_reset_catalog_fingerprint()
returns text
language sql
stable
as $$
  with catalog_rows as (
    select 'items' as kind, id::text as row_key,
      md5(id::text) || md5(code) || md5(description) || md5(item_type) || md5(is_active::text) as row_hash
    from public.items
    union all
    select 'servo_models', item_id::text, md5(item_id::text) || md5(coalesce(model, '<NULL>')) || md5(coalesce(notes, '<NULL>')) from public.servo_models
    union all
    select 'installation_kits', item_id::text, md5(item_id::text) || md5(coalesce(name, '<NULL>')) || md5(coalesce(notes, '<NULL>')) from public.installation_kits
    union all
    select 'repair_kits', item_id::text, md5(item_id::text) || md5(coalesce(name, '<NULL>')) || md5(coalesce(notes, '<NULL>')) from public.repair_kits
    union all
    select 'loose_parts', item_id::text, md5(item_id::text) || md5(coalesce(notes, '<NULL>')) from public.loose_parts
    union all
    select 'commercial_configurations', id::text,
      md5(id::text) || md5(coalesce(description, '<NULL>')) || md5(servo_id::text) || md5(installation_kit_id::text) || md5(is_active::text) || md5(coalesce(image_path, '<NULL>'))
    from public.commercial_configurations
    union all
    select 'commercial_configuration_codes', id::text,
      md5(id::text) || md5(configuration_id::text) || md5(code) || md5(is_active::text)
    from public.commercial_configuration_codes
    union all
    select 'servo_repair_compatibility', servo_id::text || ':' || repair_kit_id::text,
      md5(servo_id::text) || md5(repair_kit_id::text)
    from public.servo_repair_compatibility
  )
  select md5(string_agg(kind || '|' || row_key || '|' || row_hash, E'\n' order by kind, row_key)) from catalog_rows;
$$;

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

  if (select count(*) from public.items where id::text = any(string_to_array(current_setting('nk_reset.expected_dynamic_item_ids'), ',')))
      <> cardinality(string_to_array(current_setting('nk_reset.expected_dynamic_item_ids'), ',')) then
    raise exception 'Dynamic catalog item preservation guard failed.';
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

delete from public.push_notification_events;

alter table public.safisa_portal_events
  disable trigger safisa_portal_events_reject_mutation;

delete from public.safisa_portal_events
where event_type in (
  'MEMBER_STATUS_CHANGED',
  'ORDER_PUBLISHED',
  'ORDER_REVOKED',
  'READY_QUANTITY_INCREMENTED',
  'READY_QUANTITY_CORRECTED',
  'READY_QUANTITIES_ALL_MARKED'
);

alter table public.safisa_portal_events
  enable trigger safisa_portal_events_reject_mutation;

delete from public.safisa_order_authorizations;
delete from public.supplier_order_stock_entry_lines;
delete from public.supplier_order_stock_entries;
delete from public.supplier_order_events;

update public.supplier_order_items
set ready_quantity = 0,
    picked_quantity = 0,
    stocked_quantity = 0,
    cancelled_quantity = 0
where ready_quantity <> 0
   or picked_quantity <> 0
   or stocked_quantity <> 0
   or cancelled_quantity <> 0;

delete from public.supplier_order_items;
delete from public.supplier_orders;

delete from private.configuration_operation_requests;
delete from private.stock_adjustment_requests;
delete from public.assembly_operations;
delete from public.inbound_batch_lines;
delete from public.outbound_batch_lines;
delete from public.stock_movements;
delete from public.configuration_stock_movements;
delete from public.movement_batches;
delete from public.stock_balances;
delete from public.configuration_stock_balances;

update public.items set minimum_stock = 0 where minimum_stock <> 0;
update public.commercial_configurations set minimum_stock = 0 where minimum_stock <> 0;
delete from public.minimum_stock_changes;
delete from public.configuration_minimum_stock_changes;

\if :{?push_subscription_action}
\else
  \set push_subscription_action PRESERVE
\endif

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

  if pg_temp.deployment_reset_catalog_fingerprint() <> snapshot.catalog_fingerprint
    or pg_temp.deployment_reset_schema_fingerprint() <> snapshot.schema_fingerprint
    or (select md5(string_agg(version || '|' || coalesce(name, ''), E'\n' order by version)) from supabase_migrations.schema_migrations) <> snapshot.migration_fingerprint then
    raise exception 'Catalog/schema/migration preservation validation failed.';
  end if;

  if (select count(*) from public.items where id::text = any(string_to_array(current_setting('nk_reset.expected_dynamic_item_ids'), ',')))
      <> cardinality(string_to_array(current_setting('nk_reset.expected_dynamic_item_ids'), ',')) then
    raise exception 'Dynamic catalog items were not preserved.';
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
