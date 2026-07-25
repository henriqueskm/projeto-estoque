create table public.supplier_order_stock_entries (
  id uuid primary key default gen_random_uuid(),
  supplier_order_id uuid not null
    references public.supplier_orders (id) on delete restrict,
  movement_batch_id uuid not null unique
    references public.movement_batches (id) on delete restrict,
  note text,
  created_by uuid references public.profiles (id) on delete set null,
  created_by_name_snapshot text not null,
  created_at timestamptz not null default now(),
  constraint supplier_order_stock_entries_note_check check (
    note is null
    or (
      note = btrim(note)
      and char_length(note) between 1 and 500
    )
  ),
  constraint supplier_order_stock_entries_user_snapshot_check check (
    btrim(created_by_name_snapshot) <> ''
  )
);

comment on table public.supplier_order_stock_entries is
  'Immutable link between a supplier order and the real inbound movement batch created for one partial or complete stock entry.';

create table public.supplier_order_stock_entry_lines (
  id uuid primary key default gen_random_uuid(),
  supplier_order_stock_entry_id uuid not null
    references public.supplier_order_stock_entries (id) on delete restrict,
  supplier_order_item_id uuid not null
    references public.supplier_order_items (id) on delete restrict,
  inbound_batch_line_id uuid not null
    references public.inbound_batch_lines (id) on delete restrict,
  quantity integer not null,
  item_id uuid references public.items (id) on delete restrict,
  commercial_configuration_id uuid
    references public.commercial_configurations (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint supplier_order_stock_entry_lines_target_check check (
    num_nonnulls(item_id, commercial_configuration_id) = 1
  ),
  constraint supplier_order_stock_entry_lines_quantity_check check (
    quantity > 0
  ),
  constraint supplier_order_stock_entry_lines_entry_item_key unique (
    supplier_order_stock_entry_id,
    supplier_order_item_id
  )
);

comment on table public.supplier_order_stock_entry_lines is
  'Per-order-line allocation to the consolidated inbound line. The server resolves every physical target from supplier_order_items.';

create index supplier_order_stock_entries_order_created_at_idx
  on public.supplier_order_stock_entries (
    supplier_order_id,
    created_at desc,
    id
  );

create index supplier_order_stock_entry_lines_order_item_id_idx
  on public.supplier_order_stock_entry_lines (supplier_order_item_id);

create index supplier_order_stock_entry_lines_inbound_line_id_idx
  on public.supplier_order_stock_entry_lines (inbound_batch_line_id);

create index supplier_order_stock_entry_lines_item_id_idx
  on public.supplier_order_stock_entry_lines (item_id)
  where item_id is not null;

create index supplier_order_stock_entry_lines_configuration_id_idx
  on public.supplier_order_stock_entry_lines (
    commercial_configuration_id
  )
  where commercial_configuration_id is not null;

create function private.normalize_supplier_order_stock_entry_lines(
  p_lines jsonb
)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_line jsonb;
  v_line_number integer := 0;
  v_supplier_order_item_id uuid;
  v_quantity_numeric numeric;
  v_normalized jsonb := '[]'::jsonb;
begin
  if p_lines is null or jsonb_typeof(p_lines) is distinct from 'array' then
    raise exception using
      errcode = '22023',
      message = 'p_lines must be a non-empty JSON array.';
  end if;

  if jsonb_array_length(p_lines) not between 1 and 1000 then
    raise exception using
      errcode = '22023',
      message = 'p_lines must contain between 1 and 1000 lines.';
  end if;

  for v_line in
    select payload.value
    from jsonb_array_elements(p_lines) as payload(value)
  loop
    v_line_number := v_line_number + 1;

    if jsonb_typeof(v_line) is distinct from 'object' then
      raise exception using
        errcode = '22023',
        message = format('p_lines entry %s must be an object.', v_line_number);
    end if;

    if v_line - 'supplier_order_item_id' - 'quantity' <> '{}'::jsonb then
      raise exception using
        errcode = '22023',
        message = format(
          'p_lines entry %s contains unexpected fields.',
          v_line_number
        );
    end if;

    if not (v_line ? 'supplier_order_item_id')
      or jsonb_typeof(
        v_line -> 'supplier_order_item_id'
      ) is distinct from 'string'
      or nullif(btrim(v_line ->> 'supplier_order_item_id'), '') is null then
      raise exception using
        errcode = '22023',
        message = format(
          'p_lines entry %s must contain supplier_order_item_id as a UUID string.',
          v_line_number
        );
    end if;

    begin
      v_supplier_order_item_id :=
        (v_line ->> 'supplier_order_item_id')::uuid;
    exception
      when invalid_text_representation then
        raise exception using
          errcode = '22023',
          message = format(
            'p_lines entry %s contains an invalid supplier_order_item_id UUID.',
            v_line_number
          );
    end;

    if exists (
      select 1
      from jsonb_array_elements(v_normalized) as existing_line
      where (existing_line ->> 'supplier_order_item_id')::uuid
        = v_supplier_order_item_id
    ) then
      raise exception using
        errcode = '22023',
        message = 'The same supplier-order line cannot appear twice.';
    end if;

    if not (v_line ? 'quantity')
      or jsonb_typeof(v_line -> 'quantity') is distinct from 'number' then
      raise exception using
        errcode = '22023',
        message = format(
          'p_lines entry %s must contain quantity as an integer.',
          v_line_number
        );
    end if;

    begin
      v_quantity_numeric := (v_line ->> 'quantity')::numeric;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        raise exception using
          errcode = '22023',
          message = format(
            'p_lines entry %s contains an invalid quantity.',
            v_line_number
          );
    end;

    if v_quantity_numeric <> trunc(v_quantity_numeric)
      or v_quantity_numeric < 1
      or v_quantity_numeric > 2147483647 then
      raise exception using
        errcode = '22023',
        message = format(
          'p_lines entry %s quantity must be a positive 32-bit integer.',
          v_line_number
        );
    end if;

    v_normalized := v_normalized || jsonb_build_array(
      jsonb_build_object(
        'supplier_order_item_id',
        v_supplier_order_item_id,
        'quantity',
        v_quantity_numeric::integer
      )
    );
  end loop;

  select jsonb_agg(line.value order by line.value ->> 'supplier_order_item_id')
  into v_normalized
  from jsonb_array_elements(v_normalized) as line(value);

  return v_normalized;
end;
$$;

create function private.validate_supplier_order_stock_entry_links()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_entry_id uuid;
begin
  v_entry_id := case
    when tg_table_name = 'supplier_order_stock_entries' then new.id
    else new.supplier_order_stock_entry_id
  end;

  if not exists (
    select 1
    from public.supplier_order_stock_entries as entry
    join public.movement_batches as batch
      on batch.id = entry.movement_batch_id
    where entry.id = v_entry_id
      and batch.movement_type = 'INBOUND'
      and batch.source = 'MANUAL'
      and batch.user_id is not distinct from entry.created_by
      and batch.user_name_snapshot = entry.created_by_name_snapshot
  ) then
    raise exception using
      errcode = '23514',
      message = 'A supplier-order stock entry must reference its creator''s normal manual inbound batch.';
  end if;

  if exists (
    select 1
    from public.supplier_order_stock_entry_lines as entry_line
    join public.supplier_order_stock_entries as entry
      on entry.id = entry_line.supplier_order_stock_entry_id
    join public.supplier_order_items as order_item
      on order_item.id = entry_line.supplier_order_item_id
    join public.inbound_batch_lines as inbound_line
      on inbound_line.id = entry_line.inbound_batch_line_id
    left join public.commercial_configuration_codes as commercial_code
      on commercial_code.id =
        inbound_line.commercial_configuration_code_id
    where entry_line.supplier_order_stock_entry_id = v_entry_id
      and (
        order_item.supplier_order_id <> entry.supplier_order_id
        or inbound_line.batch_id <> entry.movement_batch_id
        or entry_line.item_id is distinct from order_item.item_id
        or entry_line.commercial_configuration_id
          is distinct from order_item.commercial_configuration_id
        or (
          entry_line.item_id is not null
          and inbound_line.item_id is distinct from entry_line.item_id
        )
        or (
          entry_line.commercial_configuration_id is not null
          and commercial_code.configuration_id
            is distinct from entry_line.commercial_configuration_id
        )
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'A supplier-order stock-entry link does not match its order item or inbound batch line.';
  end if;

  if exists (
    select 1
    from public.inbound_batch_lines as inbound_line
    join public.supplier_order_stock_entries as entry
      on entry.movement_batch_id = inbound_line.batch_id
    left join lateral (
      select coalesce(sum(entry_line.quantity), 0)::bigint as quantity
      from public.supplier_order_stock_entry_lines as entry_line
      where entry_line.supplier_order_stock_entry_id = entry.id
        and entry_line.inbound_batch_line_id = inbound_line.id
    ) as allocated on true
    where entry.id = v_entry_id
      and allocated.quantity <> inbound_line.quantity
  ) then
    raise exception using
      errcode = '23514',
      message = 'Supplier-order stock-entry allocations must equal every consolidated inbound line quantity.';
  end if;

  if not exists (
    select 1
    from public.supplier_order_stock_entry_lines
    where supplier_order_stock_entry_id = v_entry_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'A supplier-order stock entry must contain at least one line.';
  end if;

  return new;
end;
$$;

create constraint trigger supplier_order_stock_entries_validate_links
after insert or update
on public.supplier_order_stock_entries
deferrable initially deferred
for each row
execute function private.validate_supplier_order_stock_entry_links();

create constraint trigger supplier_order_stock_entry_lines_validate_links
after insert or update
on public.supplier_order_stock_entry_lines
deferrable initially deferred
for each row
execute function private.validate_supplier_order_stock_entry_links();

create function private.validate_supplier_order_stocked_quantity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_linked_quantity bigint;
  v_current_stocked_quantity integer;
begin
  select order_item.stocked_quantity
  into v_current_stocked_quantity
  from public.supplier_order_items as order_item
  where order_item.id = new.id;

  if not found then
    return new;
  end if;

  select coalesce(sum(entry_line.quantity), 0)::bigint
  into v_linked_quantity
  from public.supplier_order_stock_entry_lines as entry_line
  where entry_line.supplier_order_item_id = new.id;

  if v_linked_quantity <> v_current_stocked_quantity then
    raise exception using
      errcode = '23514',
      message = 'supplier_order_items.stocked_quantity must equal its linked stock-entry quantities.';
  end if;

  return new;
end;
$$;

create constraint trigger supplier_order_items_validate_initial_stocked_quantity
after insert
on public.supplier_order_items
deferrable initially deferred
for each row
when (new.stocked_quantity <> 0)
execute function private.validate_supplier_order_stocked_quantity();

create constraint trigger supplier_order_items_validate_changed_stocked_quantity
after update
on public.supplier_order_items
deferrable initially deferred
for each row
when (old.stocked_quantity is distinct from new.stocked_quantity)
execute function private.validate_supplier_order_stocked_quantity();

create view public.supplier_order_stock_entry_summaries
with (security_invoker = true)
as
select
  entry.id,
  entry.supplier_order_id,
  supplier_order.negotiation_number,
  entry.movement_batch_id,
  batch.movement_type,
  batch.source,
  batch.description as movement_description,
  entry.note,
  entry.created_by,
  entry.created_by_name_snapshot,
  entry.created_at,
  totals.line_count,
  totals.total_quantity
from public.supplier_order_stock_entries as entry
join public.supplier_orders as supplier_order
  on supplier_order.id = entry.supplier_order_id
join public.movement_batches as batch
  on batch.id = entry.movement_batch_id
cross join lateral (
  select
    count(*)::integer as line_count,
    coalesce(sum(entry_line.quantity), 0)::bigint as total_quantity
  from public.supplier_order_stock_entry_lines as entry_line
  where entry_line.supplier_order_stock_entry_id = entry.id
) as totals;

comment on view public.supplier_order_stock_entry_summaries is
  'One row per supplier-order stock entry, including the linked inbound batch and aggregate quantities.';

create view public.supplier_order_stock_entry_line_details
with (security_invoker = true)
as
select
  entry_line.id,
  entry_line.supplier_order_stock_entry_id,
  entry.supplier_order_id,
  entry.movement_batch_id,
  entry.created_at as stock_entry_created_at,
  entry_line.supplier_order_item_id,
  entry_line.inbound_batch_line_id,
  entry_line.quantity,
  entry_line.item_id,
  entry_line.commercial_configuration_id,
  order_item.commercial_configuration_code_id,
  order_item.code_snapshot,
  order_item.description_snapshot,
  order_item.model_snapshot,
  order_item.item_type_snapshot,
  order_item.commercial_code_snapshot,
  entry_line.created_at
from public.supplier_order_stock_entry_lines as entry_line
join public.supplier_order_stock_entries as entry
  on entry.id = entry_line.supplier_order_stock_entry_id
join public.supplier_order_items as order_item
  on order_item.id = entry_line.supplier_order_item_id;

comment on view public.supplier_order_stock_entry_line_details is
  'Stock-entry lines with supplier-order snapshots and direct references to the real inbound audit lines.';

create function private.create_supplier_order_stock_entry(
  p_supplier_order_id uuid,
  p_lines jsonb,
  p_note text,
  p_expected_updated_at timestamptz,
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
  v_note text;
  v_lines jsonb;
  v_request jsonb;
  v_existing_result jsonb;
  v_order public.supplier_orders%rowtype;
  v_order_line record;
  v_requested_line_count integer;
  v_locked_line_count integer := 0;
  v_total_quantity bigint := 0;
  v_available_quantity integer;
  v_stock_code_id uuid;
  v_stock_lines jsonb := '[]'::jsonb;
  v_resolved_lines jsonb := '[]'::jsonb;
  v_movement_description text;
  v_stock_result jsonb;
  v_movement_batch_id uuid;
  v_stock_entry_id uuid;
  v_created_at timestamptz;
  v_inserted_lines integer := 0;
  v_updated_lines integer := 0;
  v_result jsonb;
begin
  if p_supplier_order_id is null
    or p_expected_updated_at is null
    or p_idempotency_key is null
    or p_user_id is null
    or nullif(btrim(p_user_name), '') is null then
    raise exception using
      errcode = '22023',
      message = 'Order, expected updated_at, idempotency key, and authenticated user are required.';
  end if;

  v_note := nullif(btrim(p_note), '');

  if v_note is not null and char_length(v_note) > 500 then
    raise exception using
      errcode = '22023',
      message = 'p_note must contain at most 500 characters.';
  end if;

  v_lines := private.normalize_supplier_order_stock_entry_lines(p_lines);
  v_requested_line_count := jsonb_array_length(v_lines);

  v_request := jsonb_build_object(
    'supplier_order_id', p_supplier_order_id,
    'lines', v_lines,
    'note', v_note,
    'expected_updated_at', p_expected_updated_at
  );

  -- This shared helper acquires the per-user/key advisory transaction lock.
  -- Identical retries return before the optimistic timestamp check.
  v_existing_result := private.supplier_order_existing_result(
    p_user_id,
    p_idempotency_key,
    'STOCK_ENTRY_CREATED',
    v_request
  );

  if v_existing_result is not null then
    return v_existing_result;
  end if;

  -- A movement key without the supplier-order event cannot be adopted by a
  -- different operation, even if its stock payload happens to be equivalent.
  if exists (
    select 1
    from public.movement_batches as batch
    where batch.user_id = p_user_id
      and batch.idempotency_key = p_idempotency_key
  ) then
    raise exception using
      errcode = '22023',
      message = 'p_idempotency_key has already been used by another stock operation.';
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

  if v_order.updated_at is distinct from p_expected_updated_at then
    raise exception using
      errcode = '40001',
      message = 'The supplier order changed after it was loaded. Reload it before creating the stock entry.';
  end if;

  -- The order status and closure metadata are intentionally not eligibility
  -- guards. Only picked_quantity - stocked_quantity authorizes stock entry.
  for v_order_line in
    select
      order_item.id,
      order_item.item_id,
      order_item.commercial_configuration_id,
      order_item.commercial_configuration_code_id,
      order_item.picked_quantity,
      order_item.stocked_quantity,
      requested_line.quantity
    from jsonb_to_recordset(v_lines) as requested_line(
      supplier_order_item_id uuid,
      quantity integer
    )
    join public.supplier_order_items as order_item
      on order_item.id = requested_line.supplier_order_item_id
     and order_item.supplier_order_id = p_supplier_order_id
    order by order_item.id
    for update of order_item
  loop
    v_locked_line_count := v_locked_line_count + 1;
    v_available_quantity :=
      v_order_line.picked_quantity - v_order_line.stocked_quantity;

    if v_order_line.quantity > v_available_quantity then
      raise exception using
        errcode = '22023',
        message = 'The stock-entry quantity cannot exceed the quantity already picked and still awaiting stock entry.';
    end if;

    v_total_quantity := v_total_quantity + v_order_line.quantity;

    if v_total_quantity > 2147483647 then
      raise exception using
        errcode = '22003',
        message = 'The total stock-entry quantity exceeds the PostgreSQL integer range.';
    end if;

    if v_order_line.item_id is not null then
      v_stock_lines := v_stock_lines || jsonb_build_array(
        jsonb_build_object(
          'kind', 'ITEM',
          'item_id', v_order_line.item_id,
          'quantity', v_order_line.quantity
        )
      );

      v_resolved_lines := v_resolved_lines || jsonb_build_array(
        jsonb_build_object(
          'supplier_order_item_id', v_order_line.id,
          'quantity', v_order_line.quantity,
          'item_id', v_order_line.item_id,
          'commercial_configuration_id', null,
          'stock_commercial_code_id', null
        )
      );
    else
      v_stock_code_id := v_order_line.commercial_configuration_code_id;

      -- The existing inbound worker addresses a physical configuration
      -- through one of its aliases. When the order did not preserve a
      -- preferred alias, choose one active alias deterministically; the new
      -- link line remains authoritative for the physical configuration.
      if v_stock_code_id is null then
        select commercial_code.id
        into v_stock_code_id
        from public.commercial_configuration_codes as commercial_code
        where commercial_code.configuration_id =
          v_order_line.commercial_configuration_id
          and commercial_code.is_active
        order by commercial_code.code, commercial_code.id
        limit 1
        for share;

        if not found then
          raise exception using
            errcode = '22023',
            message = 'A commercial configuration awaiting stock entry must have an active commercial code.';
        end if;
      end if;

      v_stock_lines := v_stock_lines || jsonb_build_array(
        jsonb_build_object(
          'kind', 'COMMERCIAL_CODE',
          'commercial_code_id', v_stock_code_id,
          'quantity', v_order_line.quantity
        )
      );

      v_resolved_lines := v_resolved_lines || jsonb_build_array(
        jsonb_build_object(
          'supplier_order_item_id', v_order_line.id,
          'quantity', v_order_line.quantity,
          'item_id', null,
          'commercial_configuration_id',
            v_order_line.commercial_configuration_id,
          'stock_commercial_code_id', v_stock_code_id
        )
      );
    end if;
  end loop;

  if v_locked_line_count <> v_requested_line_count then
    raise exception using
      errcode = '22023',
      message = 'Every stock-entry line must belong to the informed supplier order.';
  end if;

  v_movement_description :=
    'Entrada pelo pedido ' || v_order.negotiation_number;

  if v_note is not null then
    v_movement_description := v_movement_description || ' - ' || v_note;
  end if;

  -- Reuse the approved mixed-inbound worker. It creates the normal INBOUND /
  -- MANUAL batch, audit lines, locks, movements, and balance updates.
  v_stock_result := private.stock_inbound_lines(
    v_stock_lines,
    p_idempotency_key,
    p_user_id,
    btrim(p_user_name),
    v_movement_description
  );

  v_movement_batch_id :=
    (v_stock_result ->> 'movement_batch_id')::uuid;

  insert into public.supplier_order_stock_entries (
    supplier_order_id,
    movement_batch_id,
    note,
    created_by,
    created_by_name_snapshot
  )
  values (
    p_supplier_order_id,
    v_movement_batch_id,
    v_note,
    p_user_id,
    btrim(p_user_name)
  )
  returning id, created_at
  into v_stock_entry_id, v_created_at;

  insert into public.supplier_order_stock_entry_lines (
    supplier_order_stock_entry_id,
    supplier_order_item_id,
    inbound_batch_line_id,
    quantity,
    item_id,
    commercial_configuration_id
  )
  select
    v_stock_entry_id,
    resolved_line.supplier_order_item_id,
    inbound_line.id,
    resolved_line.quantity,
    resolved_line.item_id,
    resolved_line.commercial_configuration_id
  from jsonb_to_recordset(v_resolved_lines) as resolved_line(
    supplier_order_item_id uuid,
    quantity integer,
    item_id uuid,
    commercial_configuration_id uuid,
    stock_commercial_code_id uuid
  )
  join public.inbound_batch_lines as inbound_line
    on inbound_line.batch_id = v_movement_batch_id
   and (
     (
       resolved_line.item_id is not null
       and inbound_line.item_id = resolved_line.item_id
     )
     or
     (
       resolved_line.commercial_configuration_id is not null
       and inbound_line.commercial_configuration_code_id =
         resolved_line.stock_commercial_code_id
     )
   )
  order by resolved_line.supplier_order_item_id;

  get diagnostics v_inserted_lines = row_count;

  if v_inserted_lines <> v_requested_line_count then
    raise exception using
      errcode = '23514',
      message = 'Could not link every supplier-order line to its real inbound batch line.';
  end if;

  update public.supplier_order_items as order_item
  set stocked_quantity =
    order_item.stocked_quantity + resolved_line.quantity
  from jsonb_to_recordset(v_resolved_lines) as resolved_line(
    supplier_order_item_id uuid,
    quantity integer,
    item_id uuid,
    commercial_configuration_id uuid,
    stock_commercial_code_id uuid
  )
  where order_item.id = resolved_line.supplier_order_item_id
    and order_item.supplier_order_id = p_supplier_order_id;

  get diagnostics v_updated_lines = row_count;

  if v_updated_lines <> v_requested_line_count then
    raise exception using
      errcode = '23514',
      message = 'Could not update every supplier-order stocked quantity.';
  end if;

  update public.supplier_orders
  set updated_at = now()
  where id = p_supplier_order_id;

  v_result := private.supplier_order_result(p_supplier_order_id)
    || jsonb_build_object(
      'supplier_order_stock_entry_id', v_stock_entry_id,
      'movement_batch_id', v_movement_batch_id,
      'stock_entry_line_count', v_requested_line_count,
      'stock_entry_quantity', v_total_quantity,
      'stock_entry_created_at', v_created_at
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
    'STOCK_ENTRY_CREATED',
    p_user_id,
    btrim(p_user_name),
    p_idempotency_key,
    v_note,
    jsonb_build_object(
      'request', v_request,
      'result', v_result,
      'movement_batch_id', v_movement_batch_id,
      'supplier_order_stock_entry_id', v_stock_entry_id,
      'line_count', v_requested_line_count,
      'total_quantity', v_total_quantity
    )
  );

  return v_result;
end;
$$;

create function public.create_supplier_order_stock_entry(
  p_supplier_order_id uuid,
  p_lines jsonb,
  p_note text,
  p_expected_updated_at timestamptz,
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

  return private.create_supplier_order_stock_entry(
    p_supplier_order_id,
    p_lines,
    p_note,
    p_expected_updated_at,
    p_idempotency_key,
    v_user.user_id,
    v_user.user_name
  );
end;
$$;

alter table public.supplier_order_stock_entries enable row level security;
alter table public.supplier_order_stock_entry_lines enable row level security;

create policy supplier_order_stock_entries_select_active_users
on public.supplier_order_stock_entries
for select
to authenticated
using ((select private.is_active_profile()));

create policy supplier_order_stock_entry_lines_select_active_users
on public.supplier_order_stock_entry_lines
for select
to authenticated
using ((select private.is_active_profile()));

revoke all privileges on table
  public.supplier_order_stock_entries,
  public.supplier_order_stock_entry_lines
from public, anon, authenticated;

grant select on table
  public.supplier_order_stock_entries,
  public.supplier_order_stock_entry_lines
to authenticated;

revoke all privileges on
  public.supplier_order_stock_entry_summaries,
  public.supplier_order_stock_entry_line_details
from public, anon, authenticated;

grant select on
  public.supplier_order_stock_entry_summaries,
  public.supplier_order_stock_entry_line_details
to authenticated;

revoke all on function private.normalize_supplier_order_stock_entry_lines(jsonb)
from public, anon, authenticated;

revoke all on function private.validate_supplier_order_stock_entry_links()
from public, anon, authenticated;

revoke all on function private.validate_supplier_order_stocked_quantity()
from public, anon, authenticated;

revoke all on function private.create_supplier_order_stock_entry(
  uuid,
  jsonb,
  text,
  timestamptz,
  uuid,
  uuid,
  text
) from public, anon, authenticated;

revoke all on function public.create_supplier_order_stock_entry(
  uuid,
  jsonb,
  text,
  timestamptz,
  uuid
) from public, anon, authenticated;

grant execute on function public.create_supplier_order_stock_entry(
  uuid,
  jsonb,
  text,
  timestamptz,
  uuid
) to authenticated;

comment on function public.create_supplier_order_stock_entry(
  uuid,
  jsonb,
  text,
  timestamptz,
  uuid
) is
  'Creates one idempotent supplier-order stock entry. Client lines contain only supplier_order_item_id and quantity.';

comment on column public.supplier_order_items.stocked_quantity is
  'Total quantity entered through create_supplier_order_stock_entry. Available quantity is picked_quantity minus stocked_quantity.';
