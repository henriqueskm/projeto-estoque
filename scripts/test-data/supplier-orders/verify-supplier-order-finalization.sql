-- Administrative verification only. Review before running manually.
-- Every fixture and mutation is enclosed by one transaction and rolled back.
begin;

create temporary table supplier_order_finalization_context (
  user_id uuid not null,
  user_name text not null,
  item_id uuid not null,
  item_code text not null,
  item_description text not null,
  item_type text not null,
  pending_order_id uuid not null default gen_random_uuid(),
  partial_order_id uuid not null default gen_random_uuid(),
  completed_order_id uuid not null default gen_random_uuid(),
  stale_order_id uuid not null default gen_random_uuid(),
  cancelled_order_id uuid not null default gen_random_uuid(),
  whitespace_order_id uuid not null default gen_random_uuid(),
  active_completed_order_id uuid not null default gen_random_uuid(),
  finalize_key uuid not null default gen_random_uuid()
) on commit drop;

insert into supplier_order_finalization_context (
  user_id,
  user_name,
  item_id,
  item_code,
  item_description,
  item_type
)
select
  profile.id,
  btrim(profile.name),
  item.id,
  item.code,
  item.description,
  item.item_type
from lateral (
  select id, name
  from public.profiles
  where is_active
    and nullif(btrim(name), '') is not null
  order by id
  limit 1
) as profile
cross join lateral (
  select id, code, description, item_type
  from public.items
  where is_active
  order by code, id
  limit 1
) as item;

do $$
begin
  if (select count(*) from supplier_order_finalization_context) <> 1 then
    raise exception
      'Preflight failed: one active named profile and one active item are required.';
  end if;
end;
$$;

create temporary table supplier_order_finalization_stock_baseline
on commit drop
as
select jsonb_build_object(
  'movement_batches', (
    select count(*) from public.movement_batches
  ),
  'stock_movements', (
    select count(*) from public.stock_movements
  ),
  'configuration_stock_movements', (
    select count(*) from public.configuration_stock_movements
  ),
  'assembly_operations', (
    select count(*) from public.assembly_operations
  ),
  'inbound_batch_lines', (
    select count(*) from public.inbound_batch_lines
  ),
  'outbound_batch_lines', (
    select count(*) from public.outbound_batch_lines
  ),
  'stock_balances', (
    select jsonb_build_object(
      'count', count(*),
      'quantity', coalesce(sum(quantity), 0),
      'signature', md5(
        coalesce(
          string_agg(
            item_id::text || ':' || quantity::text || ':' || updated_at::text,
            ',' order by item_id
          ),
          ''
        )
      )
    )
    from public.stock_balances
  ),
  'configuration_stock_balances', (
    select jsonb_build_object(
      'count', count(*),
      'quantity', coalesce(sum(quantity), 0),
      'signature', md5(
        coalesce(
          string_agg(
            configuration_id::text
              || ':' || quantity::text
              || ':' || updated_at::text,
            ',' order by configuration_id
          ),
          ''
        )
      )
    )
    from public.configuration_stock_balances
  )
) as signature;

insert into public.supplier_orders (
  id,
  negotiation_number,
  order_date,
  notes,
  created_by,
  created_by_name_snapshot,
  cancelled_at,
  cancelled_by,
  cancelled_by_name_snapshot,
  cancellation_note
)
select
  fixture.order_id,
  fixture.negotiation_number,
  current_date,
  'Administrative finalization verification',
  context.user_id,
  context.user_name,
  fixture.cancelled_at,
  case when fixture.cancelled_at is null then null else context.user_id end,
  case when fixture.cancelled_at is null then null else context.user_name end,
  case when fixture.cancelled_at is null then null else 'Cancelled fixture' end
from supplier_order_finalization_context as context
cross join lateral (
  values
    (
      context.pending_order_id,
      '930001',
      null::timestamptz
    ),
    (
      context.partial_order_id,
      '930002',
      null::timestamptz
    ),
    (
      context.completed_order_id,
      '930003',
      null::timestamptz
    ),
    (
      context.stale_order_id,
      '930004',
      null::timestamptz
    ),
    (
      context.cancelled_order_id,
      '930005',
      now()
    ),
    (
      context.whitespace_order_id,
      '930006',
      null::timestamptz
    ),
    (
      context.active_completed_order_id,
      '930007',
      null::timestamptz
    )
) as fixture(order_id, negotiation_number, cancelled_at);

insert into public.supplier_order_items (
  supplier_order_id,
  item_id,
  code_snapshot,
  description_snapshot,
  item_type_snapshot,
  ordered_quantity,
  ready_quantity,
  picked_quantity,
  stocked_quantity,
  cancelled_quantity,
  position
)
select
  fixture.order_id,
  context.item_id,
  context.item_code,
  context.item_description,
  context.item_type,
  fixture.ordered_quantity,
  fixture.picked_quantity,
  fixture.picked_quantity,
  fixture.stocked_quantity,
  fixture.cancelled_quantity,
  0
from supplier_order_finalization_context as context
cross join lateral (
  values
    (context.pending_order_id, 2, 0, 0, 0),
    (context.partial_order_id, 2, 1, 0, 0),
    (context.completed_order_id, 2, 2, 0, 0),
    (context.stale_order_id, 1, 1, 1, 0),
    (context.cancelled_order_id, 2, 0, 0, 2),
    (context.whitespace_order_id, 1, 1, 0, 0),
    (context.active_completed_order_id, 1, 1, 0, 0)
) as fixture(
  order_id,
  ordered_quantity,
  picked_quantity,
  stocked_quantity,
  cancelled_quantity
);

create temporary table supplier_order_finalization_results (
  test_name text primary key,
  result jsonb not null
) on commit drop;

create function pg_temp.expect_supplier_order_finalization_error(
  p_statement text,
  p_message_fragment text default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  begin
    execute p_statement;
  exception
    when others then
      if p_message_fragment is not null
        and position(lower(p_message_fragment) in lower(sqlerrm)) = 0 then
        raise exception
          'Expected error containing "%", received "%".',
          p_message_fragment,
          sqlerrm;
      end if;

      return;
  end;

  raise exception 'Expected statement to fail, but it succeeded.';
end;
$$;

grant all on table supplier_order_finalization_context to authenticated;
grant all on table supplier_order_finalization_results to authenticated;
grant execute on function pg_temp.expect_supplier_order_finalization_error(
  text,
  text
) to authenticated;

set local role authenticated;

select set_config(
  'request.jwt.claim.sub',
  (select user_id::text from supplier_order_finalization_context),
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

-- A-D: successful manual finalization, snapshots, event, and summary fields.
insert into supplier_order_finalization_results (test_name, result)
select
  'first_finalize',
  public.finalize_supplier_order(
    summary.id,
    summary.updated_at,
    '  Manual closure with stock entry still pending  ',
    context.finalize_key
  )
from public.supplier_order_summaries as summary
cross join supplier_order_finalization_context as context
where summary.id = context.completed_order_id;

do $$
declare
  v_context supplier_order_finalization_context%rowtype;
  v_result jsonb;
begin
  select * into v_context
  from supplier_order_finalization_context;

  select result into v_result
  from supplier_order_finalization_results
  where test_name = 'first_finalize';

  if (v_result ->> 'supplier_order_id')::uuid
      is distinct from v_context.completed_order_id
    or v_result ->> 'status' <> 'COMPLETED'
    or (v_result ->> 'waiting_pickup_quantity')::bigint <> 0
    or (v_result ->> 'waiting_stock_quantity')::bigint <> 2
    or (v_result ->> 'is_finalized')::boolean is not true
    or (v_result ->> 'is_active_order')::boolean is not false
    or (v_result ->> 'is_in_history')::boolean is not true
    or v_result ->> 'closure_kind' <> 'FINALIZED' then
    raise exception 'A failed: the finalization result is inconsistent.';
  end if;

  if not exists (
    select 1
    from public.supplier_orders
    where id = v_context.completed_order_id
      and finalized_at is not null
      and finalized_by = v_context.user_id
      and finalized_by_name_snapshot = v_context.user_name
      and finalization_note = 'Manual closure with stock entry still pending'
  ) then
    raise exception 'B failed: finalization snapshots were not persisted.';
  end if;

  if (
    select count(*)
    from public.supplier_order_events
    where supplier_order_id = v_context.completed_order_id
      and event_type = 'ORDER_FINALIZED'
      and user_id = v_context.user_id
      and user_name_snapshot = v_context.user_name
      and idempotency_key = v_context.finalize_key
      and details -> 'request' ->> 'finalization_note'
        = 'Manual closure with stock entry still pending'
      and details -> 'result' = v_result
  ) <> 1 then
    raise exception 'C failed: ORDER_FINALIZED audit is inconsistent.';
  end if;

  if not exists (
    select 1
    from public.supplier_order_summaries
    where id = v_context.completed_order_id
      and status = 'COMPLETED'
      and is_finalized
      and not is_active_order
      and is_in_history
      and closure_kind = 'FINALIZED'
      and closed_at = finalized_at
      and closed_by_name_snapshot = v_context.user_name
  ) then
    raise exception 'D failed: centralized closure classification is inconsistent.';
  end if;

  if (
    select ordered_quantity
    from public.supplier_order_items
    where supplier_order_id = v_context.completed_order_id
  ) <> 2 then
    raise exception 'F failed: finalization changed ordered_quantity.';
  end if;

  if (
    select picked_quantity
    from public.supplier_order_items
    where supplier_order_id = v_context.completed_order_id
  ) <> 2 then
    raise exception 'G failed: finalization changed picked_quantity.';
  end if;

  if (
    select cancelled_quantity
    from public.supplier_order_items
    where supplier_order_id = v_context.completed_order_id
  ) <> 0 then
    raise exception 'H failed: finalization changed cancelled_quantity.';
  end if;

  if (
    select stocked_quantity
    from public.supplier_order_items
    where supplier_order_id = v_context.completed_order_id
  ) <> 0 then
    raise exception 'I failed: finalization changed stocked_quantity.';
  end if;
end;
$$;

-- E: an identical retry returns the original result without another event.
insert into supplier_order_finalization_results (test_name, result)
select
  'identical_retry',
  public.finalize_supplier_order(
    context.completed_order_id,
    (
      select (event.details -> 'request' ->> 'expected_updated_at')::timestamptz
      from public.supplier_order_events as event
      where event.user_id = context.user_id
        and event.idempotency_key = context.finalize_key
    ),
    'Manual closure with stock entry still pending',
    context.finalize_key
  )
from supplier_order_finalization_context as context;

do $$
begin
  if (
    select result
    from supplier_order_finalization_results
    where test_name = 'identical_retry'
  ) is distinct from (
    select result
    from supplier_order_finalization_results
    where test_name = 'first_finalize'
  ) then
    raise exception 'E failed: identical retry returned a different result.';
  end if;

  if (
    select count(*)
    from public.supplier_order_events
    where supplier_order_id = (
      select completed_order_id
      from supplier_order_finalization_context
    )
      and event_type = 'ORDER_FINALIZED'
  ) <> 1 then
    raise exception 'E failed: identical retry created another event.';
  end if;
end;
$$;

-- F-G: same key with another request and a new key after closure are rejected.
select pg_temp.expect_supplier_order_finalization_error(
  format(
    'select public.finalize_supplier_order(%L::uuid, %L::timestamptz, %L, %L::uuid)',
    context.completed_order_id,
    event.details -> 'request' ->> 'expected_updated_at',
    'Different note',
    context.finalize_key
  ),
  'different supplier-order request'
)
from supplier_order_finalization_context as context
join public.supplier_order_events as event
  on event.user_id = context.user_id
  and event.idempotency_key = context.finalize_key;

select pg_temp.expect_supplier_order_finalization_error(
  format(
    'select public.finalize_supplier_order(%L::uuid, %L::timestamptz, null, %L::uuid)',
    summary.id,
    summary.updated_at,
    gen_random_uuid()
  ),
  'finalized supplier order'
)
from public.supplier_order_summaries as summary
cross join supplier_order_finalization_context as context
where summary.id = context.completed_order_id;

-- H-M: missing/null/stale parameters and note length validation.
select pg_temp.expect_supplier_order_finalization_error(
  format(
    'select public.finalize_supplier_order(%L::uuid, now(), null, %L::uuid)',
    gen_random_uuid(),
    gen_random_uuid()
  ),
  'does not exist'
);

select pg_temp.expect_supplier_order_finalization_error(
  format(
    'select public.finalize_supplier_order(null, now(), null, %L::uuid)',
    gen_random_uuid()
  ),
  'required'
);

select pg_temp.expect_supplier_order_finalization_error(
  format(
    'select public.finalize_supplier_order(%L::uuid, null, null, %L::uuid)',
    pending_order_id,
    gen_random_uuid()
  ),
  'required'
)
from supplier_order_finalization_context;

select pg_temp.expect_supplier_order_finalization_error(
  format(
    'select public.finalize_supplier_order(%L::uuid, %L::timestamptz, null, %L::uuid)',
    summary.id,
    summary.updated_at - interval '1 second',
    gen_random_uuid()
  ),
  'changed after it was loaded'
)
from public.supplier_order_summaries as summary
cross join supplier_order_finalization_context as context
where summary.id = context.stale_order_id;

select pg_temp.expect_supplier_order_finalization_error(
  format(
    'select public.finalize_supplier_order(%L::uuid, %L::timestamptz, null, null)',
    summary.id,
    summary.updated_at
  ),
  'required'
)
from public.supplier_order_summaries as summary
cross join supplier_order_finalization_context as context
where summary.id = context.stale_order_id;

select pg_temp.expect_supplier_order_finalization_error(
  format(
    'select public.finalize_supplier_order(%L::uuid, %L::timestamptz, %L, %L::uuid)',
    summary.id,
    summary.updated_at,
    repeat('x', 501),
    gen_random_uuid()
  ),
  'at most 500'
)
from public.supplier_order_summaries as summary
cross join supplier_order_finalization_context as context
where summary.id = context.stale_order_id;

-- N-Q: PENDING, PARTIAL, and CANCELLED cannot be finalized.
select pg_temp.expect_supplier_order_finalization_error(
  format(
    'select public.finalize_supplier_order(%L::uuid, %L::timestamptz, null, %L::uuid)',
    summary.id,
    summary.updated_at,
    gen_random_uuid()
  ),
  'only a completed'
)
from public.supplier_order_summaries as summary
cross join supplier_order_finalization_context as context
where summary.id = context.pending_order_id;

select pg_temp.expect_supplier_order_finalization_error(
  format(
    'select public.finalize_supplier_order(%L::uuid, %L::timestamptz, null, %L::uuid)',
    summary.id,
    summary.updated_at,
    gen_random_uuid()
  ),
  'only a completed'
)
from public.supplier_order_summaries as summary
cross join supplier_order_finalization_context as context
where summary.id = context.partial_order_id;

select pg_temp.expect_supplier_order_finalization_error(
  format(
    'select public.finalize_supplier_order(%L::uuid, %L::timestamptz, null, %L::uuid)',
    summary.id,
    summary.updated_at,
    gen_random_uuid()
  ),
  'cancelled'
)
from public.supplier_order_summaries as summary
cross join supplier_order_finalization_context as context
where summary.id = context.cancelled_order_id;

do $$
begin
  if not exists (
    select 1
    from public.supplier_order_summaries as summary
    cross join supplier_order_finalization_context as context
    where summary.id = context.cancelled_order_id
      and summary.status = 'CANCELLED'
      and not summary.is_active_order
      and summary.is_in_history
      and summary.closure_kind = 'CANCELLED'
  ) then
    raise exception 'Q failed: cancelled-order history classification is inconsistent.';
  end if;

  if exists (
    select 1
    from public.supplier_order_summaries as summary
    cross join supplier_order_finalization_context as context
    where summary.id in (context.pending_order_id, context.partial_order_id)
      and summary.is_in_history
  ) then
    raise exception 'T/U failed: a pending or partial order entered history.';
  end if;

  if not exists (
    select 1
    from public.supplier_order_summaries as summary
    cross join supplier_order_finalization_context as context
    where summary.id = context.active_completed_order_id
      and summary.status = 'COMPLETED'
      and summary.is_active_order
      and not summary.is_finalized
      and not summary.is_in_history
  ) then
    raise exception 'V failed: a non-finalized completed order is not active.';
  end if;
end;
$$;

-- R-S: active named profile succeeds; missing/inactive profile context fails.
select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);

select pg_temp.expect_supplier_order_finalization_error(
  format(
    'select public.finalize_supplier_order(%L::uuid, %L::timestamptz, null, %L::uuid)',
    context.stale_order_id,
    now(),
    gen_random_uuid()
  ),
  'active profile'
)
from supplier_order_finalization_context as context;

select set_config(
  'request.jwt.claim.sub',
  (select user_id::text from supplier_order_finalization_context),
  true
);

-- T-U: only authenticated can execute the public wrapper; clients cannot call private helpers.
reset role;

do $$
begin
  if not has_function_privilege(
    'authenticated',
    'public.finalize_supplier_order(uuid,timestamptz,text,uuid)',
    'EXECUTE'
  ) then
    raise exception 'T failed: authenticated lacks EXECUTE on the public wrapper.';
  end if;

  if has_function_privilege(
    'anon',
    'public.finalize_supplier_order(uuid,timestamptz,text,uuid)',
    'EXECUTE'
  ) or exists (
    select 1
    from information_schema.routine_privileges
    where specific_schema = 'public'
      and routine_name = 'finalize_supplier_order'
      and grantee = 'PUBLIC'
      and privilege_type = 'EXECUTE'
  ) then
    raise exception 'T failed: anon or PUBLIC can execute the public wrapper.';
  end if;

  if exists (
    select 1
    from information_schema.routine_privileges
    where specific_schema = 'private'
      and routine_name = 'finalize_supplier_order'
      and grantee in ('PUBLIC', 'anon', 'authenticated')
      and privilege_type = 'EXECUTE'
  ) then
    raise exception 'U failed: a client role can execute the private worker.';
  end if;
end;
$$;

set local role authenticated;

select pg_temp.expect_supplier_order_finalization_error(
  format(
    'select private.finalize_supplier_order(%L::uuid, now(), null, %L::uuid, %L::uuid, %L)',
    completed_order_id,
    gen_random_uuid(),
    user_id,
    user_name
  ),
  null
)
from supplier_order_finalization_context;

-- V: direct table updates remain blocked by privileges and RLS.
select pg_temp.expect_supplier_order_finalization_error(
  format(
    'update public.supplier_orders set finalization_note = %L where id = %L::uuid',
    'Direct write',
    completed_order_id
  ),
  null
)
from supplier_order_finalization_context;

-- W-AA: all current operational mutations reject a finalized order.
select pg_temp.expect_supplier_order_finalization_error(
  format(
    'select public.update_supplier_order(%L::uuid, %L::timestamptz, %L, current_date, null, %L::jsonb, %L::uuid)',
    summary.id,
    summary.updated_at,
    summary.negotiation_number,
    jsonb_build_array(
      jsonb_build_object(
        'id', order_item.id,
        'kind', 'ITEM',
        'item_id', order_item.item_id,
        'quantity', order_item.ordered_quantity
      )
    )::text,
    gen_random_uuid()
  ),
  'finalized supplier order'
)
from public.supplier_order_summaries as summary
join public.supplier_order_items as order_item
  on order_item.supplier_order_id = summary.id
cross join supplier_order_finalization_context as context
where summary.id = context.completed_order_id;

select pg_temp.expect_supplier_order_finalization_error(
  format(
    'select public.set_supplier_order_item_picked_quantity(%L::uuid, %s, null, %L::uuid)',
    order_item.id,
    order_item.picked_quantity,
    gen_random_uuid()
  ),
  'finalized supplier order'
)
from public.supplier_order_items as order_item
cross join supplier_order_finalization_context as context
where order_item.supplier_order_id = context.completed_order_id;

select pg_temp.expect_supplier_order_finalization_error(
  format(
    'select public.mark_supplier_order_all_picked(%L::uuid, null, %L::uuid)',
    completed_order_id,
    gen_random_uuid()
  ),
  'finalized supplier order'
)
from supplier_order_finalization_context;

select pg_temp.expect_supplier_order_finalization_error(
  format(
    'select public.cancel_supplier_order(%L::uuid, %L, %L::uuid)',
    completed_order_id,
    'Teste de cancelamento.',
    gen_random_uuid()
  ),
  'finalized supplier order'
)
from supplier_order_finalization_context;

select pg_temp.expect_supplier_order_finalization_error(
  format(
    'select public.cancel_supplier_order_remaining(%L::uuid, %L, %L::uuid)',
    completed_order_id,
    'Teste de cancelamento.',
    gen_random_uuid()
  ),
  'finalized supplier order'
)
from supplier_order_finalization_context;

reset role;

-- AB-AC: view fields are coherent and active/history sets are disjoint.
do $$
begin
  if exists (
    select 1
    from public.supplier_order_summaries
    where is_active_order and is_in_history
  ) then
    raise exception 'AB failed: active and history classifications overlap.';
  end if;

  if not exists (
    select 1
    from public.supplier_order_summaries as summary
    cross join supplier_order_finalization_context as context
    where summary.id = context.pending_order_id
      and summary.is_active_order
      and not summary.is_finalized
      and not summary.is_in_history
      and summary.closure_kind is null
      and summary.closed_at is null
      and summary.closed_by_name_snapshot is null
  ) then
    raise exception 'AC failed: an active order has inconsistent closure fields.';
  end if;
end;
$$;

-- AD-AF: stock is untouched, stock-entry backlog remains visible, and status has no FINALIZED value.
do $$
declare
  v_after jsonb;
begin
  select jsonb_build_object(
    'movement_batches', (
      select count(*) from public.movement_batches
    ),
    'stock_movements', (
      select count(*) from public.stock_movements
    ),
    'configuration_stock_movements', (
      select count(*) from public.configuration_stock_movements
    ),
    'assembly_operations', (
      select count(*) from public.assembly_operations
    ),
    'inbound_batch_lines', (
      select count(*) from public.inbound_batch_lines
    ),
    'outbound_batch_lines', (
      select count(*) from public.outbound_batch_lines
    ),
    'stock_balances', (
      select jsonb_build_object(
        'count', count(*),
        'quantity', coalesce(sum(quantity), 0),
        'signature', md5(
          coalesce(
            string_agg(
              item_id::text || ':' || quantity::text || ':' || updated_at::text,
              ',' order by item_id
            ),
            ''
          )
        )
      )
      from public.stock_balances
    ),
    'configuration_stock_balances', (
      select jsonb_build_object(
        'count', count(*),
        'quantity', coalesce(sum(quantity), 0),
        'signature', md5(
          coalesce(
            string_agg(
              configuration_id::text
                || ':' || quantity::text
                || ':' || updated_at::text,
              ',' order by configuration_id
            ),
            ''
          )
        )
      )
      from public.configuration_stock_balances
    )
  )
  into v_after;

  if v_after is distinct from (
    select signature
    from supplier_order_finalization_stock_baseline
  ) then
    raise exception 'AD failed: finalization changed inventory or stock audit.';
  end if;

  if not exists (
    select 1
    from public.supplier_order_summaries as summary
    cross join supplier_order_finalization_context as context
    where summary.id = context.completed_order_id
      and summary.is_finalized
      and summary.waiting_stock_quantity = 2
  ) then
    raise exception 'AE failed: pending stock entry was hidden by finalization.';
  end if;

  if exists (
    select 1
    from public.supplier_order_summaries
    where status = 'FINALIZED'
  ) then
    raise exception 'AF failed: FINALIZED was introduced as an operational status.';
  end if;
end;
$$;

-- AG: the concurrency contract combines the existing unique ledger with an advisory lock.
do $$
begin
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'supplier_order_events_user_id_idempotency_key_uidx'
      and indexdef ilike '%unique%'
  ) then
    raise exception 'AG failed: the unique idempotency ledger is missing.';
  end if;

  if position(
    'pg_advisory_xact_lock'
    in pg_get_functiondef(
      'private.supplier_order_existing_result(uuid,uuid,text,jsonb)'::regprocedure
    )
  ) = 0 then
    raise exception 'AG failed: the per-user/key advisory lock is missing.';
  end if;
end;
$$;

-- AI-AJ: finalization metadata is atomic and partial states are rejected.
do $$
begin
  if not exists (
    select 1
    from public.supplier_orders as supplier_order
    cross join supplier_order_finalization_context as context
    where supplier_order.id = context.completed_order_id
      and supplier_order.finalized_at is not null
      and supplier_order.finalized_by is not null
      and nullif(
        btrim(supplier_order.finalized_by_name_snapshot),
        ''
      ) is not null
  ) then
    raise exception 'AI failed: finalization metadata was not filled atomically.';
  end if;

  perform pg_temp.expect_supplier_order_finalization_error(
    format(
      'update public.supplier_orders set finalized_at = now() where id = %L::uuid',
      context.pending_order_id
    ),
    null
  )
  from supplier_order_finalization_context as context;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.supplier_orders'::regclass
      and conname = 'supplier_orders_finalization_metadata_check'
      and contype = 'c'
  ) then
    raise exception 'AJ failed: finalization metadata constraint is missing.';
  end if;
end;
$$;

-- AK-AL: NULL notes work and whitespace-only notes normalize to NULL.
set local role authenticated;

insert into supplier_order_finalization_results (test_name, result)
select
  'null_note_finalize',
  public.finalize_supplier_order(
    summary.id,
    summary.updated_at,
    null,
    gen_random_uuid()
  )
from public.supplier_order_summaries as summary
cross join supplier_order_finalization_context as context
where summary.id = context.stale_order_id;

insert into supplier_order_finalization_results (test_name, result)
select
  'whitespace_note_finalize',
  public.finalize_supplier_order(
    summary.id,
    summary.updated_at,
    '     ',
    gen_random_uuid()
  )
from public.supplier_order_summaries as summary
cross join supplier_order_finalization_context as context
where summary.id = context.whitespace_order_id;

reset role;

do $$
begin
  if exists (
    select 1
    from public.supplier_orders as supplier_order
    cross join supplier_order_finalization_context as context
    where supplier_order.id in (
      context.stale_order_id,
      context.whitespace_order_id
    )
      and (
        supplier_order.finalized_at is null
        or supplier_order.finalization_note is not null
      )
  ) then
    raise exception 'AK/AL failed: an optional empty note was not stored as NULL.';
  end if;
end;
$$;

-- AM-AP: note limit and active/history classifications remain coherent.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.supplier_orders'::regclass
      and conname = 'supplier_orders_finalization_note_check'
      and pg_get_constraintdef(oid) ilike '%500%'
  ) then
    raise exception 'AM failed: the 500-character note limit is missing.';
  end if;

  if exists (
    select 1
    from public.supplier_order_summaries as summary
    cross join supplier_order_finalization_context as context
    where summary.id = context.completed_order_id
      and summary.is_active_order
  ) then
    raise exception 'AN failed: a finalized order remains active.';
  end if;

  if not exists (
    select 1
    from public.supplier_order_summaries as summary
    cross join supplier_order_finalization_context as context
    where summary.id = context.cancelled_order_id
      and summary.finalized_at is null
      and summary.is_in_history
      and not summary.is_active_order
      and summary.closure_kind = 'CANCELLED'
  ) then
    raise exception 'AO failed: a cancelled order is not history-only.';
  end if;

  if not exists (
    select 1
    from public.supplier_order_summaries as summary
    cross join supplier_order_finalization_context as context
    where summary.id = context.active_completed_order_id
      and summary.status = 'COMPLETED'
      and summary.finalized_at is null
      and summary.is_active_order
      and not summary.is_in_history
  ) then
    raise exception 'AP failed: a non-finalized completed order is not active-only.';
  end if;
end;
$$;

-- AQ-AR: retry preserves the original timestamp and exactly one finalization event.
do $$
declare
  v_first_result jsonb;
  v_retry_result jsonb;
begin
  select result into v_first_result
  from supplier_order_finalization_results
  where test_name = 'first_finalize';

  select result into v_retry_result
  from supplier_order_finalization_results
  where test_name = 'identical_retry';

  if v_first_result ->> 'finalized_at'
    is distinct from v_retry_result ->> 'finalized_at' then
    raise exception 'AQ failed: retry changed finalized_at.';
  end if;

  if (
    select count(*)
    from public.supplier_order_events as event
    cross join supplier_order_finalization_context as context
    where event.supplier_order_id = context.completed_order_id
      and event.event_type = 'ORDER_FINALIZED'
  ) <> 1 then
    raise exception 'AR failed: retry did not preserve exactly one event.';
  end if;
end;
$$;

-- AS: the finalizer profile cannot be physically deleted.
do $$
declare
  v_constraint_name text;
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.supplier_orders'::regclass
      and conname = 'supplier_orders_finalized_by_fkey'
      and confdeltype = 'r'
  ) then
    raise exception 'AS failed: finalized_by is not ON DELETE RESTRICT.';
  end if;

  begin
    delete from public.profiles
    where id = (
      select user_id
      from supplier_order_finalization_context
    );

    raise exception 'AS failed: the finalizer profile was physically deleted.';
  exception
    when foreign_key_violation then
      get stacked diagnostics v_constraint_name = constraint_name;

      if v_constraint_name <> 'supplier_orders_finalized_by_fkey' then
        raise exception
          'AS failed: deletion was rejected by unexpected constraint %.',
          v_constraint_name;
      end if;
  end;
end;
$$;

-- AT: changing the current profile name never rewrites the stored snapshot.
do $$
declare
  v_user_id uuid;
  v_original_name text;
begin
  select user_id, user_name
  into v_user_id, v_original_name
  from supplier_order_finalization_context;

  update public.profiles
  set name = 'TEMP'
  where id = v_user_id;

  if (
    select finalized_by_name_snapshot
    from public.supplier_orders
    where id = (
      select completed_order_id
      from supplier_order_finalization_context
    )
  ) is distinct from v_original_name then
    raise exception 'AT failed: profile rename changed the finalization snapshot.';
  end if;

  update public.profiles
  set name = v_original_name
  where id = v_user_id;
end;
$$;

-- AH: reaching this point means all controlled writes are ready for total rollback.
select
  'A-AT supplier-order finalization checks passed; all writes will now roll back.'
    as verification_result;

rollback;
