-- Only individual, immutable READY_QUANTITY_INCREMENTED events enqueue item
-- notifications. Quantity writers and the atomic mark-all worker are unchanged.
alter table public.push_notification_events
  drop constraint push_notification_events_type_check,
  drop constraint push_notification_events_order_type_key,
  add column supplier_order_item_id uuid
    references public.supplier_order_items(id) on delete restrict,
  add column portal_event_id uuid
    references public.safisa_portal_events(id) on delete restrict,
  add column code_snapshot text,
  add column description_snapshot text,
  add column quantity_delta integer,
  add constraint push_notification_events_type_check check (
    event_type in ('SAFISA_FULLY_READY', 'SAFISA_ITEM_READY')
  ),
  add constraint push_notification_events_item_payload_check check (
    (event_type = 'SAFISA_FULLY_READY'
      and supplier_order_item_id is null and portal_event_id is null
      and code_snapshot is null and description_snapshot is null
      and quantity_delta is null)
    or (event_type = 'SAFISA_ITEM_READY'
      and supplier_order_item_id is not null and portal_event_id is not null
      and code_snapshot is not null and btrim(code_snapshot) <> ''
      and description_snapshot is not null and btrim(description_snapshot) <> ''
      and quantity_delta is not null and quantity_delta > 0)
  );

create unique index push_notification_events_fully_ready_order_uidx
  on public.push_notification_events(supplier_order_id, event_type)
  where event_type = 'SAFISA_FULLY_READY';
create unique index push_notification_events_item_source_uidx
  on public.push_notification_events(portal_event_id)
  where event_type = 'SAFISA_ITEM_READY';
create index push_notification_events_item_idx
  on public.push_notification_events(supplier_order_item_id)
  where supplier_order_item_id is not null;

-- Keep the existing FULLY_READY transition semantics. Only the conflict
-- inference changes to match its new partial unique index.
create or replace function private.enqueue_safisa_fully_ready_push()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_negotiation_number text;
  v_ordered_quantity bigint;
  v_cancelled_quantity bigint;
  v_ready_quantity bigint;
  v_waiting_pickup_quantity bigint;
  v_previous_ready_quantity bigint;
  v_previous_cancelled_quantity bigint;
  v_previous_waiting_pickup_quantity bigint;
begin
  if new.ready_quantity is not distinct from old.ready_quantity
    and new.cancelled_quantity is not distinct from old.cancelled_quantity then
    return new;
  end if;
  select supplier_order.negotiation_number,
    coalesce(sum(order_item.ordered_quantity), 0),
    coalesce(sum(order_item.cancelled_quantity), 0),
    coalesce(sum(order_item.ready_quantity), 0),
    coalesce(sum(order_item.ready_quantity - order_item.picked_quantity), 0)
  into v_negotiation_number, v_ordered_quantity, v_cancelled_quantity,
    v_ready_quantity, v_waiting_pickup_quantity
  from public.supplier_orders as supplier_order
  join public.supplier_order_items as order_item
    on order_item.supplier_order_id = supplier_order.id
  where supplier_order.id = new.supplier_order_id
    and supplier_order.cancelled_at is null
  group by supplier_order.negotiation_number;
  if not found then return new; end if;
  v_previous_ready_quantity := v_ready_quantity - new.ready_quantity + old.ready_quantity;
  v_previous_cancelled_quantity := v_cancelled_quantity - new.cancelled_quantity + old.cancelled_quantity;
  v_previous_waiting_pickup_quantity := v_waiting_pickup_quantity - new.ready_quantity + old.ready_quantity;
  if v_waiting_pickup_quantity > 0
    and v_ready_quantity + v_cancelled_quantity = v_ordered_quantity
    and not (v_previous_waiting_pickup_quantity > 0
      and v_previous_ready_quantity + v_previous_cancelled_quantity = v_ordered_quantity) then
    insert into public.push_notification_events(event_type, supplier_order_id, negotiation_number)
    values ('SAFISA_FULLY_READY', new.supplier_order_id, v_negotiation_number)
    on conflict (supplier_order_id, event_type)
      where event_type = 'SAFISA_FULLY_READY' do nothing;
  end if;
  return new;
end;
$$;

create function private.enqueue_safisa_item_ready_push()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_line public.supplier_order_items%rowtype;
  v_negotiation_number text;
  v_fully_ready boolean;
begin
  -- Corrections and READY_QUANTITIES_ALL_MARKED are deliberately excluded.
  if new.event_type <> 'READY_QUANTITY_INCREMENTED' then return new; end if;
  select * into strict v_line from public.supplier_order_items
    where id = new.supplier_order_item_id and supplier_order_id = new.supplier_order_id;
  -- The canonical writer already holds order -> line locks until commit. This
  -- runs after its quantity update, so the final individual action never gets
  -- both an item notification and a whole-order notification.
  select supplier_order.negotiation_number,
    sum(order_item.ready_quantity + order_item.cancelled_quantity)
      = sum(order_item.ordered_quantity)
  into v_negotiation_number, v_fully_ready
  from public.supplier_orders as supplier_order
  join public.supplier_order_items as order_item on order_item.supplier_order_id = supplier_order.id
  where supplier_order.id = new.supplier_order_id
  group by supplier_order.negotiation_number;
  if v_fully_ready then return new; end if;
  insert into public.push_notification_events(
    event_type, supplier_order_id, supplier_order_item_id, negotiation_number,
    portal_event_id, code_snapshot, description_snapshot, quantity_delta
  ) values (
    'SAFISA_ITEM_READY', new.supplier_order_id, new.supplier_order_item_id,
    v_negotiation_number, new.id, v_line.code_snapshot,
    v_line.description_snapshot, new.quantity_delta
  );
  return new;
end;
$$;

create trigger safisa_portal_events_enqueue_item_ready_push
after insert on public.safisa_portal_events for each row
when (new.event_type = 'READY_QUANTITY_INCREMENTED')
execute function private.enqueue_safisa_item_ready_push();
revoke all on function private.enqueue_safisa_item_ready_push() from public, anon, authenticated;

-- Add only the canonical event reference to the existing authenticated result.
-- The worker's quantity, locking, immutable result and replay policy stay intact.
create or replace function public.increment_safisa_ready_quantity(
  p_supplier_order_item_id uuid, p_increment_quantity integer, p_idempotency_key uuid
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_actor record;
  v_result jsonb;
  v_event_id uuid;
begin
  select * into v_actor from private.require_active_safisa_member();
  v_result := private.increment_safisa_ready_quantity(
    p_supplier_order_item_id, p_increment_quantity, p_idempotency_key,
    v_actor.user_id, v_actor.user_name
  );
  select id into strict v_event_id from public.safisa_portal_events
    where actor_user_id = v_actor.user_id and idempotency_key = p_idempotency_key
      and event_type = 'READY_QUANTITY_INCREMENTED';
  return v_result || jsonb_build_object('portal_event_id', v_event_id);
end;
$$;

-- Claim only the notification for this exact individual action. If it was the
-- final increment, there is no ITEM_READY source and only FULLY_READY is eligible.
create function public.claim_safisa_ready_push_event(
  p_supplier_order_id uuid, p_portal_event_id uuid
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_event public.push_notification_events%rowtype;
begin
  if p_supplier_order_id is null or p_portal_event_id is null then
    raise exception using errcode = '22023', message = 'Order and portal event are required.';
  end if;
  if not exists (select 1 from public.safisa_portal_events
    where id = p_portal_event_id and supplier_order_id = p_supplier_order_id
      and event_type = 'READY_QUANTITY_INCREMENTED') then
    raise exception using errcode = '22023', message = 'Canonical increment event is invalid.';
  end if;
  select event.* into v_event from public.push_notification_events as event
  where event.supplier_order_id = p_supplier_order_id
    and (event.portal_event_id = p_portal_event_id
      or (event.event_type = 'SAFISA_FULLY_READY' and not exists (
        select 1 from public.push_notification_events as item_event
        where item_event.portal_event_id = p_portal_event_id
      )))
    and event.attempt_count < 3
    and (event.status in ('PENDING', 'FAILED')
      or (event.status = 'SENDING' and event.updated_at < now() - interval '10 minutes'))
  for update skip locked;
  if not found then return null; end if;
  update public.push_notification_events set status = 'SENDING',
    attempt_count = attempt_count + 1, last_error_code = null, updated_at = now()
  where id = v_event.id returning * into v_event;
  return jsonb_build_object(
    'id', v_event.id, 'event_type', v_event.event_type,
    'supplier_order_id', v_event.supplier_order_id,
    'negotiation_number', v_event.negotiation_number,
    'supplier_order_item_id', v_event.supplier_order_item_id,
    'portal_event_id', v_event.portal_event_id,
    'code_snapshot', v_event.code_snapshot, 'description_snapshot', v_event.description_snapshot,
    'quantity_delta', v_event.quantity_delta, 'attempt_count', v_event.attempt_count
  );
end;
$$;

-- Whole-order/cancellation callers keep their existing claim signature. Add
-- the attempt fence so the updated dispatcher also completes FULLY_READY safely.
create or replace function public.claim_safisa_fully_ready_push_event(p_supplier_order_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_event public.push_notification_events%rowtype;
begin
  if p_supplier_order_id is null then
    raise exception using errcode = '22023', message = 'Supplier order is required.';
  end if;
  select event.* into v_event from public.push_notification_events as event
  where event.supplier_order_id = p_supplier_order_id and event.event_type = 'SAFISA_FULLY_READY'
    and event.attempt_count < 3 and (event.status in ('PENDING', 'FAILED')
      or (event.status = 'SENDING' and event.updated_at < now() - interval '10 minutes'))
  for update skip locked;
  if not found then return null; end if;
  update public.push_notification_events set status = 'SENDING', attempt_count = attempt_count + 1,
    last_error_code = null, updated_at = now() where id = v_event.id returning * into v_event;
  return jsonb_build_object('id', v_event.id, 'event_type', v_event.event_type,
    'supplier_order_id', v_event.supplier_order_id, 'negotiation_number', v_event.negotiation_number,
    'attempt_count', v_event.attempt_count);
end;
$$;

create function public.complete_safisa_ready_push_event(
  p_event_id uuid, p_attempt_count integer, p_status text, p_last_error_code text default null
)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_error_code text := nullif(btrim(p_last_error_code), '');
begin
  if p_event_id is null or p_attempt_count is null or p_attempt_count not between 1 and 3
    or p_status is null or p_status not in ('SENT', 'FAILED', 'NO_RECIPIENTS')
    or (v_error_code is not null and (char_length(v_error_code) > 80
      or v_error_code !~ '^[A-Z0-9_:-]+$')) then
    raise exception using errcode = '22023', message = 'Push event completion is invalid.';
  end if;
  -- A timed-out worker may not complete a newer claim after lease recovery.
  update public.push_notification_events set status = p_status, last_error_code = v_error_code,
    sent_at = case when p_status = 'SENT' then now() else null end, updated_at = now()
  where id = p_event_id and status = 'SENDING' and attempt_count = p_attempt_count;
end;
$$;
revoke all on function public.claim_safisa_ready_push_event(uuid, uuid) from public, anon, authenticated;
revoke all on function public.complete_safisa_ready_push_event(uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.claim_safisa_ready_push_event(uuid, uuid) to service_role;
grant execute on function public.complete_safisa_ready_push_event(uuid, integer, text, text) to service_role;

comment on column public.push_notification_events.portal_event_id is
  'Immutable READY_QUANTITY_INCREMENTED source; one ITEM_READY per source, never for corrections or mark-all.';
