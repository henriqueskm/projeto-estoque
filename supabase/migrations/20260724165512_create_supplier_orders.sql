create table public.supplier_orders (
  id uuid primary key default gen_random_uuid(),
  negotiation_number text not null,
  order_date date not null,
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  created_by_name_snapshot text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id) on delete set null,
  cancelled_by_name_snapshot text,
  cancellation_note text,
  constraint supplier_orders_negotiation_number_check check (
    negotiation_number = btrim(negotiation_number)
    and char_length(negotiation_number) between 1 and 120
  ),
  constraint supplier_orders_notes_check check (
    notes is null
    or (notes = btrim(notes) and char_length(notes) between 1 and 2000)
  ),
  constraint supplier_orders_creator_snapshot_check check (
    btrim(created_by_name_snapshot) <> ''
  ),
  constraint supplier_orders_cancellation_note_check check (
    cancellation_note is null
    or (
      cancellation_note = btrim(cancellation_note)
      and char_length(cancellation_note) between 1 and 2000
    )
  ),
  constraint supplier_orders_cancellation_metadata_check check (
    (
      cancelled_at is null
      and cancelled_by is null
      and cancelled_by_name_snapshot is null
      and cancellation_note is null
    )
    or
    (
      cancelled_at is not null
      and cancelled_by_name_snapshot is not null
      and btrim(cancelled_by_name_snapshot) <> ''
    )
  )
);

comment on table public.supplier_orders is
  'Supplier negotiations. Picking records collection from the supplier and never changes inventory.';

create table public.supplier_order_items (
  id uuid primary key default gen_random_uuid(),
  supplier_order_id uuid not null
    references public.supplier_orders (id) on delete restrict,
  item_id uuid references public.items (id) on delete restrict,
  commercial_configuration_id uuid
    references public.commercial_configurations (id) on delete restrict,
  commercial_configuration_code_id uuid
    references public.commercial_configuration_codes (id) on delete restrict,
  code_snapshot text not null,
  description_snapshot text not null,
  model_snapshot text,
  item_type_snapshot text not null,
  commercial_code_snapshot text,
  ordered_quantity integer not null,
  picked_quantity integer not null default 0,
  stocked_quantity integer not null default 0,
  cancelled_quantity integer not null default 0,
  position integer not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supplier_order_items_target_check check (
    (item_id is not null)::integer
      + (commercial_configuration_id is not null)::integer = 1
  ),
  constraint supplier_order_items_commercial_code_target_check check (
    (
      item_id is not null
      and commercial_configuration_code_id is null
      and commercial_code_snapshot is null
    )
    or
    (
      commercial_configuration_id is not null
      and (
        (
          commercial_configuration_code_id is null
          and commercial_code_snapshot is null
        )
        or
        (
          commercial_configuration_code_id is not null
          and commercial_code_snapshot is not null
          and btrim(commercial_code_snapshot) <> ''
        )
      )
    )
  ),
  constraint supplier_order_items_snapshots_check check (
    btrim(code_snapshot) <> ''
    and btrim(description_snapshot) <> ''
    and (model_snapshot is null or btrim(model_snapshot) <> '')
    and item_type_snapshot in (
      'SERVO',
      'INSTALLATION_KIT',
      'REPAIR_KIT',
      'LOOSE_PART',
      'COMMERCIAL_CONFIGURATION'
    )
  ),
  constraint supplier_order_items_ordered_quantity_check check (
    ordered_quantity > 0
  ),
  constraint supplier_order_items_quantities_nonnegative_check check (
    picked_quantity >= 0
    and stocked_quantity >= 0
    and cancelled_quantity >= 0
  ),
  constraint supplier_order_items_stocked_not_above_picked_check check (
    stocked_quantity <= picked_quantity
  ),
  constraint supplier_order_items_closed_quantity_check check (
    picked_quantity + cancelled_quantity <= ordered_quantity
  ),
  constraint supplier_order_items_position_check check (position >= 0),
  constraint supplier_order_items_notes_check check (
    notes is null
    or (notes = btrim(notes) and char_length(notes) between 1 and 1000)
  ),
  constraint supplier_order_items_order_position_key unique (
    supplier_order_id,
    position
  )
);

comment on column public.supplier_order_items.stocked_quantity is
  'Reserved for a future, separate stock-entry operation. Supplier-order RPCs never change it.';

create table public.supplier_order_events (
  id uuid primary key default gen_random_uuid(),
  supplier_order_id uuid not null
    references public.supplier_orders (id) on delete restrict,
  supplier_order_item_id uuid
    references public.supplier_order_items (id) on delete restrict,
  event_type text not null,
  user_id uuid references public.profiles (id) on delete set null,
  user_name_snapshot text not null,
  idempotency_key uuid not null,
  previous_quantity integer,
  new_quantity integer,
  quantity_delta integer,
  description text,
  details jsonb,
  created_at timestamptz not null default now(),
  constraint supplier_order_events_type_check check (
    event_type in (
      'ORDER_CREATED',
      'ORDER_HEADER_UPDATED',
      'ORDER_ITEMS_UPDATED',
      'PICKED_QUANTITY_CHANGED',
      'ALL_ITEMS_MARKED_PICKED',
      'ORDER_CANCELLED',
      'REMAINING_QUANTITY_CANCELLED',
      'STOCK_ENTRY_CREATED'
    )
  ),
  constraint supplier_order_events_user_snapshot_check check (
    btrim(user_name_snapshot) <> ''
  ),
  constraint supplier_order_events_quantities_check check (
    (
      previous_quantity is null
      and new_quantity is null
      and quantity_delta is null
    )
    or
    (
      previous_quantity is not null
      and new_quantity is not null
      and quantity_delta is not null
      and previous_quantity >= 0
      and new_quantity >= 0
      and quantity_delta = new_quantity - previous_quantity
    )
  ),
  constraint supplier_order_events_description_check check (
    description is null
    or (
      description = btrim(description)
      and char_length(description) between 1 and 2000
    )
  ),
  constraint supplier_order_events_details_check check (
    details is null or jsonb_typeof(details) = 'object'
  ),
  constraint supplier_order_events_item_event_check check (
    (
      event_type = 'PICKED_QUANTITY_CHANGED'
      and supplier_order_item_id is not null
      and previous_quantity is not null
    )
    or
    (
      event_type <> 'PICKED_QUANTITY_CHANGED'
      and supplier_order_item_id is null
      and previous_quantity is null
    )
  )
);

comment on table public.supplier_order_events is
  'Immutable audit trail and per-user idempotency ledger for supplier-order operations.';

create index supplier_orders_negotiation_number_idx
  on public.supplier_orders (negotiation_number);

create index supplier_orders_order_date_idx
  on public.supplier_orders (order_date);

create index supplier_orders_created_at_idx
  on public.supplier_orders (created_at desc);

create index supplier_orders_cancelled_at_idx
  on public.supplier_orders (cancelled_at)
  where cancelled_at is not null;

create index supplier_order_items_order_id_idx
  on public.supplier_order_items (supplier_order_id);

create index supplier_order_items_item_id_idx
  on public.supplier_order_items (item_id)
  where item_id is not null;

create index supplier_order_items_configuration_id_idx
  on public.supplier_order_items (commercial_configuration_id)
  where commercial_configuration_id is not null;

create index supplier_order_items_commercial_code_id_idx
  on public.supplier_order_items (commercial_configuration_code_id)
  where commercial_configuration_code_id is not null;

create unique index supplier_order_events_user_id_idempotency_key_uidx
  on public.supplier_order_events (user_id, idempotency_key)
  where user_id is not null;

create index supplier_order_events_order_created_at_idx
  on public.supplier_order_events (supplier_order_id, created_at, id);

create index supplier_order_events_item_id_idx
  on public.supplier_order_events (supplier_order_item_id)
  where supplier_order_item_id is not null;

create function private.supplier_order_catalog_snapshot(
  p_item_id uuid,
  p_configuration_id uuid,
  p_commercial_code_id uuid,
  p_require_active boolean default true
)
returns table (
  code_snapshot text,
  description_snapshot text,
  model_snapshot text,
  item_type_snapshot text,
  commercial_code_snapshot text
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  if (p_item_id is not null)::integer
    + (p_configuration_id is not null)::integer <> 1 then
    raise exception using
      errcode = '22023',
      message = 'Exactly one catalog target is required.';
  end if;

  if p_item_id is not null then
    if p_commercial_code_id is not null then
      raise exception using
        errcode = '22023',
        message = 'A physical item cannot use a commercial code.';
    end if;

    return query
    select
      item.code,
      item.description,
      nullif(btrim(servo.model), ''),
      item.item_type,
      null::text
    from public.items as item
    left join public.servo_models as servo
      on servo.item_id = item.id
    where item.id = p_item_id
      and (
        not p_require_active
        or item.is_active
      )
      and (
        (item.item_type = 'SERVO' and exists (
          select 1
          from public.servo_models
          where item_id = item.id
        ))
        or
        (item.item_type = 'INSTALLATION_KIT' and exists (
          select 1
          from public.installation_kits
          where item_id = item.id
        ))
        or
        (item.item_type = 'REPAIR_KIT' and exists (
          select 1
          from public.repair_kits
          where item_id = item.id
        ))
        or
        (item.item_type = 'LOOSE_PART' and exists (
          select 1
          from public.loose_parts
          where item_id = item.id
        ))
      )
    for share of item;

    if not found then
      raise exception using
        errcode = '22023',
        message = 'The physical item does not exist or is inactive.';
    end if;

    return;
  end if;

  if p_commercial_code_id is not null then
    perform 1
    from public.commercial_configuration_codes as selected_code
    where selected_code.id = p_commercial_code_id
      and selected_code.configuration_id = p_configuration_id
      and (
        not p_require_active
        or selected_code.is_active
      )
    for share;

    if not found then
      raise exception using
        errcode = '22023',
        message = 'The selected commercial code does not belong to the configuration or is inactive.';
    end if;
  end if;

  return query
  select
    coalesce(commercial_code.code, servo_item.code || ' + ' || kit_item.code),
    coalesce(
      nullif(btrim(configuration.description), ''),
      servo_item.description || ' + ' || kit_item.description
    ),
    nullif(btrim(servo.model), ''),
    'COMMERCIAL_CONFIGURATION'::text,
    commercial_code.code
  from public.commercial_configurations as configuration
  join public.items as servo_item
    on servo_item.id = configuration.servo_id
  join public.servo_models as servo
    on servo.item_id = configuration.servo_id
  join public.items as kit_item
    on kit_item.id = configuration.installation_kit_id
  left join public.commercial_configuration_codes as commercial_code
    on commercial_code.id = p_commercial_code_id
   and commercial_code.configuration_id = configuration.id
   and (
     not p_require_active
     or commercial_code.is_active
   )
  where configuration.id = p_configuration_id
    and (
      not p_require_active
      or (
        configuration.is_active
        and servo_item.is_active
        and kit_item.is_active
      )
    )
    and (
      p_commercial_code_id is null
      or commercial_code.id is not null
    )
  for share of configuration, servo_item, kit_item;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'The commercial configuration or selected commercial code does not exist, is inactive, or is inconsistent.';
  end if;
end;
$$;

create function private.set_supplier_order_item_snapshots()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_snapshot record;
begin
  select *
  into v_snapshot
  from private.supplier_order_catalog_snapshot(
    new.item_id,
    new.commercial_configuration_id,
    new.commercial_configuration_code_id,
    true
  );

  new.code_snapshot := v_snapshot.code_snapshot;
  new.description_snapshot := v_snapshot.description_snapshot;
  new.model_snapshot := v_snapshot.model_snapshot;
  new.item_type_snapshot := v_snapshot.item_type_snapshot;
  new.commercial_code_snapshot := v_snapshot.commercial_code_snapshot;
  new.updated_at := now();

  return new;
end;
$$;

create trigger supplier_order_items_set_snapshots_on_insert
before insert on public.supplier_order_items
for each row
execute function private.set_supplier_order_item_snapshots();

create trigger supplier_order_items_set_snapshots_on_target_update
before update of
  item_id,
  commercial_configuration_id,
  commercial_configuration_code_id
on public.supplier_order_items
for each row
when (
  old.item_id is distinct from new.item_id
  or old.commercial_configuration_id
    is distinct from new.commercial_configuration_id
  or old.commercial_configuration_code_id
    is distinct from new.commercial_configuration_code_id
)
execute function private.set_supplier_order_item_snapshots();

create function private.touch_supplier_order_timestamp()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger supplier_orders_touch_updated_at
before update on public.supplier_orders
for each row
execute function private.touch_supplier_order_timestamp();

create trigger supplier_order_items_touch_updated_at
before update on public.supplier_order_items
for each row
execute function private.touch_supplier_order_timestamp();

create function private.validate_supplier_order_event_item()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.supplier_order_item_id is not null
    and not exists (
      select 1
      from public.supplier_order_items as order_item
      where order_item.id = new.supplier_order_item_id
        and order_item.supplier_order_id = new.supplier_order_id
    ) then
    raise exception using
      errcode = '23514',
      message = 'The supplier-order event item does not belong to its order.';
  end if;

  return new;
end;
$$;

create trigger supplier_order_events_validate_item
before insert or update of supplier_order_id, supplier_order_item_id
on public.supplier_order_events
for each row
execute function private.validate_supplier_order_event_item();

create function private.protect_supplier_order_commercial_code_links()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.supplier_order_items as order_item
    where order_item.commercial_configuration_code_id = new.id
      and order_item.commercial_configuration_id <> new.configuration_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'A commercial code used by a supplier order cannot be moved to another physical configuration.';
  end if;

  return new;
end;
$$;

create trigger commercial_configuration_codes_protect_supplier_order_links
before update of configuration_id
on public.commercial_configuration_codes
for each row
when (old.configuration_id is distinct from new.configuration_id)
execute function private.protect_supplier_order_commercial_code_links();

create function private.normalize_supplier_order_lines(
  p_lines jsonb,
  p_allow_existing_ids boolean
)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_line jsonb;
  v_normalized jsonb := '[]'::jsonb;
  v_position integer;
  v_kind text;
  v_line_id uuid;
  v_item_id uuid;
  v_configuration_id uuid;
  v_commercial_code_id uuid;
  v_quantity_numeric numeric;
  v_quantity integer;
  v_notes text;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'p_lines must be a JSON array.';
  end if;

  if jsonb_array_length(p_lines) = 0
    or jsonb_array_length(p_lines) > 1000 then
    raise exception using
      errcode = '22023',
      message = 'p_lines must contain between 1 and 1000 lines.';
  end if;

  for v_line, v_position in
    select value, (ordinality - 1)::integer
    from jsonb_array_elements(p_lines) with ordinality
  loop
    if jsonb_typeof(v_line) <> 'object' then
      raise exception using
        errcode = '22023',
        message = format('Line %s must be a JSON object.', v_position + 1);
    end if;

    if exists (
      select 1
      from jsonb_object_keys(v_line) as key_name
      where key_name not in (
        'id',
        'kind',
        'item_id',
        'commercial_configuration_id',
        'commercial_configuration_code_id',
        'quantity',
        'notes'
      )
    ) then
      raise exception using
        errcode = '22023',
        message = format('Line %s contains an unexpected field.', v_position + 1);
    end if;

    if not p_allow_existing_ids and v_line ? 'id' then
      raise exception using
        errcode = '22023',
        message = 'Line IDs cannot be supplied while creating an order.';
    end if;

    begin
      v_line_id := nullif(v_line ->> 'id', '')::uuid;
      v_item_id := nullif(v_line ->> 'item_id', '')::uuid;
      v_configuration_id :=
        nullif(v_line ->> 'commercial_configuration_id', '')::uuid;
      v_commercial_code_id :=
        nullif(v_line ->> 'commercial_configuration_code_id', '')::uuid;
    exception
      when invalid_text_representation then
        raise exception using
          errcode = '22023',
          message = format('Line %s contains an invalid UUID.', v_position + 1);
    end;

    if v_line_id is not null and exists (
      select 1
      from jsonb_array_elements(v_normalized) as previous_line
      where (previous_line ->> 'id')::uuid = v_line_id
    ) then
      raise exception using
        errcode = '22023',
        message = 'The same existing order line cannot appear twice.';
    end if;

    v_kind := v_line ->> 'kind';

    if v_kind = 'ITEM' then
      if v_item_id is null
        or v_configuration_id is not null
        or v_commercial_code_id is not null then
        raise exception using
          errcode = '22023',
          message = format('Line %s has an invalid ITEM target.', v_position + 1);
      end if;
    elsif v_kind = 'COMMERCIAL_CONFIGURATION' then
      if v_item_id is not null or v_configuration_id is null then
        raise exception using
          errcode = '22023',
          message = format(
            'Line %s has an invalid COMMERCIAL_CONFIGURATION target.',
            v_position + 1
          );
      end if;
    else
      raise exception using
        errcode = '22023',
        message = format('Line %s has an invalid kind.', v_position + 1);
    end if;

    if jsonb_typeof(v_line -> 'quantity') is distinct from 'number' then
      raise exception using
        errcode = '22023',
        message = format('Line %s quantity must be an integer.', v_position + 1);
    end if;

    if v_line ? 'notes'
      and jsonb_typeof(v_line -> 'notes') not in ('string', 'null') then
      raise exception using
        errcode = '22023',
        message = format('Line %s notes must be text or null.', v_position + 1);
    end if;

    begin
      v_quantity_numeric := (v_line ->> 'quantity')::numeric;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        raise exception using
          errcode = '22023',
          message = format('Line %s quantity is invalid.', v_position + 1);
    end;

    if v_quantity_numeric <> trunc(v_quantity_numeric)
      or v_quantity_numeric < 1
      or v_quantity_numeric > 2147483647 then
      raise exception using
        errcode = '22023',
        message = format(
          'Line %s quantity must be a positive 32-bit integer.',
          v_position + 1
        );
    end if;

    v_quantity := v_quantity_numeric::integer;
    v_notes := nullif(btrim(v_line ->> 'notes'), '');

    if v_notes is not null and char_length(v_notes) > 1000 then
      raise exception using
        errcode = '22023',
        message = format(
          'Line %s notes must contain at most 1000 characters.',
          v_position + 1
        );
    end if;

    v_normalized := v_normalized || jsonb_build_array(
      jsonb_build_object(
        'id', v_line_id,
        'kind', v_kind,
        'item_id', v_item_id,
        'commercial_configuration_id', v_configuration_id,
        'commercial_configuration_code_id', v_commercial_code_id,
        'quantity', v_quantity,
        'notes', v_notes,
        'position', v_position
      )
    );
  end loop;

  return v_normalized;
end;
$$;

create view public.supplier_order_item_details
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
  order_item.updated_at
from public.supplier_order_items as order_item;

create view public.supplier_order_summaries
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
  case
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
    )::bigint as waiting_stock_quantity
  from public.supplier_order_items as order_item
  where order_item.supplier_order_id = supplier_order.id
) as totals;

comment on view public.supplier_order_summaries is
  'One-row-per-order totals and pickup status. Cancellation is never counted as pickup progress.';

create function private.supplier_order_result(p_supplier_order_id uuid)
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
    'updated_at', summary.updated_at
  )
  from public.supplier_order_summaries as summary
  where summary.id = p_supplier_order_id;
$$;

create function private.supplier_order_existing_result(
  p_user_id uuid,
  p_idempotency_key uuid,
  p_event_type text,
  p_request jsonb
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
  if p_user_id is null or p_idempotency_key is null then
    raise exception using
      errcode = '22023',
      message = 'User and idempotency key are required.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_user_id::text || ':' || p_idempotency_key::text,
      0
    )
  );

  select
    event.event_type,
    event.details -> 'request',
    event.details -> 'result'
  into
    v_event_type,
    v_existing_request,
    v_existing_result
  from public.supplier_order_events as event
  where event.user_id = p_user_id
    and event.idempotency_key = p_idempotency_key;

  if not found then
    return null;
  end if;

  if (
      (
        p_event_type = 'ORDER_UPDATED'
        and v_event_type not in (
          'ORDER_HEADER_UPDATED',
          'ORDER_ITEMS_UPDATED'
        )
      )
      or (
        p_event_type <> 'ORDER_UPDATED'
        and v_event_type is distinct from p_event_type
      )
    )
    or v_existing_request is distinct from p_request
    or v_existing_result is null then
    raise exception using
      errcode = '22023',
      message = 'p_idempotency_key has already been used with a different supplier-order request.';
  end if;

  return v_existing_result;
end;
$$;

create function private.create_supplier_order(
  p_negotiation_number text,
  p_order_date date,
  p_notes text,
  p_lines jsonb,
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
  v_negotiation_number text;
  v_notes text;
  v_lines jsonb;
  v_request jsonb;
  v_existing_result jsonb;
  v_result jsonb;
  v_order_id uuid;
  v_line jsonb;
begin
  v_negotiation_number := btrim(p_negotiation_number);
  v_notes := nullif(btrim(p_notes), '');

  if v_negotiation_number is null
    or char_length(v_negotiation_number) not between 1 and 120 then
    raise exception using
      errcode = '22023',
      message = 'p_negotiation_number must contain between 1 and 120 characters.';
  end if;

  if p_order_date is null then
    raise exception using
      errcode = '22023',
      message = 'p_order_date is required.';
  end if;

  if v_notes is not null and char_length(v_notes) > 2000 then
    raise exception using
      errcode = '22023',
      message = 'p_notes must contain at most 2000 characters.';
  end if;

  if p_idempotency_key is null then
    raise exception using
      errcode = '22023',
      message = 'p_idempotency_key is required.';
  end if;

  v_lines := private.normalize_supplier_order_lines(p_lines, false);
  v_request := jsonb_build_object(
    'negotiation_number', v_negotiation_number,
    'order_date', p_order_date,
    'notes', v_notes,
    'lines', v_lines
  );

  v_existing_result := private.supplier_order_existing_result(
    p_user_id,
    p_idempotency_key,
    'ORDER_CREATED',
    v_request
  );

  if v_existing_result is not null then
    return v_existing_result;
  end if;

  -- Validate the complete catalog payload before the first write.
  for v_line in
    select value
    from jsonb_array_elements(v_lines)
    order by coalesce(
      value ->> 'item_id',
      value ->> 'commercial_configuration_id'
    ),
    value ->> 'commercial_configuration_code_id'
  loop
    perform *
    from private.supplier_order_catalog_snapshot(
      nullif(v_line ->> 'item_id', '')::uuid,
      nullif(v_line ->> 'commercial_configuration_id', '')::uuid,
      nullif(v_line ->> 'commercial_configuration_code_id', '')::uuid,
      true
    );
  end loop;

  insert into public.supplier_orders (
    negotiation_number,
    order_date,
    notes,
    created_by,
    created_by_name_snapshot
  )
  values (
    v_negotiation_number,
    p_order_date,
    v_notes,
    p_user_id,
    p_user_name
  )
  returning id into v_order_id;

  for v_line in
    select value
    from jsonb_array_elements(v_lines)
    order by (value ->> 'position')::integer
  loop
    insert into public.supplier_order_items (
      supplier_order_id,
      item_id,
      commercial_configuration_id,
      commercial_configuration_code_id,
      code_snapshot,
      description_snapshot,
      item_type_snapshot,
      ordered_quantity,
      position,
      notes
    )
    values (
      v_order_id,
      nullif(v_line ->> 'item_id', '')::uuid,
      nullif(v_line ->> 'commercial_configuration_id', '')::uuid,
      nullif(v_line ->> 'commercial_configuration_code_id', '')::uuid,
      'SERVER_PENDING',
      'SERVER_PENDING',
      'LOOSE_PART',
      (v_line ->> 'quantity')::integer,
      (v_line ->> 'position')::integer,
      nullif(v_line ->> 'notes', '')
    );
  end loop;

  v_result := private.supplier_order_result(v_order_id);

  insert into public.supplier_order_events (
    supplier_order_id,
    event_type,
    user_id,
    user_name_snapshot,
    idempotency_key,
    details
  )
  values (
    v_order_id,
    'ORDER_CREATED',
    p_user_id,
    p_user_name,
    p_idempotency_key,
    jsonb_build_object(
      'request', v_request,
      'result', v_result
    )
  );

  return v_result;
end;
$$;

create function private.update_supplier_order(
  p_supplier_order_id uuid,
  p_expected_updated_at timestamptz,
  p_negotiation_number text,
  p_order_date date,
  p_notes text,
  p_lines jsonb,
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
  v_negotiation_number text;
  v_notes text;
  v_lines jsonb;
  v_request jsonb;
  v_existing_result jsonb;
  v_result jsonb;
  v_order public.supplier_orders%rowtype;
  v_existing_line public.supplier_order_items%rowtype;
  v_line jsonb;
  v_line_id uuid;
  v_item_id uuid;
  v_configuration_id uuid;
  v_commercial_code_id uuid;
  v_quantity integer;
  v_position integer;
  v_line_notes text;
  v_identity_changed boolean;
  v_items_changed boolean := false;
  v_header_changed boolean := false;
  v_event_type text;
  v_before jsonb;
  v_after jsonb;
begin
  if p_supplier_order_id is null
    or p_expected_updated_at is null
    or p_idempotency_key is null then
    raise exception using
      errcode = '22023',
      message = 'Order, expected updated_at, and idempotency key are required.';
  end if;

  v_negotiation_number := btrim(p_negotiation_number);
  v_notes := nullif(btrim(p_notes), '');

  if v_negotiation_number is null
    or char_length(v_negotiation_number) not between 1 and 120 then
    raise exception using
      errcode = '22023',
      message = 'p_negotiation_number must contain between 1 and 120 characters.';
  end if;

  if p_order_date is null then
    raise exception using
      errcode = '22023',
      message = 'p_order_date is required.';
  end if;

  if v_notes is not null and char_length(v_notes) > 2000 then
    raise exception using
      errcode = '22023',
      message = 'p_notes must contain at most 2000 characters.';
  end if;

  v_lines := private.normalize_supplier_order_lines(p_lines, true);
  v_request := jsonb_build_object(
    'supplier_order_id', p_supplier_order_id,
    'expected_updated_at', p_expected_updated_at,
    'negotiation_number', v_negotiation_number,
    'order_date', p_order_date,
    'notes', v_notes,
    'lines', v_lines
  );

  v_existing_result := private.supplier_order_existing_result(
    p_user_id,
    p_idempotency_key,
    'ORDER_UPDATED',
    v_request
  );

  if v_existing_result is not null then
    return v_existing_result;
  end if;

  select *
  into v_order
  from public.supplier_orders
  where id = p_supplier_order_id
  for update;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'The supplier order does not exist.';
  end if;

  if v_order.cancelled_at is not null then
    raise exception using
      errcode = '22023',
      message = 'A cancelled supplier order cannot be edited.';
  end if;

  if v_order.updated_at is distinct from p_expected_updated_at then
    raise exception using
      errcode = '40001',
      message = 'The supplier order changed after it was loaded. Reload it before saving.';
  end if;

  perform 1
  from public.supplier_order_items
  where supplier_order_id = p_supplier_order_id
  order by id
  for update;

  select jsonb_build_object(
    'negotiation_number', v_order.negotiation_number,
    'order_date', v_order.order_date,
    'notes', v_order.notes,
    'updated_at', v_order.updated_at,
    'lines', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', order_item.id,
          'item_id', order_item.item_id,
          'commercial_configuration_id',
            order_item.commercial_configuration_id,
          'commercial_configuration_code_id',
            order_item.commercial_configuration_code_id,
          'code_snapshot', order_item.code_snapshot,
          'commercial_code_snapshot',
            order_item.commercial_code_snapshot,
          'ordered_quantity', order_item.ordered_quantity,
          'picked_quantity', order_item.picked_quantity,
          'stocked_quantity', order_item.stocked_quantity,
          'cancelled_quantity', order_item.cancelled_quantity,
          'position', order_item.position,
          'notes', order_item.notes
        )
        order by order_item.position, order_item.id
      ),
      '[]'::jsonb
    )
  )
  into v_before
  from public.supplier_order_items as order_item
  where order_item.supplier_order_id = p_supplier_order_id;

  v_header_changed :=
    v_order.negotiation_number is distinct from v_negotiation_number
    or v_order.order_date is distinct from p_order_date
    or v_order.notes is distinct from v_notes;

  -- Validate all desired lines before applying any change.
  for v_line in
    select value
    from jsonb_array_elements(v_lines)
    order by coalesce(
      value ->> 'item_id',
      value ->> 'commercial_configuration_id'
    ),
    value ->> 'commercial_configuration_code_id'
  loop
    v_line_id := nullif(v_line ->> 'id', '')::uuid;
    v_item_id := nullif(v_line ->> 'item_id', '')::uuid;
    v_configuration_id :=
      nullif(v_line ->> 'commercial_configuration_id', '')::uuid;
    v_commercial_code_id :=
      nullif(v_line ->> 'commercial_configuration_code_id', '')::uuid;
    v_quantity := (v_line ->> 'quantity')::integer;

    if v_line_id is null then
      perform *
      from private.supplier_order_catalog_snapshot(
        v_item_id,
        v_configuration_id,
        v_commercial_code_id,
        true
      );
      v_items_changed := true;
      continue;
    end if;

    select *
    into v_existing_line
    from public.supplier_order_items
    where id = v_line_id
      and supplier_order_id = p_supplier_order_id;

    if not found then
      raise exception using
        errcode = '22023',
        message = 'An existing line does not belong to this supplier order.';
    end if;

    v_identity_changed :=
      v_existing_line.item_id is distinct from v_item_id
      or v_existing_line.commercial_configuration_id
        is distinct from v_configuration_id
      or v_existing_line.commercial_configuration_code_id
        is distinct from v_commercial_code_id;

    if v_identity_changed and (
      v_existing_line.picked_quantity > 0
      or v_existing_line.stocked_quantity > 0
      or v_existing_line.cancelled_quantity > 0
      or exists (
        select 1
        from public.supplier_order_events as event
        where event.supplier_order_item_id = v_existing_line.id
      )
    ) then
      raise exception using
        errcode = '22023',
        message = 'A moved or cancelled line cannot change its catalog identity.';
    end if;

    if v_identity_changed then
      perform *
      from private.supplier_order_catalog_snapshot(
        v_item_id,
        v_configuration_id,
        v_commercial_code_id,
        true
      );
    end if;

    if v_quantity
      < v_existing_line.picked_quantity + v_existing_line.cancelled_quantity then
      raise exception using
        errcode = '22023',
        message = 'ordered_quantity cannot be lower than picked plus cancelled quantity.';
    end if;

    if v_identity_changed
      or v_existing_line.ordered_quantity is distinct from v_quantity
      or v_existing_line.notes
        is distinct from nullif(v_line ->> 'notes', '')
      or v_existing_line.position
        is distinct from (v_line ->> 'position')::integer then
      v_items_changed := true;
    end if;
  end loop;

  if exists (
    select 1
    from public.supplier_order_items as existing_line
    where existing_line.supplier_order_id = p_supplier_order_id
      and not exists (
        select 1
        from jsonb_array_elements(v_lines) as desired_line
        where nullif(desired_line ->> 'id', '')::uuid = existing_line.id
      )
      and (
        existing_line.picked_quantity > 0
        or existing_line.stocked_quantity > 0
        or existing_line.cancelled_quantity > 0
        or exists (
          select 1
          from public.supplier_order_events as event
          where event.supplier_order_item_id = existing_line.id
        )
      )
  ) then
    raise exception using
      errcode = '22023',
      message = 'A moved or cancelled line cannot be removed.';
  end if;

  if exists (
    select 1
    from public.supplier_order_items as existing_line
    where existing_line.supplier_order_id = p_supplier_order_id
      and not exists (
        select 1
        from jsonb_array_elements(v_lines) as desired_line
        where nullif(desired_line ->> 'id', '')::uuid = existing_line.id
      )
  ) then
    v_items_changed := true;
  end if;

  update public.supplier_orders
  set negotiation_number = v_negotiation_number,
      order_date = p_order_date,
      notes = v_notes
  where id = p_supplier_order_id;

  if v_items_changed then
    -- Move current positions outside the accepted RPC range before stable reorder.
    update public.supplier_order_items
    set position = position + 1001
    where supplier_order_id = p_supplier_order_id;

    for v_line in
      select value
      from jsonb_array_elements(v_lines)
      order by (value ->> 'position')::integer
    loop
      v_line_id := nullif(v_line ->> 'id', '')::uuid;
      v_item_id := nullif(v_line ->> 'item_id', '')::uuid;
      v_configuration_id :=
        nullif(v_line ->> 'commercial_configuration_id', '')::uuid;
      v_commercial_code_id :=
        nullif(v_line ->> 'commercial_configuration_code_id', '')::uuid;
      v_quantity := (v_line ->> 'quantity')::integer;
      v_position := (v_line ->> 'position')::integer;
      v_line_notes := nullif(v_line ->> 'notes', '');

      if v_line_id is null then
        insert into public.supplier_order_items (
          supplier_order_id,
          item_id,
          commercial_configuration_id,
          commercial_configuration_code_id,
          code_snapshot,
          description_snapshot,
          item_type_snapshot,
          ordered_quantity,
          position,
          notes
        )
        values (
          p_supplier_order_id,
          v_item_id,
          v_configuration_id,
          v_commercial_code_id,
          'SERVER_PENDING',
          'SERVER_PENDING',
          'LOOSE_PART',
          v_quantity,
          v_position,
          v_line_notes
        );
      else
        select *
        into v_existing_line
        from public.supplier_order_items
        where id = v_line_id;

        v_identity_changed :=
          v_existing_line.item_id is distinct from v_item_id
          or v_existing_line.commercial_configuration_id
            is distinct from v_configuration_id
          or v_existing_line.commercial_configuration_code_id
            is distinct from v_commercial_code_id;

        if v_identity_changed then
          update public.supplier_order_items
          set item_id = v_item_id,
              commercial_configuration_id = v_configuration_id,
              commercial_configuration_code_id = v_commercial_code_id,
              ordered_quantity = v_quantity,
              position = v_position,
              notes = v_line_notes
          where id = v_line_id;
        else
          update public.supplier_order_items
          set ordered_quantity = v_quantity,
              position = v_position,
              notes = v_line_notes
          where id = v_line_id;
        end if;
      end if;
    end loop;

    delete from public.supplier_order_items as existing_line
    where existing_line.supplier_order_id = p_supplier_order_id
      and not exists (
        select 1
        from jsonb_array_elements(v_lines) as desired_line
        where nullif(desired_line ->> 'id', '')::uuid = existing_line.id
      );
  end if;

  update public.supplier_orders
  set updated_at = now()
  where id = p_supplier_order_id;

  v_result := private.supplier_order_result(p_supplier_order_id);
  select jsonb_build_object(
    'negotiation_number', supplier_order.negotiation_number,
    'order_date', supplier_order.order_date,
    'notes', supplier_order.notes,
    'updated_at', supplier_order.updated_at,
    'lines', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', order_item.id,
          'item_id', order_item.item_id,
          'commercial_configuration_id',
            order_item.commercial_configuration_id,
          'commercial_configuration_code_id',
            order_item.commercial_configuration_code_id,
          'code_snapshot', order_item.code_snapshot,
          'commercial_code_snapshot',
            order_item.commercial_code_snapshot,
          'ordered_quantity', order_item.ordered_quantity,
          'picked_quantity', order_item.picked_quantity,
          'stocked_quantity', order_item.stocked_quantity,
          'cancelled_quantity', order_item.cancelled_quantity,
          'position', order_item.position,
          'notes', order_item.notes
        )
        order by order_item.position, order_item.id
      ),
      '[]'::jsonb
    )
  )
  into v_after
  from public.supplier_orders as supplier_order
  join public.supplier_order_items as order_item
    on order_item.supplier_order_id = supplier_order.id
  where supplier_order.id = p_supplier_order_id
  group by
    supplier_order.negotiation_number,
    supplier_order.order_date,
    supplier_order.notes,
    supplier_order.updated_at;
  v_event_type := case
    when v_items_changed then 'ORDER_ITEMS_UPDATED'
    else 'ORDER_HEADER_UPDATED'
  end;

  insert into public.supplier_order_events (
    supplier_order_id,
    event_type,
    user_id,
    user_name_snapshot,
    idempotency_key,
    details
  )
  values (
    p_supplier_order_id,
    v_event_type,
    p_user_id,
    p_user_name,
    p_idempotency_key,
    jsonb_build_object(
      'request', v_request,
      'result', v_result,
      'header_changed', v_header_changed,
      'items_changed', v_items_changed,
      'before', v_before,
      'after', v_after
    )
  );

  return v_result;
end;
$$;

create function private.set_supplier_order_item_picked_quantity(
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
      'picked_quantity_delta', p_picked_quantity - v_previous_quantity
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

create function private.mark_supplier_order_all_picked(
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
        'new_picked_quantity',
          order_item.ordered_quantity - order_item.cancelled_quantity
      )
      order by order_item.id
    ),
    '[]'::jsonb
  )
  into v_changes
  from public.supplier_order_items as order_item
  where order_item.supplier_order_id = p_supplier_order_id
    and order_item.picked_quantity
      is distinct from (
        order_item.ordered_quantity - order_item.cancelled_quantity
      );

  update public.supplier_order_items
  set picked_quantity = ordered_quantity - cancelled_quantity
  where supplier_order_id = p_supplier_order_id
    and picked_quantity
      is distinct from ordered_quantity - cancelled_quantity;

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
      'changes', v_changes
    )
  );

  return v_result;
end;
$$;

create function private.cancel_supplier_order(
  p_supplier_order_id uuid,
  p_cancellation_note text,
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
  v_cancellation_note text;
  v_request jsonb;
  v_existing_result jsonb;
  v_result jsonb;
  v_cancelled_at timestamptz;
begin
  if p_supplier_order_id is null or p_idempotency_key is null then
    raise exception using
      errcode = '22023',
      message = 'Order and idempotency key are required.';
  end if;

  v_cancellation_note := nullif(btrim(p_cancellation_note), '');

  if v_cancellation_note is not null
    and char_length(v_cancellation_note) > 2000 then
    raise exception using
      errcode = '22023',
      message = 'p_cancellation_note must contain at most 2000 characters.';
  end if;

  v_request := jsonb_build_object(
    'supplier_order_id', p_supplier_order_id,
    'cancellation_note', v_cancellation_note
  );

  v_existing_result := private.supplier_order_existing_result(
    p_user_id,
    p_idempotency_key,
    'ORDER_CANCELLED',
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
      message = 'The supplier order is already cancelled.';
  end if;

  perform 1
  from public.supplier_order_items
  where supplier_order_id = p_supplier_order_id
  order by id
  for update;

  if exists (
    select 1
    from public.supplier_order_items
    where supplier_order_id = p_supplier_order_id
      and (picked_quantity > 0 or stocked_quantity > 0)
  ) then
    raise exception using
      errcode = '22023',
      message = 'An order with picked or stocked quantities cannot be fully cancelled.';
  end if;

  update public.supplier_order_items
  set cancelled_quantity = ordered_quantity
  where supplier_order_id = p_supplier_order_id;

  update public.supplier_orders
  set cancelled_at = now(),
      cancelled_by = p_user_id,
      cancelled_by_name_snapshot = p_user_name,
      cancellation_note = v_cancellation_note
  where id = p_supplier_order_id;

  v_result := private.supplier_order_result(p_supplier_order_id);

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
    'ORDER_CANCELLED',
    p_user_id,
    p_user_name,
    p_idempotency_key,
    v_cancellation_note,
    jsonb_build_object(
      'request', v_request,
      'result', v_result
    )
  );

  return v_result;
end;
$$;

create function private.cancel_supplier_order_remaining(
  p_supplier_order_id uuid,
  p_cancellation_note text,
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
  v_cancellation_note text;
  v_request jsonb;
  v_existing_result jsonb;
  v_result jsonb;
  v_cancelled_at timestamptz;
begin
  if p_supplier_order_id is null or p_idempotency_key is null then
    raise exception using
      errcode = '22023',
      message = 'Order and idempotency key are required.';
  end if;

  v_cancellation_note := nullif(btrim(p_cancellation_note), '');

  if v_cancellation_note is not null
    and char_length(v_cancellation_note) > 2000 then
    raise exception using
      errcode = '22023',
      message = 'p_cancellation_note must contain at most 2000 characters.';
  end if;

  v_request := jsonb_build_object(
    'supplier_order_id', p_supplier_order_id,
    'cancellation_note', v_cancellation_note
  );

  v_existing_result := private.supplier_order_existing_result(
    p_user_id,
    p_idempotency_key,
    'REMAINING_QUANTITY_CANCELLED',
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
      message = 'The supplier order is already cancelled.';
  end if;

  perform 1
  from public.supplier_order_items
  where supplier_order_id = p_supplier_order_id
  order by id
  for update;

  if not exists (
    select 1
    from public.supplier_order_items
    where supplier_order_id = p_supplier_order_id
      and (picked_quantity > 0 or stocked_quantity > 0)
  ) then
    raise exception using
      errcode = '22023',
      message = 'Use full cancellation when no quantity has been picked.';
  end if;

  if not exists (
    select 1
    from public.supplier_order_items
    where supplier_order_id = p_supplier_order_id
      and ordered_quantity - picked_quantity - cancelled_quantity > 0
  ) then
    raise exception using
      errcode = '22023',
      message = 'The supplier order has no remaining pickup quantity to cancel.';
  end if;

  update public.supplier_order_items
  set cancelled_quantity = ordered_quantity - picked_quantity
  where supplier_order_id = p_supplier_order_id;

  update public.supplier_orders
  set cancelled_at = now(),
      cancelled_by = p_user_id,
      cancelled_by_name_snapshot = p_user_name,
      cancellation_note = v_cancellation_note
  where id = p_supplier_order_id;

  v_result := private.supplier_order_result(p_supplier_order_id);

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
    'REMAINING_QUANTITY_CANCELLED',
    p_user_id,
    p_user_name,
    p_idempotency_key,
    v_cancellation_note,
    jsonb_build_object(
      'request', v_request,
      'result', v_result
    )
  );

  return v_result;
end;
$$;

create function private.require_supplier_order_user()
returns table (
  user_id uuid,
  user_name text
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
    btrim(profile.name)
  from public.profiles as profile
  where profile.id = v_user_id
    and profile.is_active
    and nullif(btrim(profile.name), '') is not null
  for share;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'The authenticated user requires an active profile with a registered name.';
  end if;
end;
$$;

create function public.create_supplier_order(
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
begin
  select *
  into v_user
  from private.require_supplier_order_user();

  return private.create_supplier_order(
    p_negotiation_number,
    p_order_date,
    p_notes,
    p_lines,
    p_idempotency_key,
    v_user.user_id,
    v_user.user_name
  );
end;
$$;

create function public.update_supplier_order(
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
begin
  select *
  into v_user
  from private.require_supplier_order_user();

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
end;
$$;

create function public.set_supplier_order_item_picked_quantity(
  p_supplier_order_item_id uuid,
  p_picked_quantity integer,
  p_description text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user record;
begin
  select *
  into v_user
  from private.require_supplier_order_user();

  return private.set_supplier_order_item_picked_quantity(
    p_supplier_order_item_id,
    p_picked_quantity,
    p_description,
    p_idempotency_key,
    v_user.user_id,
    v_user.user_name
  );
end;
$$;

create function public.mark_supplier_order_all_picked(
  p_supplier_order_id uuid,
  p_description text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user record;
begin
  select *
  into v_user
  from private.require_supplier_order_user();

  return private.mark_supplier_order_all_picked(
    p_supplier_order_id,
    p_description,
    p_idempotency_key,
    v_user.user_id,
    v_user.user_name
  );
end;
$$;

create function public.cancel_supplier_order(
  p_supplier_order_id uuid,
  p_cancellation_note text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user record;
begin
  select *
  into v_user
  from private.require_supplier_order_user();

  return private.cancel_supplier_order(
    p_supplier_order_id,
    p_cancellation_note,
    p_idempotency_key,
    v_user.user_id,
    v_user.user_name
  );
end;
$$;

create function public.cancel_supplier_order_remaining(
  p_supplier_order_id uuid,
  p_cancellation_note text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user record;
begin
  select *
  into v_user
  from private.require_supplier_order_user();

  return private.cancel_supplier_order_remaining(
    p_supplier_order_id,
    p_cancellation_note,
    p_idempotency_key,
    v_user.user_id,
    v_user.user_name
  );
end;
$$;

alter table public.supplier_orders enable row level security;
alter table public.supplier_order_items enable row level security;
alter table public.supplier_order_events enable row level security;

create policy supplier_orders_select_active_users
on public.supplier_orders
for select
to authenticated
using ((select private.is_active_profile()));

create policy supplier_order_items_select_active_users
on public.supplier_order_items
for select
to authenticated
using ((select private.is_active_profile()));

create policy supplier_order_events_select_active_users
on public.supplier_order_events
for select
to authenticated
using ((select private.is_active_profile()));

revoke all privileges on table
  public.supplier_orders,
  public.supplier_order_items,
  public.supplier_order_events
from public, anon, authenticated;

grant select on table
  public.supplier_orders,
  public.supplier_order_items,
  public.supplier_order_events
to authenticated;

revoke all privileges on table
  public.supplier_order_summaries,
  public.supplier_order_item_details
from public, anon, authenticated;

grant select on table
  public.supplier_order_summaries,
  public.supplier_order_item_details
to authenticated;

revoke all on function private.supplier_order_catalog_snapshot(
  uuid,
  uuid,
  uuid,
  boolean
) from public, anon, authenticated;

revoke all on function private.set_supplier_order_item_snapshots()
from public, anon, authenticated;

revoke all on function private.touch_supplier_order_timestamp()
from public, anon, authenticated;

revoke all on function private.validate_supplier_order_event_item()
from public, anon, authenticated;

revoke all on function private.protect_supplier_order_commercial_code_links()
from public, anon, authenticated;

revoke all on function private.normalize_supplier_order_lines(jsonb, boolean)
from public, anon, authenticated;

revoke all on function private.supplier_order_result(uuid)
from public, anon, authenticated;

revoke all on function private.supplier_order_existing_result(
  uuid,
  uuid,
  text,
  jsonb
) from public, anon, authenticated;

revoke all on function private.create_supplier_order(
  text,
  date,
  text,
  jsonb,
  uuid,
  uuid,
  text
) from public, anon, authenticated;

revoke all on function private.update_supplier_order(
  uuid,
  timestamptz,
  text,
  date,
  text,
  jsonb,
  uuid,
  uuid,
  text
) from public, anon, authenticated;

revoke all on function private.set_supplier_order_item_picked_quantity(
  uuid,
  integer,
  text,
  uuid,
  uuid,
  text
) from public, anon, authenticated;

revoke all on function private.mark_supplier_order_all_picked(
  uuid,
  text,
  uuid,
  uuid,
  text
) from public, anon, authenticated;

revoke all on function private.cancel_supplier_order(
  uuid,
  text,
  uuid,
  uuid,
  text
) from public, anon, authenticated;

revoke all on function private.cancel_supplier_order_remaining(
  uuid,
  text,
  uuid,
  uuid,
  text
) from public, anon, authenticated;

revoke all on function private.require_supplier_order_user()
from public, anon, authenticated;

revoke all on function public.create_supplier_order(
  text,
  date,
  text,
  jsonb,
  uuid
) from public, anon, authenticated;

revoke all on function public.update_supplier_order(
  uuid,
  timestamptz,
  text,
  date,
  text,
  jsonb,
  uuid
) from public, anon, authenticated;

revoke all on function public.set_supplier_order_item_picked_quantity(
  uuid,
  integer,
  text,
  uuid
) from public, anon, authenticated;

revoke all on function public.mark_supplier_order_all_picked(
  uuid,
  text,
  uuid
) from public, anon, authenticated;

revoke all on function public.cancel_supplier_order(
  uuid,
  text,
  uuid
) from public, anon, authenticated;

revoke all on function public.cancel_supplier_order_remaining(
  uuid,
  text,
  uuid
) from public, anon, authenticated;

grant execute on function public.create_supplier_order(
  text,
  date,
  text,
  jsonb,
  uuid
) to authenticated;

grant execute on function public.update_supplier_order(
  uuid,
  timestamptz,
  text,
  date,
  text,
  jsonb,
  uuid
) to authenticated;

grant execute on function public.set_supplier_order_item_picked_quantity(
  uuid,
  integer,
  text,
  uuid
) to authenticated;

grant execute on function public.mark_supplier_order_all_picked(
  uuid,
  text,
  uuid
) to authenticated;

grant execute on function public.cancel_supplier_order(
  uuid,
  text,
  uuid
) to authenticated;

grant execute on function public.cancel_supplier_order_remaining(
  uuid,
  text,
  uuid
) to authenticated;
