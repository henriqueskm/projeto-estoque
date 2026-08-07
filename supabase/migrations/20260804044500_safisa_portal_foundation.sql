-- MIG-SAF-001: Safisa portal database foundation.
--
-- This migration is intentionally self-contained. It creates no user,
-- publishes no supplier order, and preserves the existing separation between
-- supplier pickup and stock entry.
--
-- Shared lock order for every mutable order operation:
--   1. per-user/idempotency-key advisory transaction lock;
--   2. supplier_orders row;
--   3. safisa_order_authorizations row, when applicable;
--   4. supplier_order_items rows ordered by UUID.

alter table public.profiles
  alter column is_active set default false;

comment on column public.profiles.is_active is
  'Internal-application access flag. New profiles default to denied; Safisa portal membership is authorized separately.';

create table public.safisa_portal_members (
  user_id uuid primary key
    references auth.users (id) on delete restrict,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid not null
    references public.profiles (id) on delete restrict,
  created_by_name_snapshot text not null,
  activated_at timestamptz,
  activated_by uuid
    references public.profiles (id) on delete restrict,
  activated_by_name_snapshot text,
  deactivated_at timestamptz,
  deactivated_by uuid
    references public.profiles (id) on delete restrict,
  deactivated_by_name_snapshot text,
  updated_at timestamptz not null default now(),
  constraint safisa_portal_members_creator_snapshot_check check (
    btrim(created_by_name_snapshot) <> ''
  ),
  constraint safisa_portal_members_activation_snapshot_check check (
    activated_by_name_snapshot is null
    or btrim(activated_by_name_snapshot) <> ''
  ),
  constraint safisa_portal_members_deactivation_snapshot_check check (
    deactivated_by_name_snapshot is null
    or btrim(deactivated_by_name_snapshot) <> ''
  ),
  constraint safisa_portal_members_state_metadata_check check (
    (
      is_active
      and activated_at is not null
      and activated_by is not null
      and activated_by_name_snapshot is not null
      and deactivated_at is null
      and deactivated_by is null
      and deactivated_by_name_snapshot is null
    )
    or
    (
      not is_active
      and (
        (
          activated_at is null
          and activated_by is null
          and activated_by_name_snapshot is null
          and deactivated_at is null
          and deactivated_by is null
          and deactivated_by_name_snapshot is null
        )
        or
        (
          activated_at is not null
          and activated_by is not null
          and activated_by_name_snapshot is not null
          and deactivated_at is not null
          and deactivated_by is not null
          and deactivated_by_name_snapshot is not null
          and deactivated_at >= activated_at
        )
      )
    )
  )
);

comment on table public.safisa_portal_members is
  'Individual, administratively provisioned Safisa portal memberships. Membership never grants internal application access.';

create table public.safisa_order_authorizations (
  supplier_order_id uuid primary key
    references public.supplier_orders (id) on delete restrict,
  is_authorized boolean not null default false,
  published_at timestamptz not null default now(),
  published_by uuid not null
    references public.profiles (id) on delete restrict,
  published_by_name_snapshot text not null,
  revoked_at timestamptz,
  revoked_by uuid
    references public.profiles (id) on delete restrict,
  revoked_by_name_snapshot text,
  updated_at timestamptz not null default now(),
  constraint safisa_order_authorizations_publisher_snapshot_check check (
    btrim(published_by_name_snapshot) <> ''
  ),
  constraint safisa_order_authorizations_revoker_snapshot_check check (
    revoked_by_name_snapshot is null
    or btrim(revoked_by_name_snapshot) <> ''
  ),
  constraint safisa_order_authorizations_state_metadata_check check (
    (
      is_authorized
      and revoked_at is null
      and revoked_by is null
      and revoked_by_name_snapshot is null
    )
    or
    (
      not is_authorized
      and revoked_at is not null
      and revoked_by is not null
      and revoked_by_name_snapshot is not null
      and revoked_at >= published_at
    )
  )
);

comment on table public.safisa_order_authorizations is
  'Explicit publication ledger. No existing or future supplier order is published automatically.';

create table public.safisa_portal_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  actor_user_id uuid not null
    references auth.users (id) on delete restrict,
  actor_name_snapshot text not null,
  actor_kind text not null,
  target_user_id uuid
    references auth.users (id) on delete restrict,
  supplier_order_id uuid
    references public.supplier_orders (id) on delete restrict,
  supplier_order_item_id uuid
    references public.supplier_order_items (id) on delete restrict,
  idempotency_key uuid not null,
  previous_quantity integer,
  quantity_delta integer,
  new_quantity integer,
  justification text,
  request_payload jsonb not null,
  result_payload jsonb not null,
  created_at timestamptz not null default now(),
  constraint safisa_portal_events_type_check check (
    event_type in (
      'MEMBER_STATUS_CHANGED',
      'ORDER_PUBLISHED',
      'ORDER_REVOKED',
      'READY_QUANTITY_INCREMENTED',
      'READY_QUANTITY_CORRECTED'
    )
  ),
  constraint safisa_portal_events_actor_check check (
    btrim(actor_name_snapshot) <> ''
    and actor_kind in ('INTERNAL', 'SAFISA')
  ),
  constraint safisa_portal_events_target_check check (
    (
      event_type = 'MEMBER_STATUS_CHANGED'
      and actor_kind = 'INTERNAL'
      and target_user_id is not null
      and supplier_order_id is null
      and supplier_order_item_id is null
    )
    or
    (
      event_type in ('ORDER_PUBLISHED', 'ORDER_REVOKED')
      and actor_kind = 'INTERNAL'
      and target_user_id is null
      and supplier_order_id is not null
      and supplier_order_item_id is null
    )
    or
    (
      event_type in (
        'READY_QUANTITY_INCREMENTED',
        'READY_QUANTITY_CORRECTED'
      )
      and target_user_id is null
      and supplier_order_id is not null
      and supplier_order_item_id is not null
    )
  ),
  constraint safisa_portal_events_quantities_check check (
    (
      event_type in (
        'MEMBER_STATUS_CHANGED',
        'ORDER_PUBLISHED',
        'ORDER_REVOKED'
      )
      and previous_quantity is null
      and quantity_delta is null
      and new_quantity is null
    )
    or
    (
      event_type in (
        'READY_QUANTITY_INCREMENTED',
        'READY_QUANTITY_CORRECTED'
      )
      and previous_quantity is not null
      and quantity_delta is not null
      and new_quantity is not null
      and previous_quantity >= 0
      and new_quantity >= 0
      and quantity_delta = new_quantity - previous_quantity
    )
  ),
  constraint safisa_portal_events_justification_check check (
    (
      event_type = 'READY_QUANTITY_CORRECTED'
      and justification is not null
      and justification = btrim(justification)
      and char_length(justification) between 1 and 500
    )
    or
    (
      event_type <> 'READY_QUANTITY_CORRECTED'
      and justification is null
    )
  ),
  constraint safisa_portal_events_payload_check check (
    jsonb_typeof(request_payload) = 'object'
    and jsonb_typeof(result_payload) = 'object'
  )
);

comment on table public.safisa_portal_events is
  'Immutable audit and per-user idempotency ledger for Safisa portal administration and readiness operations.';

alter table public.supplier_order_items
  add column ready_quantity integer;

-- Existing picked units are necessarily ready. The backfill creates no event
-- because no historical Safisa actor exists and publishes no order.
update public.supplier_order_items
set ready_quantity = picked_quantity;

alter table public.supplier_order_items
  alter column ready_quantity set default 0,
  alter column ready_quantity set not null,
  add constraint supplier_order_items_ready_quantity_nonnegative_check check (
    ready_quantity >= 0
  ),
  add constraint supplier_order_items_ready_not_below_picked_check check (
    ready_quantity >= picked_quantity
  ),
  add constraint supplier_order_items_ready_not_above_valid_check check (
    ready_quantity + cancelled_quantity <= ordered_quantity
  );

comment on column public.supplier_order_items.ready_quantity is
  'Cumulative units reported ready by Safisa. It includes every picked unit and never exceeds ordered quantity net of cancellation.';

create index safisa_portal_members_active_idx
  on public.safisa_portal_members (user_id)
  where is_active;

create index safisa_order_authorizations_active_idx
  on public.safisa_order_authorizations (supplier_order_id)
  where is_authorized;

create index supplier_order_items_ready_pickup_idx
  on public.supplier_order_items (supplier_order_id, id)
  where ready_quantity > picked_quantity;

create unique index safisa_portal_events_actor_idempotency_uidx
  on public.safisa_portal_events (actor_user_id, idempotency_key);

create index safisa_portal_events_order_line_created_idx
  on public.safisa_portal_events (
    supplier_order_id,
    supplier_order_item_id,
    created_at desc,
    id
  )
  where supplier_order_id is not null;

create index safisa_portal_events_target_user_created_idx
  on public.safisa_portal_events (target_user_id, created_at desc, id)
  where target_user_id is not null;

create function private.prevent_internal_safisa_overlap()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_table_name = 'profiles' then
    if new.is_active and exists (
      select 1
      from public.safisa_portal_members as member
      where member.user_id = new.id
        and member.is_active
    ) then
      raise exception using
        errcode = '23514',
        message = 'A Safisa portal member cannot be activated as an internal profile.';
    end if;
  elsif new.is_active and exists (
    select 1
    from public.profiles as profile
    where profile.id = new.user_id
      and profile.is_active
  ) then
    raise exception using
      errcode = '23514',
      message = 'An internal profile cannot be activated as a Safisa portal member.';
  end if;

  return new;
end;
$$;

create trigger profiles_prevent_active_safisa_overlap
before insert or update of is_active
on public.profiles
for each row
execute function private.prevent_internal_safisa_overlap();

create trigger safisa_members_prevent_active_internal_overlap
before insert or update of is_active, user_id
on public.safisa_portal_members
for each row
execute function private.prevent_internal_safisa_overlap();

create function private.protect_supplier_order_item_readiness()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.ready_quantity > 0 then
      raise exception using
        errcode = '23514',
        message = 'A supplier-order line with ready units cannot be removed.';
    end if;

    return old;
  end if;

  if old.ready_quantity > 0 and (
    old.item_id is distinct from new.item_id
    or old.commercial_configuration_id
      is distinct from new.commercial_configuration_id
    or old.commercial_configuration_code_id
      is distinct from new.commercial_configuration_code_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'A supplier-order line with ready units cannot change its catalog identity.';
  end if;

  if new.ready_quantity < new.picked_quantity then
    raise exception using
      errcode = '23514',
      message = 'ready_quantity cannot be lower than picked_quantity.';
  end if;

  if new.ready_quantity + new.cancelled_quantity > new.ordered_quantity then
    raise exception using
      errcode = '23514',
      message = 'Only quantity that is not ready can be cancelled or removed from the order.';
  end if;

  return new;
end;
$$;

create trigger supplier_order_items_protect_readiness_update
before update of
  item_id,
  commercial_configuration_id,
  commercial_configuration_code_id,
  ordered_quantity,
  picked_quantity,
  cancelled_quantity,
  ready_quantity
on public.supplier_order_items
for each row
execute function private.protect_supplier_order_item_readiness();

create trigger supplier_order_items_protect_readiness_delete
before delete on public.supplier_order_items
for each row
execute function private.protect_supplier_order_item_readiness();

create function private.validate_safisa_portal_event_target()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.supplier_order_item_id is not null and not exists (
    select 1
    from public.supplier_order_items as order_item
    where order_item.id = new.supplier_order_item_id
      and order_item.supplier_order_id = new.supplier_order_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'The Safisa event line does not belong to its supplier order.';
  end if;

  return new;
end;
$$;

create trigger safisa_portal_events_validate_target
before insert or update of supplier_order_id, supplier_order_item_id
on public.safisa_portal_events
for each row
execute function private.validate_safisa_portal_event_target();

create function private.require_active_safisa_member()
returns table (
  user_id uuid,
  user_name text,
  actor_kind text
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception using
      errcode = '28000',
      message = 'An authenticated user is required.';
  end if;

  return query
  select
    profile.id,
    btrim(profile.name),
    'SAFISA'::text
  from public.profiles as profile
  join public.safisa_portal_members as member
    on member.user_id = profile.id
   and member.is_active
  where profile.id = v_user_id
    and not profile.is_active
    and nullif(btrim(profile.name), '') is not null
  for share of profile, member;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'An active Safisa portal membership with a registered name is required.';
  end if;
end;
$$;

create function private.require_safisa_ready_actor(
  p_allow_internal boolean
)
returns table (
  user_id uuid,
  user_name text,
  actor_kind text
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_user_name text;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception using
      errcode = '28000',
      message = 'An authenticated user is required.';
  end if;

  select btrim(profile.name)
  into v_user_name
  from public.profiles as profile
  join public.safisa_portal_members as member
    on member.user_id = profile.id
   and member.is_active
  where profile.id = v_user_id
    and not profile.is_active
    and nullif(btrim(profile.name), '') is not null
  for share of profile, member;

  if found then
    return query select v_user_id, v_user_name, 'SAFISA'::text;
    return;
  end if;

  if p_allow_internal then
    select btrim(profile.name)
    into v_user_name
    from public.profiles as profile
    where profile.id = v_user_id
      and profile.is_active
      and nullif(btrim(profile.name), '') is not null
      and not exists (
        select 1
        from public.safisa_portal_members as member
        where member.user_id = profile.id
          and member.is_active
      )
    for share of profile;

    if found then
      return query select v_user_id, v_user_name, 'INTERNAL'::text;
      return;
    end if;
  end if;

  raise exception using
    errcode = '42501',
    message = 'An authorized Safisa or internal user with a registered name is required.';
end;
$$;

create function private.safisa_portal_existing_result(
  p_actor_user_id uuid,
  p_idempotency_key uuid,
  p_event_type text,
  p_request_payload jsonb
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_event_type text;
  v_existing_request jsonb;
  v_existing_result jsonb;
begin
  if p_actor_user_id is null
    or p_idempotency_key is null
    or p_event_type is null
    or p_request_payload is null
    or jsonb_typeof(p_request_payload) is distinct from 'object' then
    raise exception using
      errcode = '22023',
      message = 'Actor, idempotency key, event type, and request are required.';
  end if;

  -- Reuse the supplier-order advisory namespace so a key cannot race across
  -- internal and Safisa operations for the same authenticated user.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_actor_user_id::text || ':' || p_idempotency_key::text,
      0
    )
  );

  select
    event.event_type,
    event.request_payload,
    event.result_payload
  into
    v_event_type,
    v_existing_request,
    v_existing_result
  from public.safisa_portal_events as event
  where event.actor_user_id = p_actor_user_id
    and event.idempotency_key = p_idempotency_key;

  if found then
    if v_event_type is distinct from p_event_type
      or v_existing_request is distinct from p_request_payload
      or v_existing_result is null then
      raise exception using
        errcode = '22023',
        message = 'p_idempotency_key has already been used with a different Safisa portal request.';
    end if;

    return v_existing_result || jsonb_build_object(
      'idempotent_replay', true
    );
  end if;

  if exists (
    select 1
    from public.supplier_order_events as event
    where event.user_id = p_actor_user_id
      and event.idempotency_key = p_idempotency_key
  ) or exists (
    select 1
    from public.movement_batches as batch
    where batch.user_id = p_actor_user_id
      and batch.idempotency_key = p_idempotency_key
  ) then
    raise exception using
      errcode = '22023',
      message = 'p_idempotency_key has already been used by another operation.';
  end if;

  return null;
end;
$$;

create function private.set_safisa_portal_member_status(
  p_target_user_id uuid,
  p_is_active boolean,
  p_idempotency_key uuid,
  p_actor_user_id uuid,
  p_actor_name text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request jsonb;
  v_existing_result jsonb;
  v_target_profile public.profiles%rowtype;
  v_member public.safisa_portal_members%rowtype;
  v_previous_active boolean;
  v_changed boolean;
  v_now timestamptz := now();
  v_result jsonb;
begin
  if p_target_user_id is null
    or p_is_active is null
    or p_idempotency_key is null
    or p_actor_user_id is null
    or nullif(btrim(p_actor_name), '') is null then
    raise exception using
      errcode = '22023',
      message = 'Target user, active state, idempotency key, and actor are required.';
  end if;

  v_request := jsonb_build_object(
    'target_user_id', p_target_user_id,
    'is_active', p_is_active
  );

  v_existing_result := private.safisa_portal_existing_result(
    p_actor_user_id,
    p_idempotency_key,
    'MEMBER_STATUS_CHANGED',
    v_request
  );

  if v_existing_result is not null then
    return v_existing_result;
  end if;

  select profile.*
  into v_target_profile
  from public.profiles as profile
  where profile.id = p_target_user_id
    and nullif(btrim(profile.name), '') is not null
  for update;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'The target user requires a profile with a registered name.';
  end if;

  if v_target_profile.is_active then
    raise exception using
      errcode = '22023',
      message = 'An internal profile cannot become a Safisa portal member.';
  end if;

  select member.*
  into v_member
  from public.safisa_portal_members as member
  where member.user_id = p_target_user_id
  for update;

  if found then
    v_previous_active := v_member.is_active;
    v_changed := v_member.is_active is distinct from p_is_active;

    if v_changed then
      update public.safisa_portal_members
      set is_active = p_is_active,
          activated_at = case when p_is_active then v_now else activated_at end,
          activated_by = case when p_is_active then p_actor_user_id else activated_by end,
          activated_by_name_snapshot = case
            when p_is_active then btrim(p_actor_name)
            else activated_by_name_snapshot
          end,
          deactivated_at = case when p_is_active then null else v_now end,
          deactivated_by = case when p_is_active then null else p_actor_user_id end,
          deactivated_by_name_snapshot = case
            when p_is_active then null
            else btrim(p_actor_name)
          end,
          updated_at = v_now
      where user_id = p_target_user_id;
    end if;
  else
    v_previous_active := null;
    v_changed := true;

    insert into public.safisa_portal_members (
      user_id,
      is_active,
      created_by,
      created_by_name_snapshot,
      activated_at,
      activated_by,
      activated_by_name_snapshot,
      updated_at
    )
    values (
      p_target_user_id,
      p_is_active,
      p_actor_user_id,
      btrim(p_actor_name),
      case when p_is_active then v_now else null end,
      case when p_is_active then p_actor_user_id else null end,
      case when p_is_active then btrim(p_actor_name) else null end,
      v_now
    );
  end if;

  v_result := jsonb_build_object(
    'user_id', p_target_user_id,
    'is_active', p_is_active,
    'previous_is_active', v_previous_active,
    'changed', v_changed,
    'updated_at', v_now,
    'idempotent_replay', false
  );

  insert into public.safisa_portal_events (
    event_type,
    actor_user_id,
    actor_name_snapshot,
    actor_kind,
    target_user_id,
    idempotency_key,
    request_payload,
    result_payload
  )
  values (
    'MEMBER_STATUS_CHANGED',
    p_actor_user_id,
    btrim(p_actor_name),
    'INTERNAL',
    p_target_user_id,
    p_idempotency_key,
    v_request,
    v_result
  );

  return v_result;
end;
$$;

create function private.set_safisa_order_authorization(
  p_supplier_order_id uuid,
  p_is_authorized boolean,
  p_idempotency_key uuid,
  p_actor_user_id uuid,
  p_actor_name text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_event_type text;
  v_request jsonb;
  v_existing_result jsonb;
  v_authorization public.safisa_order_authorizations%rowtype;
  v_previous_authorized boolean;
  v_changed boolean;
  v_now timestamptz := now();
  v_result jsonb;
begin
  if p_supplier_order_id is null
    or p_is_authorized is null
    or p_idempotency_key is null
    or p_actor_user_id is null
    or nullif(btrim(p_actor_name), '') is null then
    raise exception using
      errcode = '22023',
      message = 'Order, authorization state, idempotency key, and actor are required.';
  end if;

  v_event_type := case
    when p_is_authorized then 'ORDER_PUBLISHED'
    else 'ORDER_REVOKED'
  end;
  v_request := jsonb_build_object(
    'supplier_order_id', p_supplier_order_id,
    'is_authorized', p_is_authorized
  );

  v_existing_result := private.safisa_portal_existing_result(
    p_actor_user_id,
    p_idempotency_key,
    v_event_type,
    v_request
  );

  if v_existing_result is not null then
    return v_existing_result;
  end if;

  perform 1
  from public.supplier_orders as supplier_order
  where supplier_order.id = p_supplier_order_id
  for update;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'The supplier order does not exist.';
  end if;

  select order_authorization.*
  into v_authorization
  from public.safisa_order_authorizations as order_authorization
  where order_authorization.supplier_order_id = p_supplier_order_id
  for update;

  if found then
    v_previous_authorized := v_authorization.is_authorized;
    v_changed := v_authorization.is_authorized is distinct from p_is_authorized;

    if v_changed then
      update public.safisa_order_authorizations
      set is_authorized = p_is_authorized,
          published_at = case when p_is_authorized then v_now else published_at end,
          published_by = case when p_is_authorized then p_actor_user_id else published_by end,
          published_by_name_snapshot = case
            when p_is_authorized then btrim(p_actor_name)
            else published_by_name_snapshot
          end,
          revoked_at = case when p_is_authorized then null else v_now end,
          revoked_by = case when p_is_authorized then null else p_actor_user_id end,
          revoked_by_name_snapshot = case
            when p_is_authorized then null
            else btrim(p_actor_name)
          end,
          updated_at = v_now
      where supplier_order_id = p_supplier_order_id;
    end if;
  elsif p_is_authorized then
    v_previous_authorized := null;
    v_changed := true;

    insert into public.safisa_order_authorizations (
      supplier_order_id,
      is_authorized,
      published_at,
      published_by,
      published_by_name_snapshot,
      updated_at
    )
    values (
      p_supplier_order_id,
      true,
      v_now,
      p_actor_user_id,
      btrim(p_actor_name),
      v_now
    );
  else
    raise exception using
      errcode = '22023',
      message = 'The supplier order is not published to Safisa.';
  end if;

  v_result := jsonb_build_object(
    'supplier_order_id', p_supplier_order_id,
    'is_authorized', p_is_authorized,
    'previous_is_authorized', v_previous_authorized,
    'changed', v_changed,
    'updated_at', v_now,
    'idempotent_replay', false
  );

  insert into public.safisa_portal_events (
    event_type,
    actor_user_id,
    actor_name_snapshot,
    actor_kind,
    supplier_order_id,
    idempotency_key,
    request_payload,
    result_payload
  )
  values (
    v_event_type,
    p_actor_user_id,
    btrim(p_actor_name),
    'INTERNAL',
    p_supplier_order_id,
    p_idempotency_key,
    v_request,
    v_result
  );

  return v_result;
end;
$$;

create function private.increment_safisa_ready_quantity(
  p_supplier_order_item_id uuid,
  p_increment_quantity integer,
  p_idempotency_key uuid,
  p_actor_user_id uuid,
  p_actor_name text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request jsonb;
  v_existing_result jsonb;
  v_order public.supplier_orders%rowtype;
  v_line public.supplier_order_items%rowtype;
  v_previous_quantity integer;
  v_new_quantity_bigint bigint;
  v_new_quantity integer;
  v_line_updated_at timestamptz;
  v_result jsonb;
begin
  if p_supplier_order_item_id is null
    or p_increment_quantity is null
    or p_increment_quantity <= 0
    or p_idempotency_key is null
    or p_actor_user_id is null
    or nullif(btrim(p_actor_name), '') is null then
    raise exception using
      errcode = '22023',
      message = 'Line, positive increment, idempotency key, and actor are required.';
  end if;

  v_request := jsonb_build_object(
    'supplier_order_item_id', p_supplier_order_item_id,
    'increment_quantity', p_increment_quantity
  );

  v_existing_result := private.safisa_portal_existing_result(
    p_actor_user_id,
    p_idempotency_key,
    'READY_QUANTITY_INCREMENTED',
    v_request
  );

  if v_existing_result is not null then
    return v_existing_result;
  end if;

  -- Parent order first, then authorization, then the requested line.
  select supplier_order.*
  into v_order
  from public.supplier_order_items as order_item
  join public.supplier_orders as supplier_order
    on supplier_order.id = order_item.supplier_order_id
  where order_item.id = p_supplier_order_item_id
  for update of supplier_order;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'The supplier-order line does not exist.';
  end if;

  perform 1
  from public.safisa_order_authorizations as order_authorization
  where order_authorization.supplier_order_id = v_order.id
    and order_authorization.is_authorized
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'The supplier order is not authorized for the Safisa portal.';
  end if;

  if v_order.finalized_at is not null or v_order.cancelled_at is not null then
    raise exception using
      errcode = '22023',
      message = 'A closed supplier order cannot change ready quantities.';
  end if;

  select order_item.*
  into v_line
  from public.supplier_order_items as order_item
  where order_item.id = p_supplier_order_item_id
    and order_item.supplier_order_id = v_order.id
  for update;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'The supplier-order line does not exist.';
  end if;

  v_previous_quantity := v_line.ready_quantity;
  v_new_quantity_bigint :=
    v_line.ready_quantity::bigint + p_increment_quantity::bigint;

  if v_new_quantity_bigint > 2147483647
    or v_new_quantity_bigint + v_line.cancelled_quantity
      > v_line.ordered_quantity then
    raise exception using
      errcode = '22023',
      message = 'The ready quantity cannot exceed the valid ordered quantity.';
  end if;

  v_new_quantity := v_new_quantity_bigint::integer;

  update public.supplier_order_items
  set ready_quantity = v_new_quantity
  where id = p_supplier_order_item_id;

  update public.supplier_orders
  set updated_at = now()
  where id = v_order.id;

  select order_item.updated_at
  into v_line_updated_at
  from public.supplier_order_items as order_item
  where order_item.id = p_supplier_order_item_id;

  v_result := jsonb_build_object(
    'supplier_order_id', v_order.id,
    'supplier_order_item_id', p_supplier_order_item_id,
    'negotiation_number', v_order.negotiation_number,
    'previous_ready_quantity', v_previous_quantity,
    'increment_quantity', p_increment_quantity,
    'new_ready_quantity', v_new_quantity,
    'picked_quantity', v_line.picked_quantity,
    'ready_waiting_pickup_quantity',
      v_new_quantity - v_line.picked_quantity,
    'line_updated_at', v_line_updated_at,
    'idempotent_replay', false
  );

  insert into public.safisa_portal_events (
    event_type,
    actor_user_id,
    actor_name_snapshot,
    actor_kind,
    supplier_order_id,
    supplier_order_item_id,
    idempotency_key,
    previous_quantity,
    quantity_delta,
    new_quantity,
    request_payload,
    result_payload
  )
  values (
    'READY_QUANTITY_INCREMENTED',
    p_actor_user_id,
    btrim(p_actor_name),
    'SAFISA',
    v_order.id,
    p_supplier_order_item_id,
    p_idempotency_key,
    v_previous_quantity,
    p_increment_quantity,
    v_new_quantity,
    v_request,
    v_result
  );

  return v_result;
end;
$$;

create function private.correct_safisa_ready_quantity(
  p_supplier_order_item_id uuid,
  p_new_ready_quantity integer,
  p_justification text,
  p_confirmed boolean,
  p_expected_updated_at timestamptz,
  p_idempotency_key uuid,
  p_actor_user_id uuid,
  p_actor_name text,
  p_actor_kind text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_justification text;
  v_request jsonb;
  v_existing_result jsonb;
  v_order public.supplier_orders%rowtype;
  v_line public.supplier_order_items%rowtype;
  v_previous_quantity integer;
  v_line_updated_at timestamptz;
  v_result jsonb;
begin
  v_justification := nullif(btrim(p_justification), '');

  if p_supplier_order_item_id is null
    or p_new_ready_quantity is null
    or p_new_ready_quantity < 0
    or v_justification is null
    or char_length(v_justification) > 500
    or p_confirmed is distinct from true
    or p_expected_updated_at is null
    or p_idempotency_key is null
    or p_actor_user_id is null
    or nullif(btrim(p_actor_name), '') is null
    or p_actor_kind not in ('INTERNAL', 'SAFISA') then
    raise exception using
      errcode = '22023',
      message = 'Line, nonnegative total, short justification, explicit confirmation, expected version, idempotency key, and actor are required.';
  end if;

  v_request := jsonb_build_object(
    'supplier_order_item_id', p_supplier_order_item_id,
    'new_ready_quantity', p_new_ready_quantity,
    'justification', v_justification,
    'confirmed', true,
    'expected_updated_at', p_expected_updated_at
  );

  v_existing_result := private.safisa_portal_existing_result(
    p_actor_user_id,
    p_idempotency_key,
    'READY_QUANTITY_CORRECTED',
    v_request
  );

  if v_existing_result is not null then
    return v_existing_result;
  end if;

  select supplier_order.*
  into v_order
  from public.supplier_order_items as order_item
  join public.supplier_orders as supplier_order
    on supplier_order.id = order_item.supplier_order_id
  where order_item.id = p_supplier_order_item_id
  for update of supplier_order;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'The supplier-order line does not exist.';
  end if;

  perform 1
  from public.safisa_order_authorizations as order_authorization
  where order_authorization.supplier_order_id = v_order.id
    and order_authorization.is_authorized
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'The supplier order is not authorized for the Safisa portal.';
  end if;

  if v_order.finalized_at is not null or v_order.cancelled_at is not null then
    raise exception using
      errcode = '22023',
      message = 'A closed supplier order cannot change ready quantities.';
  end if;

  select order_item.*
  into v_line
  from public.supplier_order_items as order_item
  where order_item.id = p_supplier_order_item_id
    and order_item.supplier_order_id = v_order.id
  for update;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'The supplier-order line does not exist.';
  end if;

  if v_line.updated_at is distinct from p_expected_updated_at then
    raise exception using
      errcode = '40001',
      message = 'safisa_ready_quantity_version_conflict';
  end if;

  if p_new_ready_quantity < v_line.picked_quantity then
    raise exception using
      errcode = '22023',
      message = 'ready_quantity cannot be lower than picked_quantity.';
  end if;

  if p_new_ready_quantity + v_line.cancelled_quantity
    > v_line.ordered_quantity then
    raise exception using
      errcode = '22023',
      message = 'The ready quantity cannot exceed the valid ordered quantity.';
  end if;

  v_previous_quantity := v_line.ready_quantity;

  update public.supplier_order_items
  set ready_quantity = p_new_ready_quantity
  where id = p_supplier_order_item_id;

  update public.supplier_orders
  set updated_at = now()
  where id = v_order.id;

  select order_item.updated_at
  into v_line_updated_at
  from public.supplier_order_items as order_item
  where order_item.id = p_supplier_order_item_id;

  v_result := jsonb_build_object(
    'supplier_order_id', v_order.id,
    'supplier_order_item_id', p_supplier_order_item_id,
    'negotiation_number', v_order.negotiation_number,
    'previous_ready_quantity', v_previous_quantity,
    'ready_quantity_delta',
      p_new_ready_quantity - v_previous_quantity,
    'new_ready_quantity', p_new_ready_quantity,
    'picked_quantity', v_line.picked_quantity,
    'ready_waiting_pickup_quantity',
      p_new_ready_quantity - v_line.picked_quantity,
    'line_updated_at', v_line_updated_at,
    'idempotent_replay', false
  );

  insert into public.safisa_portal_events (
    event_type,
    actor_user_id,
    actor_name_snapshot,
    actor_kind,
    supplier_order_id,
    supplier_order_item_id,
    idempotency_key,
    previous_quantity,
    quantity_delta,
    new_quantity,
    justification,
    request_payload,
    result_payload
  )
  values (
    'READY_QUANTITY_CORRECTED',
    p_actor_user_id,
    btrim(p_actor_name),
    p_actor_kind,
    v_order.id,
    p_supplier_order_item_id,
    p_idempotency_key,
    v_previous_quantity,
    p_new_ready_quantity - v_previous_quantity,
    p_new_ready_quantity,
    v_justification,
    v_request,
    v_result
  );

  return v_result;
end;
$$;

create function public.set_safisa_portal_member_status(
  p_user_id uuid,
  p_is_active boolean,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
begin
  select *
  into v_actor
  from private.require_supplier_order_user();

  return private.set_safisa_portal_member_status(
    p_user_id,
    p_is_active,
    p_idempotency_key,
    v_actor.user_id,
    v_actor.user_name
  );
end;
$$;

create function public.publish_supplier_order_to_safisa(
  p_supplier_order_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
begin
  select *
  into v_actor
  from private.require_supplier_order_user();

  return private.set_safisa_order_authorization(
    p_supplier_order_id,
    true,
    p_idempotency_key,
    v_actor.user_id,
    v_actor.user_name
  );
end;
$$;

create function public.revoke_supplier_order_from_safisa(
  p_supplier_order_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
begin
  select *
  into v_actor
  from private.require_supplier_order_user();

  return private.set_safisa_order_authorization(
    p_supplier_order_id,
    false,
    p_idempotency_key,
    v_actor.user_id,
    v_actor.user_name
  );
end;
$$;

create function public.increment_safisa_ready_quantity(
  p_supplier_order_item_id uuid,
  p_increment_quantity integer,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
begin
  select *
  into v_actor
  from private.require_active_safisa_member();

  return private.increment_safisa_ready_quantity(
    p_supplier_order_item_id,
    p_increment_quantity,
    p_idempotency_key,
    v_actor.user_id,
    v_actor.user_name
  );
end;
$$;

create function public.correct_safisa_ready_quantity(
  p_supplier_order_item_id uuid,
  p_new_ready_quantity integer,
  p_justification text,
  p_confirmed boolean,
  p_expected_updated_at timestamptz,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
begin
  select *
  into v_actor
  from private.require_safisa_ready_actor(true);

  return private.correct_safisa_ready_quantity(
    p_supplier_order_item_id,
    p_new_ready_quantity,
    p_justification,
    p_confirmed,
    p_expected_updated_at,
    p_idempotency_key,
    v_actor.user_id,
    v_actor.user_name,
    v_actor.actor_kind
  );
end;
$$;

create or replace view public.supplier_order_item_details
with (security_invoker = true)
as
select
  order_item.id,
  order_item.supplier_order_id,
  order_item.item_id,
  order_item.commercial_configuration_id,
  order_item.commercial_configuration_code_id,
  order_item.code_snapshot,
  order_item.description_snapshot,
  order_item.model_snapshot,
  order_item.item_type_snapshot,
  order_item.commercial_code_snapshot,
  order_item.ordered_quantity,
  order_item.picked_quantity,
  order_item.stocked_quantity,
  order_item.cancelled_quantity,
  order_item.ordered_quantity
    - order_item.picked_quantity
    - order_item.cancelled_quantity as waiting_pickup_quantity,
  order_item.picked_quantity
    - order_item.stocked_quantity as waiting_stock_quantity,
  order_item.position,
  order_item.notes,
  order_item.created_at,
  order_item.updated_at,
  order_item.ready_quantity,
  order_item.ordered_quantity
    - order_item.cancelled_quantity
    - order_item.ready_quantity as waiting_ready_quantity,
  order_item.ready_quantity
    - order_item.picked_quantity as ready_waiting_pickup_quantity,
  case
    when order_item.ready_quantity + order_item.cancelled_quantity
      = order_item.ordered_quantity then 'COMPLETELY_READY'
    when order_item.ready_quantity > 0 then 'PARTIALLY_READY'
    else 'NOT_READY'
  end as readiness_status
from public.supplier_order_items as order_item;

create or replace view public.supplier_order_summaries
with (security_invoker = true)
as
select
  supplier_order.id,
  supplier_order.negotiation_number,
  supplier_order.order_date,
  supplier_order.notes,
  supplier_order.created_by,
  supplier_order.created_by_name_snapshot,
  supplier_order.created_at,
  supplier_order.updated_at,
  supplier_order.cancelled_at,
  supplier_order.cancelled_by,
  supplier_order.cancelled_by_name_snapshot,
  supplier_order.cancellation_note,
  totals.line_count,
  totals.ordered_quantity,
  totals.picked_quantity,
  totals.cancelled_quantity,
  totals.waiting_pickup_quantity,
  totals.stocked_quantity,
  totals.waiting_stock_quantity,
  case
    when totals.ordered_quantity = 0 then 0::numeric
    else round(
      totals.picked_quantity::numeric
        * 100
        / totals.ordered_quantity::numeric,
      2
    )
  end as pickup_percentage,
  lifecycle.status,
  supplier_order.finalized_at,
  supplier_order.finalized_by,
  supplier_order.finalized_by_name_snapshot,
  supplier_order.finalization_note,
  supplier_order.finalized_at is not null as is_finalized,
  (
    supplier_order.finalized_at is null
    and lifecycle.status <> 'CANCELLED'
  ) as is_active_order,
  (
    supplier_order.finalized_at is not null
    or lifecycle.status = 'CANCELLED'
  ) as is_in_history,
  case
    when supplier_order.finalized_at is not null then 'FINALIZED'
    when lifecycle.status = 'CANCELLED' then 'CANCELLED'
    else null
  end as closure_kind,
  case
    when supplier_order.finalized_at is not null
      then supplier_order.finalized_at
    when lifecycle.status = 'CANCELLED'
      then supplier_order.cancelled_at
    else null
  end as closed_at,
  case
    when supplier_order.finalized_at is not null
      then supplier_order.finalized_by_name_snapshot
    when lifecycle.status = 'CANCELLED'
      then supplier_order.cancelled_by_name_snapshot
    else null
  end as closed_by_name_snapshot,
  totals.ready_quantity,
  totals.waiting_ready_quantity,
  totals.ready_waiting_pickup_quantity,
  case
    when totals.ready_quantity + totals.cancelled_quantity
      = totals.ordered_quantity then 'COMPLETELY_READY'
    when totals.ready_quantity > 0 then 'PARTIALLY_READY'
    else 'NOT_READY'
  end as readiness_status
from public.supplier_orders as supplier_order
cross join lateral (
  select
    count(*)::integer as line_count,
    coalesce(sum(order_item.ordered_quantity), 0)::bigint
      as ordered_quantity,
    coalesce(sum(order_item.picked_quantity), 0)::bigint
      as picked_quantity,
    coalesce(sum(order_item.cancelled_quantity), 0)::bigint
      as cancelled_quantity,
    coalesce(
      sum(
        order_item.ordered_quantity
          - order_item.picked_quantity
          - order_item.cancelled_quantity
      ),
      0
    )::bigint as waiting_pickup_quantity,
    coalesce(sum(order_item.stocked_quantity), 0)::bigint
      as stocked_quantity,
    coalesce(
      sum(order_item.picked_quantity - order_item.stocked_quantity),
      0
    )::bigint as waiting_stock_quantity,
    coalesce(sum(order_item.ready_quantity), 0)::bigint
      as ready_quantity,
    coalesce(
      sum(
        order_item.ordered_quantity
          - order_item.cancelled_quantity
          - order_item.ready_quantity
      ),
      0
    )::bigint as waiting_ready_quantity,
    coalesce(
      sum(order_item.ready_quantity - order_item.picked_quantity),
      0
    )::bigint as ready_waiting_pickup_quantity
  from public.supplier_order_items as order_item
  where order_item.supplier_order_id = supplier_order.id
) as totals
cross join lateral (
  select case
    when supplier_order.cancelled_at is not null then 'CANCELLED'
    when totals.waiting_pickup_quantity = 0
      and totals.cancelled_quantity > 0 then 'CANCELLED'
    when totals.waiting_pickup_quantity = 0
      and totals.picked_quantity > 0
      and totals.cancelled_quantity = 0 then 'COMPLETED'
    when totals.picked_quantity = 0
      and totals.cancelled_quantity = 0 then 'PENDING'
    else 'PARTIAL'
  end as status
) as lifecycle;

comment on view public.supplier_order_summaries is
  'One-row-per-order pickup, stock-entry, readiness, and active/history summary.';

create or replace function private.supplier_order_result(
  p_supplier_order_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'supplier_order_id', summary.id,
    'negotiation_number', summary.negotiation_number,
    'line_count', summary.line_count,
    'ordered_quantity', summary.ordered_quantity,
    'picked_quantity', summary.picked_quantity,
    'cancelled_quantity', summary.cancelled_quantity,
    'waiting_pickup_quantity', summary.waiting_pickup_quantity,
    'stocked_quantity', summary.stocked_quantity,
    'waiting_stock_quantity', summary.waiting_stock_quantity,
    'pickup_percentage', summary.pickup_percentage,
    'status', summary.status,
    'updated_at', summary.updated_at,
    'finalized_at', summary.finalized_at,
    'finalized_by', summary.finalized_by,
    'finalized_by_name_snapshot',
      summary.finalized_by_name_snapshot,
    'finalization_note', summary.finalization_note,
    'is_finalized', summary.is_finalized,
    'is_active_order', summary.is_active_order,
    'is_in_history', summary.is_in_history,
    'closure_kind', summary.closure_kind,
    'closed_at', summary.closed_at,
    'closed_by_name_snapshot', summary.closed_by_name_snapshot,
    'ready_quantity', summary.ready_quantity,
    'waiting_ready_quantity', summary.waiting_ready_quantity,
    'ready_waiting_pickup_quantity',
      summary.ready_waiting_pickup_quantity,
    'readiness_status', summary.readiness_status
  )
  from public.supplier_order_summaries as summary
  where summary.id = p_supplier_order_id;
$$;

create function public.list_safisa_authorized_orders(
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor record;
  v_orders jsonb;
  v_total integer;
begin
  select *
  into v_actor
  from private.require_active_safisa_member();

  if p_limit is null or p_limit not between 1 and 100
    or p_offset is null or p_offset < 0 then
    raise exception using
      errcode = '22023',
      message = 'p_limit must be between 1 and 100 and p_offset must be nonnegative.';
  end if;

  select count(*)::integer
  into v_total
  from public.safisa_order_authorizations as order_authorization
  where order_authorization.is_authorized;

  select coalesce(jsonb_agg(row_data.payload order by row_data.order_date desc, row_data.created_at desc), '[]'::jsonb)
  into v_orders
  from (
    select
      summary.order_date,
      summary.created_at,
      jsonb_build_object(
        'supplier_order_id', summary.id,
        'negotiation_number', summary.negotiation_number,
        'order_date', summary.order_date,
        'line_count', summary.line_count,
        'ordered_quantity', summary.ordered_quantity,
        'ready_quantity', summary.ready_quantity,
        'picked_quantity', summary.picked_quantity,
        'waiting_ready_quantity', summary.waiting_ready_quantity,
        'ready_waiting_pickup_quantity',
          summary.ready_waiting_pickup_quantity,
        'readiness_status', summary.readiness_status,
        'closure_kind', summary.closure_kind,
        'is_read_only', summary.is_in_history,
        'updated_at', summary.updated_at
      ) as payload
    from public.safisa_order_authorizations as order_authorization
    join public.supplier_order_summaries as summary
      on summary.id = order_authorization.supplier_order_id
    where order_authorization.is_authorized
    order by summary.order_date desc, summary.created_at desc, summary.id
    limit p_limit
    offset p_offset
  ) as row_data;

  return jsonb_build_object(
    'orders', v_orders,
    'total', v_total,
    'limit', p_limit,
    'offset', p_offset
  );
end;
$$;

create function public.get_safisa_authorized_order(
  p_supplier_order_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor record;
  v_summary public.supplier_order_summaries%rowtype;
  v_lines jsonb;
  v_events jsonb;
begin
  select *
  into v_actor
  from private.require_active_safisa_member();

  if p_supplier_order_id is null then
    raise exception using
      errcode = '22023',
      message = 'p_supplier_order_id is required.';
  end if;

  select summary.*
  into v_summary
  from public.safisa_order_authorizations as order_authorization
  join public.supplier_order_summaries as summary
    on summary.id = order_authorization.supplier_order_id
  where order_authorization.supplier_order_id = p_supplier_order_id
    and order_authorization.is_authorized;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'The supplier order is not authorized for the Safisa portal.';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'supplier_order_item_id', detail.id,
        'code', detail.code_snapshot,
        'description', detail.description_snapshot,
        'model', detail.model_snapshot,
        'item_type', detail.item_type_snapshot,
        'commercial_code', detail.commercial_code_snapshot,
        'ordered_quantity', detail.ordered_quantity,
        'ready_quantity', detail.ready_quantity,
        'picked_quantity', detail.picked_quantity,
        'waiting_ready_quantity', detail.waiting_ready_quantity,
        'ready_waiting_pickup_quantity',
          detail.ready_waiting_pickup_quantity,
        'readiness_status', detail.readiness_status,
        'position', detail.position,
        'updated_at', detail.updated_at
      )
      order by detail.position, detail.id
    ),
    '[]'::jsonb
  )
  into v_lines
  from public.supplier_order_item_details as detail
  where detail.supplier_order_id = p_supplier_order_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'event_type', event.event_type,
        'actor_name', event.actor_name_snapshot,
        'supplier_order_item_id', event.supplier_order_item_id,
        'previous_quantity', event.previous_quantity,
        'quantity_delta', event.quantity_delta,
        'new_quantity', event.new_quantity,
        'justification', event.justification,
        'created_at', event.created_at
      )
      order by event.created_at desc, event.id desc
    ),
    '[]'::jsonb
  )
  into v_events
  from (
    select portal_event.*
    from public.safisa_portal_events as portal_event
    where portal_event.supplier_order_id = p_supplier_order_id
      and portal_event.event_type in (
        'READY_QUANTITY_INCREMENTED',
        'READY_QUANTITY_CORRECTED'
      )
    order by portal_event.created_at desc, portal_event.id desc
    limit 100
  ) as event;

  return jsonb_build_object(
    'supplier_order_id', v_summary.id,
    'negotiation_number', v_summary.negotiation_number,
    'order_date', v_summary.order_date,
    'ordered_quantity', v_summary.ordered_quantity,
    'ready_quantity', v_summary.ready_quantity,
    'picked_quantity', v_summary.picked_quantity,
    'waiting_ready_quantity', v_summary.waiting_ready_quantity,
    'ready_waiting_pickup_quantity',
      v_summary.ready_waiting_pickup_quantity,
    'readiness_status', v_summary.readiness_status,
    'closure_kind', v_summary.closure_kind,
    'is_read_only', v_summary.is_in_history,
    'updated_at', v_summary.updated_at,
    'lines', v_lines,
    'events', v_events
  );
end;
$$;

create function public.list_safisa_ready_pickup_alerts(
  p_limit integer default 100
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor record;
  v_alerts jsonb;
  v_total integer;
begin
  select *
  into v_actor
  from private.require_supplier_order_user();

  if p_limit is null or p_limit not between 1 and 500 then
    raise exception using
      errcode = '22023',
      message = 'p_limit must be between 1 and 500.';
  end if;

  select count(*)::integer
  into v_total
  from public.safisa_order_authorizations as order_authorization
  join public.supplier_order_items as order_item
    on order_item.supplier_order_id = order_authorization.supplier_order_id
  where order_item.ready_quantity > order_item.picked_quantity;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'supplier_order_id', alert.supplier_order_id,
        'supplier_order_item_id', alert.supplier_order_item_id,
        'negotiation_number', alert.negotiation_number,
        'order_date', alert.order_date,
        'code', alert.code_snapshot,
        'description', alert.description_snapshot,
        'model', alert.model_snapshot,
        'item_type', alert.item_type_snapshot,
        'commercial_code', alert.commercial_code_snapshot,
        'ready_quantity', alert.ready_quantity,
        'picked_quantity', alert.picked_quantity,
        'ready_waiting_pickup_quantity',
          alert.ready_waiting_pickup_quantity,
        'readiness_status', alert.readiness_status,
        'is_authorized_for_safisa', alert.is_authorized,
        'updated_at', alert.updated_at
      )
      order by alert.order_date, alert.position, alert.supplier_order_item_id
    ),
    '[]'::jsonb
  )
  into v_alerts
  from (
    select
      supplier_order.id as supplier_order_id,
      order_item.id as supplier_order_item_id,
      supplier_order.negotiation_number,
      supplier_order.order_date,
      order_item.code_snapshot,
      order_item.description_snapshot,
      order_item.model_snapshot,
      order_item.item_type_snapshot,
      order_item.commercial_code_snapshot,
      order_item.ready_quantity,
      order_item.picked_quantity,
      order_item.ready_quantity - order_item.picked_quantity
        as ready_waiting_pickup_quantity,
      case
        when order_item.ready_quantity + order_item.cancelled_quantity
          = order_item.ordered_quantity then 'COMPLETELY_READY'
        else 'PARTIALLY_READY'
      end as readiness_status,
      order_item.updated_at,
      order_item.position,
      order_authorization.is_authorized
    from public.safisa_order_authorizations as order_authorization
    join public.supplier_orders as supplier_order
      on supplier_order.id = order_authorization.supplier_order_id
    join public.supplier_order_items as order_item
      on order_item.supplier_order_id = supplier_order.id
    where order_item.ready_quantity > order_item.picked_quantity
    order by supplier_order.order_date, order_item.position, order_item.id
    limit p_limit
  ) as alert;

  return jsonb_build_object(
    'alerts', v_alerts,
    'total', v_total,
    'limit', p_limit
  );
end;
$$;

create or replace function private.set_supplier_order_item_picked_quantity(
  p_supplier_order_item_id uuid,
  p_picked_quantity integer,
  p_description text,
  p_idempotency_key uuid,
  p_user_id uuid,
  p_user_name text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_description text;
  v_request jsonb;
  v_existing_result jsonb;
  v_result jsonb;
  v_order_id uuid;
  v_order_cancelled_at timestamptz;
  v_line public.supplier_order_items%rowtype;
  v_previous_quantity integer;
begin
  if p_supplier_order_item_id is null
    or p_picked_quantity is null
    or p_picked_quantity < 0
    or p_idempotency_key is null then
    raise exception using
      errcode = '22023',
      message = 'Line, nonnegative picked quantity, and idempotency key are required.';
  end if;

  v_description := nullif(btrim(p_description), '');

  if v_description is not null and char_length(v_description) > 2000 then
    raise exception using
      errcode = '22023',
      message = 'p_description must contain at most 2000 characters.';
  end if;

  v_request := jsonb_build_object(
    'supplier_order_item_id', p_supplier_order_item_id,
    'picked_quantity', p_picked_quantity,
    'description', v_description
  );

  v_existing_result := private.supplier_order_existing_result(
    p_user_id,
    p_idempotency_key,
    'PICKED_QUANTITY_CHANGED',
    v_request
  );

  if v_existing_result is not null then
    return v_existing_result;
  end if;

  select supplier_order_id
  into v_order_id
  from public.supplier_order_items
  where id = p_supplier_order_item_id;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'The supplier-order line does not exist.';
  end if;

  select cancelled_at
  into v_order_cancelled_at
  from public.supplier_orders
  where id = v_order_id
  for update;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'The supplier order does not exist.';
  end if;

  select *
  into v_line
  from public.supplier_order_items
  where id = p_supplier_order_item_id
    and supplier_order_id = v_order_id
  for update;

  if v_order_cancelled_at is not null then
    raise exception using
      errcode = '22023',
      message = 'A cancelled supplier order cannot change picked quantities.';
  end if;

  if p_picked_quantity < v_line.stocked_quantity then
    raise exception using
      errcode = '22023',
      message = 'picked_quantity cannot be lower than stocked_quantity.';
  end if;

  if p_picked_quantity > v_line.ready_quantity then
    raise exception using
      errcode = '22023',
      message = 'picked_quantity cannot exceed ready_quantity.';
  end if;

  if p_picked_quantity + v_line.cancelled_quantity
    > v_line.ordered_quantity then
    raise exception using
      errcode = '22023',
      message = 'picked plus cancelled quantity cannot exceed ordered quantity.';
  end if;

  v_previous_quantity := v_line.picked_quantity;

  update public.supplier_order_items
  set picked_quantity = p_picked_quantity
  where id = p_supplier_order_item_id;

  update public.supplier_orders
  set updated_at = now()
  where id = v_order_id;

  v_result := private.supplier_order_result(v_order_id)
    || jsonb_build_object(
      'supplier_order_item_id', p_supplier_order_item_id,
      'previous_picked_quantity', v_previous_quantity,
      'new_picked_quantity', p_picked_quantity,
      'picked_quantity_delta', p_picked_quantity - v_previous_quantity,
      'ready_quantity', v_line.ready_quantity,
      'ready_waiting_pickup_quantity',
        v_line.ready_quantity - p_picked_quantity
    );

  insert into public.supplier_order_events (
    supplier_order_id,
    supplier_order_item_id,
    event_type,
    user_id,
    user_name_snapshot,
    idempotency_key,
    previous_quantity,
    new_quantity,
    quantity_delta,
    description,
    details
  )
  values (
    v_order_id,
    p_supplier_order_item_id,
    'PICKED_QUANTITY_CHANGED',
    p_user_id,
    p_user_name,
    p_idempotency_key,
    v_previous_quantity,
    p_picked_quantity,
    p_picked_quantity - v_previous_quantity,
    v_description,
    jsonb_build_object(
      'request', v_request,
      'result', v_result
    )
  );

  return v_result;
end;
$$;

create or replace function private.mark_supplier_order_all_picked(
  p_supplier_order_id uuid,
  p_description text,
  p_idempotency_key uuid,
  p_user_id uuid,
  p_user_name text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_description text;
  v_request jsonb;
  v_existing_result jsonb;
  v_result jsonb;
  v_cancelled_at timestamptz;
  v_changes jsonb;
begin
  if p_supplier_order_id is null or p_idempotency_key is null then
    raise exception using
      errcode = '22023',
      message = 'Order and idempotency key are required.';
  end if;

  v_description := nullif(btrim(p_description), '');

  if v_description is not null and char_length(v_description) > 2000 then
    raise exception using
      errcode = '22023',
      message = 'p_description must contain at most 2000 characters.';
  end if;

  v_request := jsonb_build_object(
    'supplier_order_id', p_supplier_order_id,
    'description', v_description
  );

  v_existing_result := private.supplier_order_existing_result(
    p_user_id,
    p_idempotency_key,
    'ALL_ITEMS_MARKED_PICKED',
    v_request
  );

  if v_existing_result is not null then
    return v_existing_result;
  end if;

  select cancelled_at
  into v_cancelled_at
  from public.supplier_orders
  where id = p_supplier_order_id
  for update;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'The supplier order does not exist.';
  end if;

  if v_cancelled_at is not null then
    raise exception using
      errcode = '22023',
      message = 'A cancelled supplier order cannot change picked quantities.';
  end if;

  perform 1
  from public.supplier_order_items
  where supplier_order_id = p_supplier_order_id
  order by id
  for update;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'supplier_order_item_id', order_item.id,
        'previous_picked_quantity', order_item.picked_quantity,
        'new_picked_quantity', order_item.ready_quantity
      )
      order by order_item.id
    ),
    '[]'::jsonb
  )
  into v_changes
  from public.supplier_order_items as order_item
  where order_item.supplier_order_id = p_supplier_order_id
    and order_item.picked_quantity is distinct from order_item.ready_quantity;

  update public.supplier_order_items
  set picked_quantity = ready_quantity
  where supplier_order_id = p_supplier_order_id
    and picked_quantity is distinct from ready_quantity;

  update public.supplier_orders
  set updated_at = now()
  where id = p_supplier_order_id;

  v_result := private.supplier_order_result(p_supplier_order_id)
    || jsonb_build_object(
      'changed_line_count', jsonb_array_length(v_changes)
    );

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
    p_supplier_order_id,
    'ALL_ITEMS_MARKED_PICKED',
    p_user_id,
    p_user_name,
    p_idempotency_key,
    v_description,
    jsonb_build_object(
      'request', v_request,
      'result', v_result,
      'changes', v_changes,
      'ready_only', true
    )
  );

  return v_result;
end;
$$;

create or replace function private.mark_supplier_order_all_picked_checked(
  p_supplier_order_id uuid,
  p_description text,
  p_expected_order_updated_at timestamptz,
  p_idempotency_key uuid,
  p_user_id uuid,
  p_user_name text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_description text;
  v_request jsonb;
  v_existing_result jsonb;
  v_result jsonb;
  v_order public.supplier_orders%rowtype;
  v_added_picked_quantity bigint := 0;
begin
  if p_supplier_order_id is null
    or p_expected_order_updated_at is null
    or p_idempotency_key is null
    or p_user_id is null
    or nullif(btrim(p_user_name), '') is null then
    raise exception using
      errcode = '22023',
      message = 'Order, expected order version, idempotency key, and authenticated user are required.';
  end if;

  v_description := nullif(btrim(p_description), '');

  if v_description is not null and char_length(v_description) > 2000 then
    raise exception using
      errcode = '22023',
      message = 'p_description must contain at most 2000 characters.';
  end if;

  v_request := jsonb_build_object(
    'supplier_order_id', p_supplier_order_id,
    'description', v_description
  );

  v_existing_result := private.supplier_order_existing_result(
    p_user_id,
    p_idempotency_key,
    'ALL_ITEMS_MARKED_PICKED',
    v_request
  );

  if v_existing_result is not null then
    select coalesce(
      sum(
        (change.value ->> 'new_picked_quantity')::bigint
          - (change.value ->> 'previous_picked_quantity')::bigint
      ),
      0
    )
    into v_added_picked_quantity
    from public.supplier_order_events as event
    cross join lateral jsonb_array_elements(
      coalesce(event.details -> 'changes', '[]'::jsonb)
    ) as change(value)
    where event.user_id = p_user_id
      and event.idempotency_key = p_idempotency_key
      and event.event_type = 'ALL_ITEMS_MARKED_PICKED';

    return v_existing_result || jsonb_build_object(
      'added_picked_quantity', v_added_picked_quantity,
      'idempotent_replay', true
    );
  end if;

  select supplier_order.*
  into v_order
  from public.supplier_orders as supplier_order
  where supplier_order.id = p_supplier_order_id
  for update;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'The supplier order does not exist.';
  end if;

  perform 1
  from public.supplier_order_items as order_item
  where order_item.supplier_order_id = p_supplier_order_id
  order by order_item.id
  for update;

  if v_order.updated_at is distinct from p_expected_order_updated_at then
    raise exception using
      errcode = '40001',
      message = 'supplier_order_version_conflict';
  end if;

  select coalesce(
    sum(order_item.ready_quantity - order_item.picked_quantity),
    0
  )
  into v_added_picked_quantity
  from public.supplier_order_items as order_item
  where order_item.supplier_order_id = p_supplier_order_id;

  v_result := private.mark_supplier_order_all_picked(
    p_supplier_order_id,
    v_description,
    p_idempotency_key,
    p_user_id,
    btrim(p_user_name)
  );

  return v_result || jsonb_build_object(
    'added_picked_quantity', v_added_picked_quantity,
    'idempotent_replay', false
  );
end;
$$;

create function private.reject_safisa_portal_event_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'Safisa portal audit events are immutable.';
end;
$$;

create trigger safisa_portal_events_reject_mutation
before update or delete
on public.safisa_portal_events
for each row
execute function private.reject_safisa_portal_event_mutation();

alter table public.safisa_portal_members enable row level security;
alter table public.safisa_order_authorizations enable row level security;
alter table public.safisa_portal_events enable row level security;

revoke all on table public.safisa_portal_members
  from public, anon, authenticated;
revoke all on table public.safisa_order_authorizations
  from public, anon, authenticated;
revoke all on table public.safisa_portal_events
  from public, anon, authenticated;

revoke all on function private.prevent_internal_safisa_overlap()
  from public, anon, authenticated;
revoke all on function private.protect_supplier_order_item_readiness()
  from public, anon, authenticated;
revoke all on function private.validate_safisa_portal_event_target()
  from public, anon, authenticated;
revoke all on function private.require_active_safisa_member()
  from public, anon, authenticated;
revoke all on function private.require_safisa_ready_actor(boolean)
  from public, anon, authenticated;
revoke all on function private.safisa_portal_existing_result(
  uuid,
  uuid,
  text,
  jsonb
) from public, anon, authenticated;
revoke all on function private.set_safisa_portal_member_status(
  uuid,
  boolean,
  uuid,
  uuid,
  text
) from public, anon, authenticated;
revoke all on function private.set_safisa_order_authorization(
  uuid,
  boolean,
  uuid,
  uuid,
  text
) from public, anon, authenticated;
revoke all on function private.increment_safisa_ready_quantity(
  uuid,
  integer,
  uuid,
  uuid,
  text
) from public, anon, authenticated;
revoke all on function private.correct_safisa_ready_quantity(
  uuid,
  integer,
  text,
  boolean,
  timestamptz,
  uuid,
  uuid,
  text,
  text
) from public, anon, authenticated;
revoke all on function private.reject_safisa_portal_event_mutation()
  from public, anon, authenticated;

revoke all on function public.set_safisa_portal_member_status(
  uuid,
  boolean,
  uuid
) from public, anon, authenticated;
revoke all on function public.publish_supplier_order_to_safisa(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.revoke_supplier_order_from_safisa(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.increment_safisa_ready_quantity(
  uuid,
  integer,
  uuid
) from public, anon, authenticated;
revoke all on function public.correct_safisa_ready_quantity(
  uuid,
  integer,
  text,
  boolean,
  timestamptz,
  uuid
) from public, anon, authenticated;
revoke all on function public.list_safisa_authorized_orders(integer, integer)
  from public, anon, authenticated;
revoke all on function public.get_safisa_authorized_order(uuid)
  from public, anon, authenticated;
revoke all on function public.list_safisa_ready_pickup_alerts(integer)
  from public, anon, authenticated;

grant execute on function public.set_safisa_portal_member_status(
  uuid,
  boolean,
  uuid
) to authenticated;
grant execute on function public.publish_supplier_order_to_safisa(uuid, uuid)
  to authenticated;
grant execute on function public.revoke_supplier_order_from_safisa(uuid, uuid)
  to authenticated;
grant execute on function public.increment_safisa_ready_quantity(
  uuid,
  integer,
  uuid
) to authenticated;
grant execute on function public.correct_safisa_ready_quantity(
  uuid,
  integer,
  text,
  boolean,
  timestamptz,
  uuid
) to authenticated;
grant execute on function public.list_safisa_authorized_orders(integer, integer)
  to authenticated;
grant execute on function public.get_safisa_authorized_order(uuid)
  to authenticated;
grant execute on function public.list_safisa_ready_pickup_alerts(integer)
  to authenticated;

comment on function public.set_safisa_portal_member_status(
  uuid,
  boolean,
  uuid
) is 'Internal-only wrapper that provisions, activates, or deactivates one Safisa portal membership with audit and idempotency.';

comment on function public.publish_supplier_order_to_safisa(uuid, uuid) is
  'Internal-only wrapper that explicitly publishes one supplier order to the Safisa portal.';

comment on function public.revoke_supplier_order_from_safisa(uuid, uuid) is
  'Internal-only wrapper that revokes one supplier order from the Safisa portal without deleting audit history.';

comment on function public.increment_safisa_ready_quantity(
  uuid,
  integer,
  uuid
) is 'Safisa-only atomic and idempotent increment of ready quantity for one authorized open order line.';

comment on function public.correct_safisa_ready_quantity(
  uuid,
  integer,
  text,
  boolean,
  timestamptz,
  uuid
) is 'Safisa-or-internal absolute correction of ready quantity with justification, optimistic concurrency, audit, and idempotency.';

comment on function public.list_safisa_authorized_orders(integer, integer) is
  'Safisa-only bounded read of explicitly authorized supplier orders.';

comment on function public.get_safisa_authorized_order(uuid) is
  'Safisa-only detail read of one explicitly authorized supplier order and its readiness audit.';

comment on function public.list_safisa_ready_pickup_alerts(integer) is
  'Internal-only bounded alert read for ready units that have not yet been picked.';

comment on function private.set_supplier_order_item_picked_quantity(
  uuid,
  integer,
  text,
  uuid,
  uuid,
  text
) is 'Private canonical pickup worker hardened so picked quantity can never exceed Safisa ready quantity.';

comment on function private.mark_supplier_order_all_picked(
  uuid,
  text,
  uuid,
  uuid,
  text
) is 'Private canonical bulk pickup worker hardened to pick only units currently marked ready.';

comment on function private.mark_supplier_order_all_picked_checked(
  uuid,
  text,
  timestamptz,
  uuid,
  uuid,
  text
) is 'Private optimistic-concurrency bulk pickup worker hardened to pick only units currently marked ready.';
