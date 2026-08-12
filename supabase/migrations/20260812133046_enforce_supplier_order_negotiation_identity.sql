-- MIG-ORD-008A: preserve approved legacy orders while making the
-- supplier-order negotiation a globally unique, digits-only text identity.

begin;

do $$
declare
  v_mapping constant jsonb := jsonb_build_array(
    jsonb_build_object(
      'supplier_order_id', '26e08e22-a2fb-4e8d-8605-4ccdb57d4773',
      'previous_negotiation_number', 'teste 00',
      'new_negotiation_number', '99990000',
      'idempotency_key', '8b68f761-dc00-4f46-a459-008a00000001'
    ),
    jsonb_build_object(
      'supplier_order_id', 'db02621b-b6c1-4e7a-8fef-b63fc3e60d50',
      'previous_negotiation_number', 'teste 01',
      'new_negotiation_number', '99990001',
      'idempotency_key', '8b68f761-dc00-4f46-a459-008a00000002'
    ),
    jsonb_build_object(
      'supplier_order_id', 'e92bc06f-5721-4082-b77a-def6954e3300',
      'previous_negotiation_number', 'teste 03',
      'new_negotiation_number', '99990003',
      'idempotency_key', '8b68f761-dc00-4f46-a459-008a00000003'
    ),
    jsonb_build_object(
      'supplier_order_id', 'af7a39f6-c4a2-4e92-b183-d8196aa775d1',
      'previous_negotiation_number', 'Teste 04',
      'new_negotiation_number', '99990004',
      'idempotency_key', '8b68f761-dc00-4f46-a459-008a00000004'
    )
  );
  v_entry jsonb;
  v_supplier_order_id uuid;
  v_previous_negotiation_number text;
  v_new_negotiation_number text;
  v_idempotency_key uuid;
  v_legacy_order_count integer;
begin
  lock table public.supplier_orders in share row exclusive mode;

  select count(*)
  into v_legacy_order_count
  from public.supplier_orders
  where id in (
    '26e08e22-a2fb-4e8d-8605-4ccdb57d4773'::uuid,
    'db02621b-b6c1-4e7a-8fef-b63fc3e60d50'::uuid,
    'e92bc06f-5721-4082-b77a-def6954e3300'::uuid,
    'af7a39f6-c4a2-4e92-b183-d8196aa775d1'::uuid
  );

  if v_legacy_order_count not in (0, 4) then
    raise exception using
      errcode = 'P0001',
      message = 'MIG-ORD-008A legacy supplier-order set does not match the approved mapping.';
  end if;

  if v_legacy_order_count = 4 then
    for v_entry in
      select value
      from jsonb_array_elements(v_mapping)
    loop
      v_supplier_order_id := (v_entry ->> 'supplier_order_id')::uuid;
      v_previous_negotiation_number :=
        v_entry ->> 'previous_negotiation_number';
      v_new_negotiation_number := v_entry ->> 'new_negotiation_number';
      v_idempotency_key := (v_entry ->> 'idempotency_key')::uuid;

      if (
        select count(*)
        from public.supplier_orders
        where id = v_supplier_order_id
          and negotiation_number = v_previous_negotiation_number
      ) <> 1 then
        raise exception using
          errcode = 'P0001',
          message = format(
            'MIG-ORD-008A legacy supplier order %s does not have the approved identity.',
            v_supplier_order_id
          );
      end if;

      if exists (
        select 1
        from public.supplier_orders
        where negotiation_number = v_new_negotiation_number
          and id <> v_supplier_order_id
      ) then
        raise exception using
          errcode = 'P0001',
          message = format(
            'MIG-ORD-008A target negotiation %s is already in use.',
            v_new_negotiation_number
          );
      end if;

      update public.supplier_orders
      set negotiation_number = v_new_negotiation_number
      where id = v_supplier_order_id
        and negotiation_number = v_previous_negotiation_number;

      if not found then
        raise exception using
          errcode = 'P0001',
          message = format(
            'MIG-ORD-008A failed to update legacy supplier order %s.',
            v_supplier_order_id
          );
      end if;

      insert into public.supplier_order_events (
        supplier_order_id,
        event_type,
        user_id,
        user_name_snapshot,
        idempotency_key,
        description,
        details
      )
      values (
        v_supplier_order_id,
        'ORDER_HEADER_UPDATED',
        null,
        'MIG-ORD-008A',
        v_idempotency_key,
        'Legacy negotiation converted to numeric identity by MIG-ORD-008A.',
        jsonb_build_object(
          'reason', 'legacy_negotiation_identity_migration',
          'previous_negotiation_number', v_previous_negotiation_number,
          'new_negotiation_number', v_new_negotiation_number
        )
      );
    end loop;
  end if;

  if exists (
    select 1
    from public.supplier_orders
    where negotiation_number !~ '^[0-9]+$'
      or char_length(negotiation_number) not between 1 and 120
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'MIG-ORD-008A found another incompatible supplier-order negotiation.';
  end if;

  if exists (
    select 1
    from public.supplier_orders
    group by negotiation_number
    having count(*) > 1
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'MIG-ORD-008A found duplicate supplier-order negotiations.';
  end if;
end;
$$;

alter table public.supplier_orders
  drop constraint supplier_orders_negotiation_number_check;

alter table public.supplier_orders
  add constraint supplier_orders_negotiation_number_check check (
    char_length(negotiation_number) between 1 and 120
    and negotiation_number ~ '^[0-9]+$'
  );

alter table public.supplier_orders
  add constraint supplier_orders_negotiation_number_key
  unique (negotiation_number);

drop index public.supplier_orders_negotiation_number_idx;

create or replace function public.create_supplier_order(
  p_negotiation_number text,
  p_order_date date,
  p_notes text,
  p_lines jsonb,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user record;
  v_constraint_name text;
begin
  if p_negotiation_number is null
    or btrim(p_negotiation_number) !~ '^[0-9]+$'
    or char_length(btrim(p_negotiation_number)) not between 1 and 120 then
    raise exception using
      errcode = '22023',
      message = 'p_negotiation_number must contain only digits 0-9 and between 1 and 120 characters.';
  end if;

  select *
  into v_user
  from private.require_supplier_order_user();

  begin
    return private.create_supplier_order(
      p_negotiation_number,
      p_order_date,
      p_notes,
      p_lines,
      p_idempotency_key,
      v_user.user_id,
      v_user.user_name
    );
  exception
    when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;

      if v_constraint_name = 'supplier_orders_negotiation_number_key' then
        raise exception using
          errcode = '23505',
          message = 'supplier order negotiation already exists.';
      end if;

      raise;
  end;
end;
$$;

create or replace function public.update_supplier_order(
  p_supplier_order_id uuid,
  p_expected_updated_at timestamptz,
  p_negotiation_number text,
  p_order_date date,
  p_notes text,
  p_lines jsonb,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user record;
  v_constraint_name text;
begin
  if p_negotiation_number is null
    or btrim(p_negotiation_number) !~ '^[0-9]+$'
    or char_length(btrim(p_negotiation_number)) not between 1 and 120 then
    raise exception using
      errcode = '22023',
      message = 'p_negotiation_number must contain only digits 0-9 and between 1 and 120 characters.';
  end if;

  select *
  into v_user
  from private.require_supplier_order_user();

  begin
    return private.update_supplier_order(
      p_supplier_order_id,
      p_expected_updated_at,
      p_negotiation_number,
      p_order_date,
      p_notes,
      p_lines,
      p_idempotency_key,
      v_user.user_id,
      v_user.user_name
    );
  exception
    when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;

      if v_constraint_name = 'supplier_orders_negotiation_number_key' then
        raise exception using
          errcode = '23505',
          message = 'supplier order negotiation already exists.';
      end if;

      raise;
  end;
end;
$$;

revoke all on function public.create_supplier_order(
  text,
  date,
  text,
  jsonb,
  uuid
) from public, anon;

grant execute on function public.create_supplier_order(
  text,
  date,
  text,
  jsonb,
  uuid
) to authenticated, service_role;

revoke all on function public.update_supplier_order(
  uuid,
  timestamptz,
  text,
  date,
  text,
  jsonb,
  uuid
) from public, anon;

grant execute on function public.update_supplier_order(
  uuid,
  timestamptz,
  text,
  date,
  text,
  jsonb,
  uuid
) to authenticated, service_role;

comment on constraint supplier_orders_negotiation_number_check
  on public.supplier_orders is
  'Supplier-order negotiation is a 1-120 character ASCII digits-only text identity; leading zeroes are significant.';

comment on constraint supplier_orders_negotiation_number_key
  on public.supplier_orders is
  'Supplier-order negotiation is globally unique across every lifecycle state, including finalized and cancelled orders.';

commit;
