\set ON_ERROR_STOP on

with
schema_parts as (
  select 'column|' || table_schema || '.' || table_name || '|' || ordinal_position || '|' || column_name || '|' || data_type || '|' || is_nullable || '|' || coalesce(column_default, '') as value
  from information_schema.columns
  where table_schema in ('public', 'private')
  union all
  select 'constraint|' || namespace.nspname || '|' || constraint_row.conname || '|' || pg_get_constraintdef(constraint_row.oid, true)
  from pg_constraint as constraint_row
  join pg_namespace as namespace on namespace.oid = constraint_row.connamespace
  where namespace.nspname in ('public', 'private')
  union all
  select 'function|' || namespace.nspname || '.' || procedure.proname || '|' || pg_get_function_identity_arguments(procedure.oid) || '|' || pg_get_functiondef(procedure.oid)
  from pg_proc as procedure
  join pg_namespace as namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname in ('public', 'private')
  union all
  select 'policy|' || schemaname || '.' || tablename || '|' || policyname || '|' || permissive || '|' || roles::text || '|' || coalesce(cmd, '') || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '')
  from pg_policies
  where schemaname in ('public', 'storage')
  union all
  select 'trigger|' || namespace.nspname || '.' || relation.relname || '|' || trigger_row.tgname || '|' || pg_get_triggerdef(trigger_row.oid, true) || '|' || trigger_row.tgenabled::text
  from pg_trigger as trigger_row
  join pg_class as relation on relation.oid = trigger_row.tgrelid
  join pg_namespace as namespace on namespace.oid = relation.relnamespace
  where namespace.nspname in ('public', 'private') and not trigger_row.tgisinternal
  union all
  select 'rls|' || namespace.nspname || '.' || relation.relname || '|' || relation.relrowsecurity::text || '|' || relation.relforcerowsecurity::text
  from pg_class as relation
  join pg_namespace as namespace on namespace.oid = relation.relnamespace
  where namespace.nspname in ('public', 'private') and relation.relkind in ('r', 'p')
  union all
  select 'index|' || namespace.nspname || '.' || relation.relname || '|' || pg_get_indexdef(index_row.indexrelid)
  from pg_index as index_row
  join pg_class as relation on relation.oid = index_row.indrelid
  join pg_namespace as namespace on namespace.oid = relation.relnamespace
  where namespace.nspname in ('public', 'private')
  union all
  select 'view|' || namespace.nspname || '.' || relation.relname || '|' || pg_get_viewdef(relation.oid, true)
  from pg_class as relation
  join pg_namespace as namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public' and relation.relkind = 'v'
),
schema_state as (
  select md5(string_agg(value, E'\n' order by value)) as fingerprint
  from schema_parts
),
catalog_rows as (
  select 'items' as kind, id::text as row_key,
    md5(id::text) || md5(code) || md5(description) || md5(item_type) || md5(is_active::text) as row_hash
  from public.items
  union all
  select 'servo_models', item_id::text,
    md5(item_id::text) || md5(coalesce(model, '<NULL>')) || md5(coalesce(notes, '<NULL>'))
  from public.servo_models
  union all
  select 'installation_kits', item_id::text,
    md5(item_id::text) || md5(coalesce(name, '<NULL>')) || md5(coalesce(notes, '<NULL>'))
  from public.installation_kits
  union all
  select 'repair_kits', item_id::text,
    md5(item_id::text) || md5(coalesce(name, '<NULL>')) || md5(coalesce(notes, '<NULL>'))
  from public.repair_kits
  union all
  select 'loose_parts', item_id::text,
    md5(item_id::text) || md5(coalesce(notes, '<NULL>'))
  from public.loose_parts
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
),
catalog_state as (
  select md5(string_agg(kind || '|' || row_key || '|' || row_hash, E'\n' order by kind, row_key)) as fingerprint
  from catalog_rows
),
migration_state as (
  select count(*)::integer as migration_count,
    max(version) as latest_migration,
    md5(string_agg(version || '|' || coalesce(name, ''), E'\n' order by version)) as fingerprint
  from supabase_migrations.schema_migrations
),
catalog_counts as (
  select
    (select count(*) from public.items) as items,
    (select count(*) from public.servo_models) as servo_models,
    (select count(*) from public.installation_kits) as installation_kits,
    (select count(*) from public.repair_kits) as repair_kits,
    (select count(*) from public.loose_parts) as loose_parts,
    (select count(*) from public.commercial_configurations) as configurations,
    (select count(*) from public.commercial_configuration_codes) as commercial_codes,
    (select count(*) from public.servo_repair_compatibility) as compatibilities
),
preserved_state as (
  select
    (select count(*) from auth.users) as auth_users,
    (select count(*) from public.profiles) as profiles,
    (select count(*) from public.safisa_portal_members) as memberships,
    (select count(*) from storage.buckets where id = :'expected_bucket_id') as bucket_count,
    (select count(*) from public.commercial_configurations where image_path is not null) as referenced_images,
    (select count(*) from storage.objects where bucket_id = :'expected_bucket_id' and name in (select image_path from public.commercial_configurations where image_path is not null)) as referenced_objects,
    (select count(*) from storage.objects where bucket_id = :'expected_bucket_id') as storage_objects,
    (select count(*) from public.push_subscriptions) as push_subscriptions,
    (select count(*) from public.push_subscriptions where enabled) as enabled_push_subscriptions
),
balance_state as (
  select
    (select count(*) from public.stock_balances) as item_rows,
    (select coalesce(sum(quantity), 0) from public.stock_balances) as item_total,
    (select count(*) from public.configuration_stock_balances) as configuration_rows,
    (select coalesce(sum(quantity), 0) from public.configuration_stock_balances) as configuration_total
),
operational_counts as (
  select jsonb_object_agg(relation_name, row_count order by relation_name) as counts,
    sum(row_count) as total_rows
  from (
    select 'assembly_operations' as relation_name, count(*) as row_count from public.assembly_operations
    union all select 'configuration_minimum_stock_changes', count(*) from public.configuration_minimum_stock_changes
    union all select 'configuration_operation_requests', count(*) from private.configuration_operation_requests
    union all select 'configuration_stock_movements', count(*) from public.configuration_stock_movements
    union all select 'inbound_batch_lines', count(*) from public.inbound_batch_lines
    union all select 'minimum_stock_changes', count(*) from public.minimum_stock_changes
    union all select 'movement_batches', count(*) from public.movement_batches
    union all select 'outbound_batch_lines', count(*) from public.outbound_batch_lines
    union all select 'push_notification_events', count(*) from public.push_notification_events
    union all select 'safisa_order_authorizations', count(*) from public.safisa_order_authorizations
    union all select 'safisa_portal_events', count(*) from public.safisa_portal_events
    union all select 'stock_adjustment_requests', count(*) from private.stock_adjustment_requests
    union all select 'stock_movements', count(*) from public.stock_movements
    union all select 'supplier_order_events', count(*) from public.supplier_order_events
    union all select 'supplier_order_items', count(*) from public.supplier_order_items
    union all select 'supplier_order_stock_entries', count(*) from public.supplier_order_stock_entries
    union all select 'supplier_order_stock_entry_lines', count(*) from public.supplier_order_stock_entry_lines
    union all select 'supplier_orders', count(*) from public.supplier_orders
  ) as operational
),
movement_type_counts as (
  select coalesce(jsonb_object_agg(movement_type, row_count order by movement_type), '{}'::jsonb) as counts
  from (
    select movement_type, count(*) as row_count
    from public.movement_batches
    group by movement_type
  ) as movement_types
),
safisa_event_type_counts as (
  select coalesce(jsonb_object_agg(event_type, row_count order by event_type), '{}'::jsonb) as counts
  from (
    select event_type, count(*) as row_count
    from public.safisa_portal_events
    group by event_type
  ) as event_types
),
minimum_state as (
  select
    (select count(*) from public.items where minimum_stock <> 0) as items_nonzero,
    (select count(*) from public.commercial_configurations where minimum_stock <> 0) as configurations_nonzero
),
dynamic_items as (
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'code', code, 'description', description) order by code), '[]'::jsonb) as rows
  from public.items
  where id::text = any(string_to_array(:'expected_dynamic_item_ids', ','))
),
required_relations as (
  select bool_and(to_regclass(relation_name) is not null) as all_present
  from unnest(string_to_array(:'required_relations', ',')) as relation_name
),
guard_state as (
  select
    current_database() = :'expected_database_name' as database_matches,
    migration_state.migration_count = :'expected_migration_count'::integer
      and migration_state.latest_migration = :'expected_latest_migration'
      and migration_state.fingerprint = :'expected_migration_fingerprint' as migrations_match,
    schema_state.fingerprint = :'expected_schema_fingerprint' as schema_matches,
    catalog_state.fingerprint = :'expected_catalog_fingerprint' as catalog_matches,
    catalog_counts.items = :'expected_items'::integer
      and catalog_counts.servo_models = :'expected_servo_models'::integer
      and catalog_counts.installation_kits = :'expected_installation_kits'::integer
      and catalog_counts.repair_kits = :'expected_repair_kits'::integer
      and catalog_counts.loose_parts = :'expected_loose_parts'::integer
      and catalog_counts.configurations = :'expected_configurations'::integer
      and catalog_counts.commercial_codes = :'expected_commercial_codes'::integer
      and catalog_counts.compatibilities = :'expected_compatibilities'::integer as catalog_counts_match,
    preserved_state.auth_users = :'expected_auth_users'::integer
      and preserved_state.profiles = :'expected_profiles'::integer
      and preserved_state.memberships = :'expected_memberships'::integer as identities_match,
    preserved_state.bucket_count = 1
      and preserved_state.referenced_images = :'expected_referenced_images'::integer
      and preserved_state.referenced_objects = :'expected_referenced_images'::integer
      and preserved_state.storage_objects = :'expected_storage_objects'::integer as storage_matches,
    required_relations.all_present as required_relations_present
  from schema_state, catalog_state, migration_state, catalog_counts, preserved_state, required_relations
)
select jsonb_build_object(
  'reportType', 'RESET_OPERACIONAL_DRY_RUN',
  'project', jsonb_build_object('name', :'expected_project_name', 'ref', :'identified_project_ref', 'database', current_database()),
  'contract', jsonb_build_object('sourceMainSha', :'expected_source_main_sha', 'procedureVersion', :'procedure_version'::integer),
  'guards', to_jsonb(guard_state) || jsonb_build_object('allPassed', guard_state.database_matches and guard_state.migrations_match and guard_state.schema_matches and guard_state.catalog_matches and guard_state.catalog_counts_match and guard_state.identities_match and guard_state.storage_matches and guard_state.required_relations_present),
  'fingerprints', jsonb_build_object('migrations', migration_state.fingerprint, 'schema', schema_state.fingerprint, 'catalog', catalog_state.fingerprint),
  'preserve', jsonb_build_object('catalog', to_jsonb(catalog_counts), 'authUsers', preserved_state.auth_users, 'profiles', preserved_state.profiles, 'safisaMemberships', preserved_state.memberships, 'referencedImages', preserved_state.referenced_images, 'storageObjects', preserved_state.storage_objects, 'dynamicItems', dynamic_items.rows),
  'reset', jsonb_build_object('tables', operational_counts.counts, 'operationalRows', operational_counts.total_rows, 'balances', to_jsonb(balance_state), 'movementTypes', movement_type_counts.counts, 'safisaEventTypes', safisa_event_type_counts.counts),
  'reinitialize', jsonb_build_object('itemsWithMinimum', minimum_state.items_nonzero, 'configurationsWithMinimum', minimum_state.configurations_nonzero),
  'pushSubscriptions', jsonb_build_object('decision', :'push_subscription_action', 'total', preserved_state.push_subscriptions, 'enabled', preserved_state.enabled_push_subscriptions),
  'mutationsExecuted', false
)::text
from schema_state, catalog_state, migration_state, catalog_counts, preserved_state, balance_state, operational_counts, movement_type_counts, safisa_event_type_counts, minimum_state, dynamic_items, guard_state;
