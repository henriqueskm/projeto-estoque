begin;

do $$
declare
  v_test_item_id constant uuid :=
    'efce5819-0fe5-4766-8856-29924fdc3fcd'::uuid;
  v_expected_created_by constant uuid :=
    'cc7fafb6-7dd1-465a-b6e5-dfbb00b8aab9'::uuid;
  v_test_item public.items%rowtype;
  v_reference record;
  v_reference_count bigint;
  v_expected_reference_constraints integer := 0;
  v_deleted_count bigint;
begin
  select item.*
  into v_test_item
  from public.items as item
  where item.id = v_test_item_id
  for update;

  if not found then
    return;
  end if;

  if v_test_item.code is distinct from '7 INV'
    or v_test_item.description is distinct from
      'SERVO BR-040 INVER SEM KIT'
    or v_test_item.item_type is distinct from 'LOOSE_PART'
    or v_test_item.minimum_stock is distinct from 0
    or v_test_item.is_active is distinct from true then
    raise exception using
      errcode = '23514',
      message = format(
        'Refusing to prepare catalog test item %s because its exact commercial identity changed.',
        v_test_item_id
      );
  end if;

  if v_test_item.created_by is null
    and v_test_item.created_by_name_snapshot is null then
    return;
  end if;

  if v_test_item.created_by is distinct from v_expected_created_by
    or v_test_item.created_by_name_snapshot is distinct from
      'Henrique Klein' then
    raise exception using
      errcode = '23514',
      message = format(
        'Refusing to remove catalog test item %s because its exact audit signature changed.',
        v_test_item_id
      );
  end if;

  select count(*)
  into v_reference_count
  from public.loose_parts as loose_part
  where loose_part.item_id = v_test_item_id;

  if v_reference_count <> 1 then
    raise exception using
      errcode = '23514',
      message = format(
        'Refusing to remove catalog test item %s because its loose-part subtype is missing or duplicated.',
        v_test_item_id
      );
  end if;

  for v_reference in
    select
      constraint_record.oid as constraint_oid,
      constraint_record.conname as constraint_name,
      referencing_namespace.nspname as schema_name,
      referencing_table.relname as table_name,
      referencing_column.attname as column_name
    from pg_catalog.pg_constraint as constraint_record
    join lateral unnest(constraint_record.conkey) with ordinality
      as referencing_key(attnum, ordinal_position)
      on true
    join lateral unnest(constraint_record.confkey) with ordinality
      as referenced_key(attnum, ordinal_position)
      on referenced_key.ordinal_position = referencing_key.ordinal_position
    join pg_catalog.pg_class as referencing_table
      on referencing_table.oid = constraint_record.conrelid
    join pg_catalog.pg_namespace as referencing_namespace
      on referencing_namespace.oid = referencing_table.relnamespace
    join pg_catalog.pg_attribute as referencing_column
      on referencing_column.attrelid = constraint_record.conrelid
     and referencing_column.attnum = referencing_key.attnum
    join pg_catalog.pg_attribute as referenced_column
      on referenced_column.attrelid = constraint_record.confrelid
     and referenced_column.attnum = referenced_key.attnum
    where constraint_record.contype = 'f'
      and constraint_record.confrelid = 'public.items'::regclass
      and referenced_column.attname = 'id'
    order by
      referencing_namespace.nspname,
      referencing_table.relname,
      referencing_column.attname,
      constraint_record.oid
  loop
    execute format(
      'select count(*) from %I.%I where %I = $1',
      v_reference.schema_name,
      v_reference.table_name,
      v_reference.column_name
    )
    into v_reference_count
    using v_test_item_id;

    if v_reference.schema_name = 'public'
      and v_reference.table_name = 'loose_parts'
      and v_reference.column_name = 'item_id' then
      v_expected_reference_constraints :=
        v_expected_reference_constraints + 1;

      if v_reference_count <> 1 then
        raise exception using
          errcode = '23514',
          message = format(
            'Refusing to remove catalog test item %s because public.loose_parts.item_id contains %s matching rows.',
            v_test_item_id,
            v_reference_count
          );
      end if;
    elsif v_reference_count > 0 then
      raise exception using
        errcode = '23503',
        message = format(
          'Refusing to remove catalog test item %s because foreign key %I on %I.%I.%I contains %s reference(s).',
          v_test_item_id,
          v_reference.constraint_name,
          v_reference.schema_name,
          v_reference.table_name,
          v_reference.column_name,
          v_reference_count
        );
    end if;
  end loop;

  if v_expected_reference_constraints <> 1 then
    raise exception using
      errcode = '23514',
      message = format(
        'Refusing to remove catalog test item %s because the expected public.loose_parts.item_id foreign key was found %s times.',
        v_test_item_id,
        v_expected_reference_constraints
      );
  end if;

  delete from public.loose_parts as loose_part
  where loose_part.item_id = v_test_item_id;

  get diagnostics v_deleted_count = row_count;
  if v_deleted_count <> 1 then
    raise exception using
      errcode = '23514',
      message = format(
        'Catalog test item %s loose-part subtype was not removed exactly once.',
        v_test_item_id
      );
  end if;

  delete from public.items as item
  where item.id = v_test_item_id
    and item.code = '7 INV'
    and item.description = 'SERVO BR-040 INVER SEM KIT'
    and item.item_type = 'LOOSE_PART'
    and item.minimum_stock = 0
    and item.is_active = true
    and item.created_by = v_expected_created_by
    and item.created_by_name_snapshot = 'Henrique Klein';

  get diagnostics v_deleted_count = row_count;
  if v_deleted_count <> 1 then
    raise exception using
      errcode = '23514',
      message = format(
        'Catalog test item %s was not removed exactly once.',
        v_test_item_id
      );
  end if;
end;
$$;

commit;
