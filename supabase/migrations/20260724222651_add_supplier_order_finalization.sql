alter table public.supplier_orders
  add column finalized_at timestamptz,
  add column finalized_by uuid
    references public.profiles (id) on delete restrict,
  add column finalized_by_name_snapshot text,
  add column finalization_note text,
  add constraint supplier_orders_finalization_note_check check (
    finalization_note is null
    or (
      finalization_note = btrim(finalization_note)
      and char_length(finalization_note) between 1 and 500
    )
  ),
  add constraint supplier_orders_finalization_metadata_check check (
    (
      finalized_at is null
      and finalized_by is null
      and finalized_by_name_snapshot is null
      and finalization_note is null
    )
    or
    (
      finalized_at is not null
      and finalized_by is not null
      and finalized_by_name_snapshot is not null
      and btrim(finalized_by_name_snapshot) <> ''
    )
  ),
  add constraint supplier_orders_single_closure_check check (
    not (finalized_at is not null and cancelled_at is not null)
  );

comment on column public.supplier_orders.finalized_at is
  'Manual operational closure. It does not mean that every picked unit has entered stock.';

comment on column public.supplier_orders.finalized_by_name_snapshot is
  'Immutable display-name snapshot of the user who finalized the order.';

alter table public.supplier_order_events
  drop constraint supplier_order_events_type_check;

alter table public.supplier_order_events
  add constraint supplier_order_events_type_check check (
    event_type in (
      'ORDER_CREATED',
      'ORDER_HEADER_UPDATED',
      'ORDER_ITEMS_UPDATED',
      'PICKED_QUANTITY_CHANGED',
      'ALL_ITEMS_MARKED_PICKED',
      'ORDER_CANCELLED',
      'REMAINING_QUANTITY_CANCELLED',
      'STOCK_ENTRY_CREATED',
      'ORDER_FINALIZED'
    )
  );

create index supplier_orders_active_ordering_idx
  on public.supplier_orders (order_date desc, created_at desc)
  where cancelled_at is null and finalized_at is null;

create index supplier_orders_history_ordering_idx
  on public.supplier_orders (
    (coalesce(finalized_at, cancelled_at)) desc,
    order_date desc,
    created_at desc
  )
  where finalized_at is not null or cancelled_at is not null;

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
  end as closed_by_name_snapshot
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
  'One-row-per-order totals, pickup status, and centralized active/history classification.';

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
    'closed_by_name_snapshot', summary.closed_by_name_snapshot
  )
  from public.supplier_order_summaries as summary
  where summary.id = p_supplier_order_id;
$$;

create or replace function private.supplier_order_existing_result(
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
  v_supplier_order_id uuid;
  v_finalized_at timestamptz;
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

  if found then
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
  end if;

  -- All existing operational mutations pass through this idempotency helper.
  -- An identical retry returns above; every new request locks and checks the
  -- order before its worker can change current operational state.
  if p_event_type in (
    'ORDER_UPDATED',
    'PICKED_QUANTITY_CHANGED',
    'ALL_ITEMS_MARKED_PICKED',
    'ORDER_CANCELLED',
    'REMAINING_QUANTITY_CANCELLED',
    'ORDER_FINALIZED'
  ) then
    v_supplier_order_id :=
      nullif(p_request ->> 'supplier_order_id', '')::uuid;

    if v_supplier_order_id is null
      and nullif(p_request ->> 'supplier_order_item_id', '') is not null then
      select supplier_order.id, supplier_order.finalized_at
      into v_supplier_order_id, v_finalized_at
      from public.supplier_order_items as order_item
      join public.supplier_orders as supplier_order
        on supplier_order.id = order_item.supplier_order_id
      where order_item.id =
        (p_request ->> 'supplier_order_item_id')::uuid
      for update of supplier_order;
    elsif v_supplier_order_id is not null then
      select supplier_order.finalized_at
      into v_finalized_at
      from public.supplier_orders as supplier_order
      where supplier_order.id = v_supplier_order_id
      for update;
    end if;

    if v_finalized_at is not null then
      raise exception using
        errcode = '22023',
        message = 'A finalized supplier order cannot be changed.';
    end if;
  end if;

  return null;
end;
$$;

create function private.finalize_supplier_order(
  p_supplier_order_id uuid,
  p_expected_updated_at timestamptz,
  p_finalization_note text,
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
  v_finalization_note text;
  v_request jsonb;
  v_existing_result jsonb;
  v_result jsonb;
  v_order public.supplier_orders%rowtype;
  v_status text;
  v_waiting_pickup_quantity bigint;
  v_before jsonb;
begin
  if p_supplier_order_id is null
    or p_expected_updated_at is null
    or p_idempotency_key is null then
    raise exception using
      errcode = '22023',
      message = 'Order, expected updated_at, and idempotency key are required.';
  end if;

  v_finalization_note := nullif(btrim(p_finalization_note), '');

  if v_finalization_note is not null
    and char_length(v_finalization_note) > 500 then
    raise exception using
      errcode = '22023',
      message = 'p_finalization_note must contain at most 500 characters.';
  end if;

  v_request := jsonb_build_object(
    'supplier_order_id', p_supplier_order_id,
    'expected_updated_at', p_expected_updated_at,
    'finalization_note', v_finalization_note
  );

  v_existing_result := private.supplier_order_existing_result(
    p_user_id,
    p_idempotency_key,
    'ORDER_FINALIZED',
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
      message = 'A cancelled supplier order cannot be finalized.';
  end if;

  if v_order.finalized_at is not null then
    raise exception using
      errcode = '22023',
      message = 'The supplier order is already finalized.';
  end if;

  if v_order.updated_at is distinct from p_expected_updated_at then
    raise exception using
      errcode = '40001',
      message = 'The supplier order changed after it was loaded. Reload it before finalizing.';
  end if;

  perform 1
  from public.supplier_order_items
  where supplier_order_id = p_supplier_order_id
  order by id
  for update;

  select summary.status, summary.waiting_pickup_quantity
  into v_status, v_waiting_pickup_quantity
  from public.supplier_order_summaries as summary
  where summary.id = p_supplier_order_id;

  if v_status is distinct from 'COMPLETED'
    or v_waiting_pickup_quantity <> 0 then
    raise exception using
      errcode = '22023',
      message = 'Only a completed supplier order with no pickup quantity remaining can be finalized.';
  end if;

  v_before := jsonb_build_object(
    'status', v_status,
    'updated_at', v_order.updated_at,
    'finalized_at', v_order.finalized_at,
    'finalized_by', v_order.finalized_by,
    'finalized_by_name_snapshot',
      v_order.finalized_by_name_snapshot,
    'finalization_note', v_order.finalization_note
  );

  update public.supplier_orders
  set finalized_at = now(),
      finalized_by = p_user_id,
      finalized_by_name_snapshot = btrim(p_user_name),
      finalization_note = v_finalization_note,
      updated_at = now()
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
    'ORDER_FINALIZED',
    p_user_id,
    btrim(p_user_name),
    p_idempotency_key,
    v_finalization_note,
    jsonb_build_object(
      'request', v_request,
      'result', v_result,
      'before', v_before,
      'after', jsonb_build_object(
        'status', v_result -> 'status',
        'updated_at', v_result -> 'updated_at',
        'finalized_at', v_result -> 'finalized_at',
        'finalized_by', v_result -> 'finalized_by',
        'finalized_by_name_snapshot',
          v_result -> 'finalized_by_name_snapshot',
        'finalization_note', v_result -> 'finalization_note'
      )
    )
  );

  return v_result;
end;
$$;

create function public.finalize_supplier_order(
  p_supplier_order_id uuid,
  p_expected_updated_at timestamptz,
  p_finalization_note text,
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

  return private.finalize_supplier_order(
    p_supplier_order_id,
    p_expected_updated_at,
    p_finalization_note,
    p_idempotency_key,
    v_user.user_id,
    v_user.user_name
  );
end;
$$;

revoke all on function private.finalize_supplier_order(
  uuid,
  timestamptz,
  text,
  uuid,
  uuid,
  text
) from public, anon, authenticated;

revoke all on function public.finalize_supplier_order(
  uuid,
  timestamptz,
  text,
  uuid
) from public, anon, authenticated;

grant execute on function public.finalize_supplier_order(
  uuid,
  timestamptz,
  text,
  uuid
) to authenticated;
