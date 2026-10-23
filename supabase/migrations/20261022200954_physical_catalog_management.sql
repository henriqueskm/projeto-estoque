begin;

-- Explicit least privilege, including TRUNCATE (which is not governed by RLS).
-- All existing catalog/stock writers are privileged, authenticated RPCs.
revoke all on public.items, public.servo_models, public.installation_kits,
  public.repair_kits, public.loose_parts, public.stock_balances from public, anon, authenticated;
grant select on public.items, public.servo_models, public.installation_kits,
  public.repair_kits, public.loose_parts, public.stock_balances to authenticated;

-- Catalog identity/audit is structural, not a stock operation or a sales ledger.
-- Results retain the canonical adjustment receipt without introducing a reset
-- dependency from preserved catalog history to operational movement batches.
create table private.physical_catalog_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  user_name_snapshot text not null check (btrim(user_name_snapshot) <> ''),
  idempotency_key uuid not null,
  request jsonb not null check (jsonb_typeof(request) = 'object'),
  item_id uuid not null references public.items(id) on delete restrict,
  before_snapshot jsonb,
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now()
);
create unique index physical_catalog_requests_user_key on private.physical_catalog_requests(user_id, idempotency_key) where user_id is not null;
create index physical_catalog_requests_item on private.physical_catalog_requests(item_id, created_at);
alter table private.physical_catalog_requests enable row level security;
revoke all on private.physical_catalog_requests from public, anon, authenticated, service_role;
-- Reuse the immutable receipt guard (permits only profile FK anonymization).
create trigger physical_catalog_requests_immutable before update or delete on private.physical_catalog_requests
  for each row execute function private.guard_bundle_stock_flow_receipt();

create function private.physical_catalog_snapshot(p_item_id uuid)
returns jsonb language sql volatile security invoker set search_path = '' as $$
  select jsonb_build_object(
    'id', i.id, 'code', i.code, 'description', i.description,
    'itemType', i.item_type, 'isActive', i.is_active,
    'model', (select model from public.servo_models where item_id = i.id),
    'quantity', coalesce(b.quantity, 0),
    'version', md5(jsonb_build_array(to_jsonb(i), b.quantity, b.updated_at)::text),
    'dependencies', jsonb_build_object(
      'configurations', (select count(*) from public.commercial_configurations c where c.servo_id = i.id or c.installation_kit_id = i.id),
      'recipes', (select count(*) from public.commercial_bundle_components c where c.item_id = i.id),
      'compatibilities', (select count(*) from public.servo_repair_compatibility c where c.servo_id = i.id or c.repair_kit_id = i.id),
      'applications', (select count(*) from public.vehicle_applications a
        left join public.commercial_configuration_codes cc on cc.id = a.commercial_configuration_code_id
        left join public.commercial_configurations c on c.id = cc.configuration_id
        where c.servo_id = i.id or c.installation_kit_id = i.id
          or (i.item_type = 'INSTALLATION_KIT' and a.source_kit_code = i.code)),
      'pendingOrders', (select count(distinct o.id) from public.supplier_order_items l join public.supplier_orders o on o.id = l.supplier_order_id
        where l.item_id = i.id and (
          (o.cancelled_at is null and o.finalized_at is null)
          or l.picked_quantity > l.stocked_quantity or l.ready_quantity > l.picked_quantity))
    )
  ) from public.items i left join public.stock_balances b on b.item_id = i.id where i.id = p_item_id;
$$;
revoke all on function private.physical_catalog_snapshot(uuid) from public, anon, authenticated, service_role;

create function public.get_physical_catalog_item_preview(p_item_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor record; v_snapshot jsonb;
begin
  select * into strict v_actor from private.require_supplier_order_user();
  v_snapshot := private.physical_catalog_snapshot(p_item_id);
  if v_snapshot is null then raise exception using errcode = '22023', message = 'catalog_item_not_found'; end if;
  return v_snapshot;
end;
$$;
revoke all on function public.get_physical_catalog_item_preview(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_physical_catalog_item_preview(uuid) to authenticated;

-- Last-line invariant, including legacy single-item/absolute adjustment APIs.
-- Canonical writers already lock item metadata FOR SHARE before balance writes.
-- Do NOT acquire metadata locks here (balance -> metadata would invert their
-- hierarchy). The archive always materializes/locks the balance before retiring
-- metadata, so a writer waiting for that balance sees the committed inactive row
-- in this VOLATILE trigger. No positive balance can survive an archive race.
create function private.guard_retired_item_balance()
returns trigger language plpgsql volatile security definer set search_path = '' as $$
begin
  if new.quantity > 0 and not exists (select 1 from public.items where id = new.item_id and is_active) then
    raise exception using errcode = '23514', message = 'catalog_item_inactive';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_retired_item_balance() from public, anon, authenticated, service_role;
create trigger stock_balance_active_catalog_guard before insert or update on public.stock_balances
  for each row execute function private.guard_retired_item_balance();

create function private.manage_physical_catalog(p_request jsonb, p_idempotency_key uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_actor record;
  v_operation text := p_request->>'operation';
  v_type text := p_request->>'itemType';
  v_id uuid;
  v_code text := btrim(p_request->>'code');
  v_description text := btrim(p_request->>'description');
  v_reason text := btrim(p_request->>'reason');
  v_model text := btrim(p_request->>'model');
  v_request jsonb;
  v_existing private.physical_catalog_requests%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_adjustment jsonb;
  v_result jsonb;
  v_lock text;
  v_quantity integer;
  v_balance_exists boolean;
  v_inserted uuid;
  v_compatibilities uuid[];
begin
  select * into strict v_actor from private.require_supplier_order_user();
  if p_idempotency_key is null or jsonb_typeof(p_request) is distinct from 'object'
    or v_operation is null or v_operation not in ('CREATE', 'EDIT', 'ARCHIVE')
    or exists (select 1 from jsonb_object_keys(p_request) k where k not in (
      'operation','itemId','itemType','code','description','model','compatibleServoIds','reason','expectedVersion','expectedQuantity')) then
    raise exception using errcode = '22023', message = 'catalog_invalid_request';
  end if;
  if v_reason is null or char_length(v_reason) not between 1 and 500 then
    raise exception using errcode = '22023', message = 'catalog_reason_required';
  end if;
  if v_operation <> 'ARCHIVE' then
    if v_description is null or char_length(v_description) not between 1 and 500 then
      raise exception using errcode = '22023', message = 'catalog_invalid_description';
    end if;
    perform 1 from private.catalog_code_write_policy(v_code);
  end if;
  -- Strict payload: no hidden subtype/compatibility edits, stock or category change.
  if v_operation <> 'CREATE' and (p_request ? 'itemType' or p_request ? 'model' or p_request ? 'compatibleServoIds') then
    raise exception using errcode = '22023', message = 'catalog_identity_is_immutable';
  end if;
  if v_operation = 'CREATE' and (p_request ? 'itemId' or p_request ? 'expectedVersion' or p_request ? 'expectedQuantity') then
    raise exception using errcode = '22023', message = 'catalog_invalid_request';
  end if;
  if v_operation = 'ARCHIVE' and (p_request ? 'code' or p_request ? 'description') then
    raise exception using errcode = '22023', message = 'catalog_invalid_request';
  end if;
  v_request := p_request || jsonb_build_object('reason', v_reason);
  if v_operation <> 'ARCHIVE' then v_request := v_request || jsonb_build_object('code', v_code, 'description', v_description); end if;
  -- The request is reserved before any item/balance locks; retries serialize.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('physical-catalog:' || v_actor.user_id::text || ':' || p_idempotency_key::text, 0));
  select * into v_existing from private.physical_catalog_requests where user_id = v_actor.user_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request is distinct from v_request then
      raise exception using errcode = '22023', message = 'catalog_idempotency_conflict';
    end if;
    return v_existing.result || jsonb_build_object('idempotentReplay', true);
  end if;

  if v_operation = 'CREATE' then
    if v_type is null or v_type not in ('SERVO','INSTALLATION_KIT','REPAIR_KIT','LOOSE_PART') then
      raise exception using errcode = '22023', message = 'catalog_invalid_category';
    end if;
    if v_type = 'SERVO' and (v_model is null or char_length(v_model) not between 1 and 120) then
      raise exception using errcode = '22023', message = 'catalog_servo_model_required';
    end if;
    if v_type <> 'SERVO' and p_request ? 'model' then
      raise exception using errcode = '22023', message = 'catalog_invalid_request';
    end if;
    if jsonb_typeof(coalesce(p_request->'compatibleServoIds', '[]')) <> 'array'
      or jsonb_array_length(coalesce(p_request->'compatibleServoIds', '[]')) > 200 then
      raise exception using errcode = '22023', message = 'catalog_invalid_compatibilities';
    end if;
    select coalesce(array_agg(distinct value::uuid order by value::uuid), '{}') into v_compatibilities
      from jsonb_array_elements_text(coalesce(p_request->'compatibleServoIds', '[]'));
    if v_type <> 'REPAIR_KIT' and cardinality(v_compatibilities) > 0 then
      raise exception using errcode = '22023', message = 'catalog_invalid_compatibilities';
    end if;
    -- Namespace lock BEFORE referenced metadata; shared with all catalog writers.
    select lock_identity into v_lock from private.catalog_code_write_policy(v_code);
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_lock, 0));
    perform 1 from public.items where id = any(v_compatibilities) order by id for share;
    if (select count(*) from public.items i join public.servo_models s on s.item_id = i.id where i.id = any(v_compatibilities) and i.is_active and i.item_type = 'SERVO') <> cardinality(v_compatibilities) then
      raise exception using errcode = '22023', message = 'catalog_invalid_compatibilities';
    end if;
    insert into public.items(code,description,item_type) values(v_code,v_description,v_type) returning id into v_id;
    case v_type
      when 'SERVO' then insert into public.servo_models(item_id,model) values(v_id,v_model);
      when 'INSTALLATION_KIT' then insert into public.installation_kits(item_id,name) values(v_id,v_description);
      when 'REPAIR_KIT' then
        insert into public.repair_kits(item_id,name) values(v_id,v_description);
        insert into public.servo_repair_compatibility(servo_id,repair_kit_id) select unnest(v_compatibilities),v_id;
      when 'LOOSE_PART' then insert into public.loose_parts(item_id) values(v_id);
    end case;
    -- No balance, batch or movement is created for a catalog-only registration.
  else
    v_id := (p_request->>'itemId')::uuid;
    if v_id is null or coalesce(p_request->>'expectedVersion','') !~ '^[0-9a-f]{32}$' then
      raise exception using errcode = '22023', message = 'catalog_invalid_request';
    end if;
    if v_operation = 'EDIT' then
      -- Lock old + proposed namespace in sorted order before taking the item row.
      -- In particular concurrent code swaps cannot invert trigger row locks.
      for v_lock in select distinct p.lock_identity from (
        select code from public.items where id = v_id union all select v_code
      ) c cross join lateral private.catalog_code_write_policy(c.code) p order by p.lock_identity loop
        perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_lock, 0));
      end loop;
    end if;
    -- NO KEY UPDATE blocks the canonical metadata FOR SHARE readers, but not FK
    -- KEY SHARE checks. This avoids balance-insert/FK inversion with legacy APIs.
    perform 1 from public.items where id = v_id for no key update;
    if not found then raise exception using errcode = '22023', message = 'catalog_item_not_found'; end if;
    perform 1 from public.stock_balances where item_id = v_id for update;
    v_balance_exists := found;
    v_before := private.physical_catalog_snapshot(v_id);
    if v_operation = 'ARCHIVE' and not v_balance_exists then
      insert into public.stock_balances(item_id,quantity) values(v_id,0) on conflict(item_id) do nothing returning item_id into v_inserted;
      perform 1 from public.stock_balances where item_id = v_id for update;
      -- A legacy writer may have inserted the absent row in between: revalidate.
      if v_inserted is null then v_before := private.physical_catalog_snapshot(v_id); end if;
    end if;
    if v_before->>'version' is distinct from p_request->>'expectedVersion' then
      raise exception using errcode = '40001', message = 'catalog_item_stale';
    end if;
    if (v_before->>'isActive')::boolean is not true then
      raise exception using errcode = '22023', message = 'catalog_item_inactive';
    end if;
    v_type := v_before->>'itemType';
    if (v_type = 'SERVO' and not exists(select 1 from public.servo_models where item_id = v_id))
      or (v_type = 'INSTALLATION_KIT' and not exists(select 1 from public.installation_kits where item_id = v_id))
      or (v_type = 'REPAIR_KIT' and not exists(select 1 from public.repair_kits where item_id = v_id))
      or (v_type = 'LOOSE_PART' and not exists(select 1 from public.loose_parts where item_id = v_id)) then
      raise exception using errcode = '23514', message = 'catalog_invalid_subtype';
    end if;
    if v_operation = 'EDIT' then
      update public.items set code = v_code, description = v_description, updated_at = clock_timestamp() where id = v_id;
    else
      v_quantity := (v_before->>'quantity')::integer;
      if (p_request->>'expectedQuantity')::integer is distinct from v_quantity then
        raise exception using errcode = '40001', message = 'catalog_item_stale';
      end if;
      if exists(select 1 from jsonb_each_text(v_before->'dependencies') d where d.value::integer > 0) then
        raise exception using errcode = '23514', message = 'catalog_item_has_dependencies';
      end if;
      if v_quantity > 0 then
        -- Internal child key is not the user key, and is never reused by a retry.
        -- The global immutable receipt is committed together with this child.
        v_adjustment := private.adjust_inventory_stock_checked('ITEM',v_id,0,v_quantity,
          left('Correção de cadastro / exclusão de produto: ' || v_reason,500),gen_random_uuid(),v_actor.user_id,v_actor.user_name);
      end if;
      update public.items set is_active = false, updated_at = clock_timestamp() where id = v_id;
    end if;
  end if;
  v_after := private.physical_catalog_snapshot(v_id);
  if v_after is null or (v_operation = 'ARCHIVE' and ((v_after->>'isActive')::boolean or (v_after->>'quantity')::integer <> 0)) then
    raise exception using errcode = '23514', message = 'catalog_persistence_failed';
  end if;
  v_result := jsonb_build_object('item',v_after,'operation',v_operation,'adjustment',v_adjustment,'idempotentReplay',false);
  insert into private.physical_catalog_requests(user_id,user_name_snapshot,idempotency_key,request,item_id,before_snapshot,result)
    values(v_actor.user_id,v_actor.user_name,p_idempotency_key,v_request,v_id,v_before,v_result);
  return v_result;
end;
$$;
revoke all on function private.manage_physical_catalog(jsonb,uuid) from public, anon, authenticated, service_role;

create function public.manage_physical_catalog(p_request jsonb, p_idempotency_key uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select private.manage_physical_catalog(p_request,p_idempotency_key);
$$;
revoke all on function public.manage_physical_catalog(jsonb,uuid) from public, anon, authenticated, service_role;
grant execute on function public.manage_physical_catalog(jsonb,uuid) to authenticated;

comment on table private.physical_catalog_requests is 'Immutable physical catalog identity/audit and per-user request receipts. Preserve alongside the catalog; never a sales ledger.';
commit;
