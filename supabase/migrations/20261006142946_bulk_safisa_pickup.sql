-- Bulk composition only: stock rules remain in the canonical per-order workers.
begin;

create table public.supplier_order_bulk_pickup_operations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  user_name_snapshot text not null check (btrim(user_name_snapshot) <> ''),
  idempotency_key uuid not null,
  request jsonb not null check (jsonb_typeof(request) = 'array'),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);
alter table public.supplier_order_bulk_pickup_operations enable row level security;
revoke all on public.supplier_order_bulk_pickup_operations from public, anon, authenticated, service_role;

-- Version plus a server-derived fingerprint protects the exact displayed delta,
-- even if a legacy transaction happens to reuse an updated_at timestamp.
create function private.safisa_bulk_pickup_line_fingerprint(p_supplier_order_id uuid)
returns text language sql stable security invoker set search_path = '' as $$
  select md5(coalesce(jsonb_agg(to_jsonb(i) - 'created_at' - 'updated_at' order by i.id)
    filter (where i.ready_quantity > i.picked_quantity), '[]'::jsonb)::text)
  from public.supplier_order_items i where i.supplier_order_id = p_supplier_order_id;
$$;
revoke all on function private.safisa_bulk_pickup_line_fingerprint(uuid) from public, anon, authenticated, service_role;

-- One statement supplies both quantities and their parent versions. No truncation.
create function public.preview_safisa_bulk_pickup()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_result jsonb;
begin
  perform private.require_supplier_order_user();
  with eligible as (
    select o.id, o.negotiation_number, o.order_date, o.updated_at,
      i.id as line_id, i.code_snapshot, i.description_snapshot,
      i.ready_quantity, i.picked_quantity
    from public.supplier_orders o
    join public.supplier_order_items i on i.supplier_order_id = o.id
    where o.cancelled_at is null and o.finalized_at is null
      and i.ready_quantity > i.picked_quantity
  ), totals as (
    select count(distinct id) as orders, count(*) as lines,
      coalesce(sum(ready_quantity::bigint - picked_quantity), 0) as quantity
    from eligible
  ), grouped as (
    select id, negotiation_number, order_date, updated_at,
      jsonb_agg(jsonb_build_object(
        'supplier_order_item_id', line_id, 'code', code_snapshot,
        'description_snapshot', description_snapshot,
        'ready_quantity', ready_quantity, 'picked_quantity', picked_quantity,
        'quantity_to_pickup', ready_quantity - picked_quantity
      ) order by line_id) as lines
    from eligible
    where (select orders <= 100 and lines <= 500 from totals)
    group by id, negotiation_number, order_date, updated_at
  )
  select jsonb_build_object('order_count', t.orders, 'line_count', t.lines,
    'total_quantity', t.quantity, 'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'supplier_order_id', g.id, 'negotiation_number', g.negotiation_number,
        'order_date', g.order_date, 'expected_updated_at', g.updated_at,
        'expected_line_fingerprint', private.safisa_bulk_pickup_line_fingerprint(g.id),
        'lines', g.lines
      ) order by g.order_date, g.negotiation_number, g.id) from grouped g
    ), '[]'::jsonb)) into v_result from totals t;
  if (v_result ->> 'order_count')::integer > 100
    or (v_result ->> 'line_count')::integer > 500 then
    raise exception using errcode = '54000', message = 'bulk_pickup_limit_exceeded';
  end if;
  return v_result;
end;
$$;

create function private.bulk_mark_supplier_orders_all_picked_checked(
  p_orders jsonb, p_idempotency_key uuid, p_user_id uuid, p_user_name text
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_request jsonb;
  v_existing public.supplier_order_bulk_pickup_operations%rowtype;
  v_order record;
  v_target record;
  v_child jsonb;
  v_orders jsonb := '[]'::jsonb;
  v_id uuid := gen_random_uuid();
  v_lines integer := 0;
  v_picked bigint := 0;
  v_stock bigint := 0;
  v_result jsonb;
begin
  if p_user_id is null or nullif(btrim(p_user_name), '') is null
    or p_idempotency_key is null or p_orders is null
    or jsonb_typeof(p_orders) <> 'array' then
    raise exception using errcode = '22023', message = 'Invalid bulk pickup request.';
  end if;
  if jsonb_array_length(p_orders) not between 1 and 100 then
    raise exception using errcode = '54000', message = 'bulk_pickup_limit_exceeded';
  end if;
  if exists (select 1 from jsonb_array_elements(p_orders) e where
    jsonb_typeof(e) <> 'object' or e - 'supplier_order_id' - 'expected_updated_at' - 'expected_line_fingerprint' <> '{}'::jsonb
    or jsonb_typeof(e -> 'supplier_order_id') is distinct from 'string'
    or jsonb_typeof(e -> 'expected_updated_at') is distinct from 'string'
    or coalesce(e ->> 'expected_line_fingerprint', '') !~ '^[a-f0-9]{32}$') then
    raise exception using errcode = '22023', message = 'Invalid bulk pickup order/version.';
  end if;
  -- Cast before locking/writing, normalize timestamps and UUIDs, sort, reject duplicates.
  select jsonb_agg(jsonb_build_object('supplier_order_id', r.supplier_order_id,
    'expected_updated_at', r.expected_updated_at, 'expected_line_fingerprint', r.expected_line_fingerprint) order by r.supplier_order_id)
  into v_request from jsonb_to_recordset(p_orders) r(supplier_order_id uuid, expected_updated_at timestamptz, expected_line_fingerprint text);
  if exists (select 1 from jsonb_to_recordset(v_request) r(supplier_order_id uuid, expected_updated_at timestamptz)
    where r.supplier_order_id is null or r.expected_updated_at is null or not isfinite(r.expected_updated_at))
    or (select count(distinct r.supplier_order_id) from jsonb_to_recordset(v_request) r(supplier_order_id uuid)) <> jsonb_array_length(v_request) then
    raise exception using errcode = '22023', message = 'Invalid or duplicate bulk pickup order.';
  end if;
  -- Same lock namespace as the supplier-order idempotency ledger.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text || ':' || p_idempotency_key::text, 0));
  if exists (select 1 from public.supplier_order_events where user_id = p_user_id and idempotency_key = p_idempotency_key)
    or exists (select 1 from public.movement_batches where user_id = p_user_id and idempotency_key = p_idempotency_key) then
    raise exception using errcode = '22023', message = 'Idempotency key belongs to another operation.';
  end if;
  select * into v_existing from public.supplier_order_bulk_pickup_operations
    where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request is distinct from v_request then
      raise exception using errcode = '22023', message = 'Idempotency key payload mismatch.';
    end if;
    return v_existing.result || jsonb_build_object('idempotent_replay', true);
  end if;

  -- All parents before any child/stock lock. Individual writers take parent first too.
  perform 1 from public.supplier_orders o
    join jsonb_to_recordset(v_request) r(supplier_order_id uuid) on r.supplier_order_id = o.id
    order by o.id for update of o;
  perform 1 from public.supplier_order_items i
    join jsonb_to_recordset(v_request) r(supplier_order_id uuid) on r.supplier_order_id = i.supplier_order_id
    order by i.supplier_order_id, i.id for update of i;
  for v_order in select r.*, o.updated_at, o.cancelled_at, o.finalized_at,
    (select count(*) from public.supplier_order_items i where i.supplier_order_id = o.id and i.ready_quantity > i.picked_quantity) as ready_lines
    from jsonb_to_recordset(v_request) r(supplier_order_id uuid, expected_updated_at timestamptz, expected_line_fingerprint text)
    left join public.supplier_orders o on o.id = r.supplier_order_id order by r.supplier_order_id
  loop
    if v_order.updated_at is distinct from v_order.expected_updated_at
      or private.safisa_bulk_pickup_line_fingerprint(v_order.supplier_order_id) is distinct from v_order.expected_line_fingerprint
      or v_order.cancelled_at is not null or v_order.finalized_at is not null or v_order.ready_lines = 0 then
      raise exception using errcode = '40001', message = 'supplier_order_version_conflict';
    end if;
    v_lines := v_lines + v_order.ready_lines;
  end loop;
  if v_lines > 500 then
    raise exception using errcode = '54000', message = 'bulk_pickup_limit_exceeded';
  end if;

  -- Canonical inbound lock hierarchy: codes -> configurations -> items (shared),
  -- then configuration balances -> direct item balances (exclusive), each by UUID.
  -- Lock all candidate aliases too: the canonical worker may resolve a missing alias.
  perform 1 from public.commercial_configuration_codes c where c.configuration_id in (
    select i.commercial_configuration_id from public.supplier_order_items i
    join jsonb_to_recordset(v_request) r(supplier_order_id uuid) on r.supplier_order_id = i.supplier_order_id
    where i.ready_quantity > i.picked_quantity
  ) order by c.id for share;
  perform 1 from public.commercial_configurations c where c.id in (
    select i.commercial_configuration_id from public.supplier_order_items i
    join jsonb_to_recordset(v_request) r(supplier_order_id uuid) on r.supplier_order_id = i.supplier_order_id
    where i.ready_quantity > i.picked_quantity
  ) order by c.id for share;
  perform 1 from public.items t where t.id in (
    select i.item_id from public.supplier_order_items i
    join jsonb_to_recordset(v_request) r(supplier_order_id uuid) on r.supplier_order_id = i.supplier_order_id
    where i.ready_quantity > i.picked_quantity
    union
    select c.servo_id from public.commercial_configurations c join public.supplier_order_items i on i.commercial_configuration_id = c.id
    join jsonb_to_recordset(v_request) r(supplier_order_id uuid) on r.supplier_order_id = i.supplier_order_id where i.ready_quantity > i.picked_quantity
    union
    select c.installation_kit_id from public.commercial_configurations c join public.supplier_order_items i on i.commercial_configuration_id = c.id
    join jsonb_to_recordset(v_request) r(supplier_order_id uuid) on r.supplier_order_id = i.supplier_order_id where i.ready_quantity > i.picked_quantity
  ) order by t.id for share;

  -- Provision absent rows exactly as canonical inbound does, not as stock entries.
  -- These zeros and all locks/writes roll back if any child fails.
  for v_target in select distinct i.commercial_configuration_id as id from public.supplier_order_items i
    join jsonb_to_recordset(v_request) r(supplier_order_id uuid) on r.supplier_order_id = i.supplier_order_id
    where i.ready_quantity > i.picked_quantity and i.commercial_configuration_id is not null order by id
  loop
    insert into public.configuration_stock_balances(configuration_id, quantity) values(v_target.id, 0) on conflict do nothing;
    perform 1 from public.configuration_stock_balances where configuration_id = v_target.id for update;
  end loop;
  for v_target in select distinct i.item_id as id from public.supplier_order_items i
    join jsonb_to_recordset(v_request) r(supplier_order_id uuid) on r.supplier_order_id = i.supplier_order_id
    where i.ready_quantity > i.picked_quantity and i.item_id is not null order by id
  loop
    insert into public.stock_balances(item_id, quantity) values(v_target.id, 0) on conflict do nothing;
    perform 1 from public.stock_balances where item_id = v_target.id for update;
  end loop;

  for v_order in select r.*, o.negotiation_number from jsonb_to_recordset(v_request) r(supplier_order_id uuid, expected_updated_at timestamptz)
    join public.supplier_orders o on o.id = r.supplier_order_id order by r.supplier_order_id
  loop
    v_child := private.mark_supplier_order_all_picked_checked(
      v_order.supplier_order_id, null, v_order.expected_updated_at, gen_random_uuid(), p_user_id, p_user_name
    );
    if (v_child ->> 'added_picked_quantity')::bigint is distinct from (v_child ->> 'stock_entry_quantity')::bigint
      or (v_child ->> 'stock_entry_quantity')::bigint <= 0 then
      raise exception using errcode = '23514', message = 'Bulk pickup/stock entry invariant failed.';
    end if;
    v_picked := v_picked + (v_child ->> 'added_picked_quantity')::bigint;
    v_stock := v_stock + (v_child ->> 'stock_entry_quantity')::bigint;
    v_orders := v_orders || jsonb_build_array(jsonb_build_object(
      'supplier_order_id', v_order.supplier_order_id, 'negotiation_number', v_order.negotiation_number,
      'changed_line_count', v_child -> 'changed_line_count', 'added_picked_quantity', v_child -> 'added_picked_quantity',
      'stock_entry_quantity', v_child -> 'stock_entry_quantity', 'supplier_order_stock_entry_id', v_child -> 'supplier_order_stock_entry_id',
      'movement_batch_id', v_child -> 'movement_batch_id'
    ));
  end loop;
  v_result := jsonb_build_object('bulk_pickup_id', v_id, 'order_count', jsonb_array_length(v_request),
    'changed_line_count', v_lines, 'total_picked_quantity', v_picked, 'total_stock_entry_quantity', v_stock,
    'orders', v_orders, 'idempotent_replay', false);
  insert into public.supplier_order_bulk_pickup_operations(id, user_id, user_name_snapshot, idempotency_key, request, result)
    values(v_id, p_user_id, p_user_name, p_idempotency_key, v_request, v_result);
  return v_result;
end;
$$;

create function public.bulk_mark_supplier_orders_all_picked_checked(p_orders jsonb, p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user record;
begin
  select * into v_user from private.require_supplier_order_user();
  return private.bulk_mark_supplier_orders_all_picked_checked(p_orders, p_idempotency_key, v_user.user_id, v_user.user_name);
end;
$$;
revoke all on function private.bulk_mark_supplier_orders_all_picked_checked(jsonb, uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.preview_safisa_bulk_pickup() from public, anon;
revoke all on function public.bulk_mark_supplier_orders_all_picked_checked(jsonb, uuid) from public, anon;
grant execute on function public.preview_safisa_bulk_pickup() to authenticated, service_role;
grant execute on function public.bulk_mark_supplier_orders_all_picked_checked(jsonb, uuid) to authenticated, service_role;
commit;
