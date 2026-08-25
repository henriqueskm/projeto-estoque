-- NK-PUSH-001: optional per-device FCM delivery for the existing
-- SAFISA_FULLY_READY state. Supabase remains the source of truth; delivery is
-- deliberately outside the supplier-order transaction.

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_id uuid not null,
  fcm_token text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint push_subscriptions_fcm_token_not_blank
    check (char_length(fcm_token) between 20 and 4096),
  constraint push_subscriptions_fcm_token_format
    check (fcm_token ~ '^[A-Za-z0-9_:-]+$'),
  constraint push_subscriptions_fcm_token_key unique (fcm_token),
  constraint push_subscriptions_device_id_key unique (device_id)
);

create index push_subscriptions_enabled_user_idx
  on public.push_subscriptions (user_id)
  where enabled;

create table public.push_notification_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  supplier_order_id uuid not null
    references public.supplier_orders(id) on delete cascade,
  negotiation_number text not null,
  status text not null default 'PENDING',
  attempt_count integer not null default 0,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint push_notification_events_type_check
    check (event_type = 'SAFISA_FULLY_READY'),
  constraint push_notification_events_status_check
    check (status in ('PENDING', 'SENDING', 'SENT', 'FAILED', 'NO_RECIPIENTS')),
  constraint push_notification_events_attempt_count_check
    check (attempt_count between 0 and 3),
  constraint push_notification_events_error_code_check
    check (
      last_error_code is null
      or (
        char_length(last_error_code) between 1 and 80
        and last_error_code ~ '^[A-Z0-9_:-]+$'
      )
    ),
  constraint push_notification_events_order_type_key
    unique (supplier_order_id, event_type)
);

create index push_notification_events_pending_idx
  on public.push_notification_events (status, updated_at)
  where status in ('PENDING', 'SENDING', 'FAILED');

alter table public.push_subscriptions enable row level security;
alter table public.push_notification_events enable row level security;

revoke all on table public.push_subscriptions
  from public, anon, authenticated;
revoke all on table public.push_notification_events
  from public, anon, authenticated;
grant select, update on table public.push_subscriptions to service_role;
grant select, update on table public.push_notification_events to service_role;

create or replace function public.register_push_subscription(
  p_device_id uuid,
  p_fcm_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_token text := nullif(btrim(p_fcm_token), '');
  v_subscription_id uuid;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication is required.';
  end if;

  if not exists (
    select 1
    from public.profiles as profile
    where profile.id = v_user_id
      and profile.is_active
  ) then
    raise exception using errcode = '42501', message = 'An active internal profile is required.';
  end if;

  if p_device_id is null
    or v_token is null
    or char_length(v_token) not between 20 and 4096
    or v_token !~ '^[A-Za-z0-9_:-]+$' then
    raise exception using errcode = '22023', message = 'The push token is invalid.';
  end if;

  delete from public.push_subscriptions
  where fcm_token = v_token
    and device_id <> p_device_id;

  insert into public.push_subscriptions (
    user_id,
    device_id,
    fcm_token,
    enabled,
    last_seen_at
  ) values (
    v_user_id,
    p_device_id,
    v_token,
    true,
    now()
  )
  on conflict (device_id) do update
  set user_id = excluded.user_id,
      fcm_token = excluded.fcm_token,
      enabled = true,
      updated_at = now(),
      last_seen_at = now()
  returning id into v_subscription_id;

  return jsonb_build_object(
    'subscription_id', v_subscription_id,
    'enabled', true
  );
end;
$$;

create or replace function public.disable_push_subscription(
  p_device_id uuid,
  p_fcm_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_token text := nullif(btrim(p_fcm_token), '');
  v_disabled boolean := false;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication is required.';
  end if;

  if not exists (
    select 1
    from public.profiles as profile
    where profile.id = v_user_id
      and profile.is_active
  ) then
    raise exception using errcode = '42501', message = 'An active internal profile is required.';
  end if;

  if p_device_id is null
    or v_token is null
    or char_length(v_token) not between 20 and 4096
    or v_token !~ '^[A-Za-z0-9_:-]+$' then
    raise exception using errcode = '22023', message = 'The push token is invalid.';
  end if;

  update public.push_subscriptions
  set enabled = false,
      updated_at = now(),
      last_seen_at = now()
  where user_id = v_user_id
    and device_id = p_device_id
    and fcm_token = v_token
    and enabled
  returning true into v_disabled;

  return jsonb_build_object('disabled', coalesce(v_disabled, false));
end;
$$;

revoke all on function public.register_push_subscription(uuid, text)
  from public, anon, authenticated;
revoke all on function public.disable_push_subscription(uuid, text)
  from public, anon, authenticated;
grant execute on function public.register_push_subscription(uuid, text)
  to authenticated;
grant execute on function public.disable_push_subscription(uuid, text)
  to authenticated;

comment on function public.register_push_subscription(uuid, text) is
  'Registers or safely reassigns the current browser FCM token to the authenticated active internal profile.';
comment on function public.disable_push_subscription(uuid, text) is
  'Disables only the current active internal profile subscription matching the supplied browser FCM token.';

create or replace function private.enqueue_safisa_fully_ready_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_negotiation_number text;
  v_ordered_quantity bigint;
  v_cancelled_quantity bigint;
  v_ready_quantity bigint;
  v_waiting_pickup_quantity bigint;
  v_previous_ready_quantity bigint;
  v_previous_waiting_pickup_quantity bigint;
begin
  if new.ready_quantity is not distinct from old.ready_quantity then
    return new;
  end if;

  select
    supplier_order.negotiation_number,
    coalesce(sum(order_item.ordered_quantity), 0),
    coalesce(sum(order_item.cancelled_quantity), 0),
    coalesce(sum(order_item.ready_quantity), 0),
    coalesce(sum(order_item.ready_quantity - order_item.picked_quantity), 0)
  into
    v_negotiation_number,
    v_ordered_quantity,
    v_cancelled_quantity,
    v_ready_quantity,
    v_waiting_pickup_quantity
  from public.supplier_orders as supplier_order
  join public.supplier_order_items as order_item
    on order_item.supplier_order_id = supplier_order.id
  where supplier_order.id = new.supplier_order_id
    and supplier_order.cancelled_at is null
  group by supplier_order.negotiation_number;

  if not found then
    return new;
  end if;

  v_previous_ready_quantity :=
    v_ready_quantity - new.ready_quantity + old.ready_quantity;
  v_previous_waiting_pickup_quantity :=
    v_waiting_pickup_quantity - new.ready_quantity + old.ready_quantity;

  if v_waiting_pickup_quantity > 0
    and v_ready_quantity + v_cancelled_quantity = v_ordered_quantity
    and not (
      v_previous_waiting_pickup_quantity > 0
      and v_previous_ready_quantity + v_cancelled_quantity = v_ordered_quantity
    ) then
    insert into public.push_notification_events (
      event_type,
      supplier_order_id,
      negotiation_number
    ) values (
      'SAFISA_FULLY_READY',
      new.supplier_order_id,
      v_negotiation_number
    )
    on conflict (supplier_order_id, event_type) do nothing;
  end if;

  return new;
end;
$$;

create trigger supplier_order_items_enqueue_fully_ready_push
after update of ready_quantity
on public.supplier_order_items
for each row
execute function private.enqueue_safisa_fully_ready_push();

revoke all on function private.enqueue_safisa_fully_ready_push()
  from public, anon, authenticated;

create or replace function public.claim_safisa_fully_ready_push_event(
  p_supplier_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.push_notification_events%rowtype;
begin
  if p_supplier_order_id is null then
    raise exception using errcode = '22023', message = 'Supplier order is required.';
  end if;

  select event.*
  into v_event
  from public.push_notification_events as event
  where event.supplier_order_id = p_supplier_order_id
    and event.event_type = 'SAFISA_FULLY_READY'
    and event.attempt_count < 3
    and (
      event.status in ('PENDING', 'FAILED')
      or (
        event.status = 'SENDING'
        and event.updated_at < now() - interval '10 minutes'
      )
    )
  for update skip locked;

  if not found then
    return null;
  end if;

  update public.push_notification_events
  set status = 'SENDING',
      attempt_count = attempt_count + 1,
      last_error_code = null,
      updated_at = now()
  where id = v_event.id;

  return jsonb_build_object(
    'id', v_event.id,
    'event_type', v_event.event_type,
    'supplier_order_id', v_event.supplier_order_id,
    'negotiation_number', v_event.negotiation_number
  );
end;
$$;

create or replace function public.complete_safisa_fully_ready_push_event(
  p_event_id uuid,
  p_status text,
  p_last_error_code text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_error_code text := nullif(btrim(p_last_error_code), '');
begin
  if p_event_id is null
    or p_status not in ('SENT', 'FAILED', 'NO_RECIPIENTS')
    or (
      v_error_code is not null
      and (
        char_length(v_error_code) > 80
        or v_error_code !~ '^[A-Z0-9_:-]+$'
      )
    ) then
    raise exception using errcode = '22023', message = 'Push event completion is invalid.';
  end if;

  update public.push_notification_events
  set status = p_status,
      last_error_code = v_error_code,
      sent_at = case when p_status = 'SENT' then now() else null end,
      updated_at = now()
  where id = p_event_id
    and event_type = 'SAFISA_FULLY_READY'
    and status = 'SENDING';
end;
$$;

revoke all on function public.claim_safisa_fully_ready_push_event(uuid)
  from public, anon, authenticated;
revoke all on function public.complete_safisa_fully_ready_push_event(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_safisa_fully_ready_push_event(uuid)
  to service_role;
grant execute on function public.complete_safisa_fully_ready_push_event(uuid, text, text)
  to service_role;

comment on table public.push_subscriptions is
  'Per-device optional FCM subscriptions for active internal NK users. Tokens are never exposed through normal readers.';
comment on table public.push_notification_events is
  'Idempotent best-effort delivery events. Supabase state remains authoritative even when delivery fails.';
