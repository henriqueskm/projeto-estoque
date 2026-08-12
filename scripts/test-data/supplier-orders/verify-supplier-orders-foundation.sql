-- Administrative verification only. Run manually after reviewing the migration.
-- Every catalog/order write in this script is enclosed by this transaction.
begin;

create temporary table supplier_order_test_context (
  user_id uuid not null,
  physical_item_id uuid not null,
  alternate_item_id uuid not null,
  shared_configuration_id uuid not null,
  commercial_code_1b_id uuid not null,
  commercial_code_1d_id uuid not null,
  alternate_configuration_id uuid not null,
  alternate_commercial_code_id uuid not null,
  physical_order_id uuid,
  physical_line_id uuid,
  configuration_order_id uuid,
  cancellation_order_id uuid,
  create_key uuid not null default gen_random_uuid(),
  configuration_create_key uuid not null default gen_random_uuid(),
  cancellation_create_key uuid not null default gen_random_uuid()
) on commit drop;

insert into supplier_order_test_context (
  user_id,
  physical_item_id,
  alternate_item_id,
  shared_configuration_id,
  commercial_code_1b_id,
  commercial_code_1d_id,
  alternate_configuration_id,
  alternate_commercial_code_id
)
select
  profile.id,
  physical_item.id,
  alternate_item.id,
  code_1b.configuration_id,
  code_1b.id,
  code_1d.id,
  alternate_code.configuration_id,
  alternate_code.id
from lateral (
  select id
  from public.profiles
  where is_active
    and nullif(btrim(name), '') is not null
  order by id
  limit 1
) as profile
cross join lateral (
  select id
  from public.items
  where is_active
  order by code, id
  limit 1
) as physical_item
cross join public.commercial_configuration_codes as code_1b
join public.commercial_configuration_codes as code_1d
  on code_1d.configuration_id = code_1b.configuration_id
join public.commercial_configurations as configuration
  on configuration.id = code_1b.configuration_id
cross join lateral (
  select id
  from public.items
  where is_active
    and id <> physical_item.id
  order by code, id
  limit 1
) as alternate_item
cross join lateral (
  select commercial_code.id, commercial_code.configuration_id
  from public.commercial_configuration_codes as commercial_code
  join public.commercial_configurations as alternate_configuration
    on alternate_configuration.id = commercial_code.configuration_id
  where commercial_code.is_active
    and alternate_configuration.is_active
    and commercial_code.configuration_id <> code_1b.configuration_id
  order by commercial_code.code, commercial_code.id
  limit 1
) as alternate_code
where code_1b.code = '1B'
  and code_1d.code = '1D'
  and code_1b.is_active
  and code_1d.is_active
  and configuration.is_active;

do $$
begin
  if (select count(*) from supplier_order_test_context) <> 1 then
    raise exception
      'Preflight failed: active profiles, two physical items, 1B/1D, and another active configuration are required.';
  end if;
end;
$$;

create temporary table supplier_order_stock_baseline
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
  'nk_stats_test_v1_batches', (
    select count(*)
    from public.movement_batches
    where split_part(coalesce(description, ''), '|', 1) = 'NK_STATS_TEST_V1'
  ),
  'item_minimums', (
    select md5(
      coalesce(
        string_agg(
          id::text || ':' || minimum_stock::text || ':' || updated_at::text,
          ',' order by id
        ),
        ''
      )
    )
    from public.items
  ),
  'configuration_minimums', (
    select md5(
      coalesce(
        string_agg(
          id::text || ':' || minimum_stock::text || ':' || updated_at::text,
          ',' order by id
        ),
        ''
      )
    )
    from public.commercial_configurations
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
            configuration_id::text || ':' || quantity::text || ':' || updated_at::text,
            ',' order by configuration_id
          ),
          ''
        )
      )
    )
    from public.configuration_stock_balances
  )
) as signature;

do $$
begin
  if (
    select (signature ->> 'nk_stats_test_v1_batches')::integer
    from supplier_order_stock_baseline
  ) <> 30 then
    raise exception
      'Preflight failed: NK_STATS_TEST_V1 must contain exactly 30 movement batches.';
  end if;
end;
$$;

create temporary table supplier_order_test_results (
  test_name text primary key,
  result jsonb not null
) on commit drop;

create function pg_temp.expect_supplier_order_error(p_statement text)
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
      return;
  end;

  raise exception 'Expected statement to fail, but it succeeded.';
end;
$$;

grant all on table supplier_order_test_context to authenticated;
grant all on table supplier_order_test_results to authenticated;
grant execute on function pg_temp.expect_supplier_order_error(text)
to authenticated;

set local role authenticated;

select set_config(
  'request.jwt.claim.sub',
  (select user_id::text from supplier_order_test_context),
  true
);

select set_config('request.jwt.claim.role', 'authenticated', true);

-- A, D and L: physical item, PENDING status and idempotent create retry.
insert into supplier_order_test_results (test_name, result)
select
  'physical_create',
  public.create_supplier_order(
    '910001',
    current_date,
    'Administrative rollback verification',
    jsonb_build_array(
      jsonb_build_object(
        'kind', 'ITEM',
        'item_id', context.physical_item_id,
        'quantity', 5
      )
    ),
    context.create_key
  )
from supplier_order_test_context as context;

update supplier_order_test_context
set physical_order_id = (
      select (result ->> 'supplier_order_id')::uuid
      from supplier_order_test_results
      where test_name = 'physical_create'
    ),
    physical_line_id = (
      select order_item.id
      from public.supplier_order_items as order_item
      where order_item.supplier_order_id = (
        select (result ->> 'supplier_order_id')::uuid
        from supplier_order_test_results
        where test_name = 'physical_create'
      )
    );

do $$
begin
  if (
    select result ->> 'status'
    from supplier_order_test_results
    where test_name = 'physical_create'
  ) <> 'PENDING' then
    raise exception 'L failed: new order is not PENDING.';
  end if;
end;
$$;

insert into supplier_order_test_results (test_name, result)
select
  'physical_retry',
  public.create_supplier_order(
    '910001',
    current_date,
    'Administrative rollback verification',
    jsonb_build_array(
      jsonb_build_object(
        'kind', 'ITEM',
        'item_id', context.physical_item_id,
        'quantity', 5
      )
    ),
    context.create_key
  )
from supplier_order_test_context as context;

do $$
begin
  if (
    select result ->> 'supplier_order_id'
    from supplier_order_test_results
    where test_name = 'physical_create'
  ) is distinct from (
    select result ->> 'supplier_order_id'
    from supplier_order_test_results
    where test_name = 'physical_retry'
  ) then
    raise exception 'D failed: retry returned another supplier order.';
  end if;

  if (
    select count(*)
    from public.supplier_order_events
    where idempotency_key = (
      select create_key from supplier_order_test_context
    )
  ) <> 1 then
    raise exception 'D failed: retry duplicated the audit event.';
  end if;
end;
$$;

-- B and C: one physical configuration selected through alias 1B; 1D shares it.
insert into supplier_order_test_results (test_name, result)
select
  'configuration_create',
  public.create_supplier_order(
    '910002',
    current_date,
    null,
    jsonb_build_array(
      jsonb_build_object(
        'kind', 'COMMERCIAL_CONFIGURATION',
        'commercial_configuration_id', context.shared_configuration_id,
        'commercial_configuration_code_id', context.commercial_code_1b_id,
        'quantity', 2
      )
    ),
    context.configuration_create_key
  )
from supplier_order_test_context as context;

update supplier_order_test_context
set configuration_order_id = (
  select (result ->> 'supplier_order_id')::uuid
  from supplier_order_test_results
  where test_name = 'configuration_create'
);

do $$
begin
  if (
    select code_1b.configuration_id = code_1d.configuration_id
    from public.commercial_configuration_codes as code_1b
    join public.commercial_configuration_codes as code_1d
      on code_1d.code = '1D'
    where code_1b.code = '1B'
  ) is not true then
    raise exception 'C failed: 1B and 1D do not share one configuration.';
  end if;

  if (
    select count(*)
    from public.supplier_order_items as order_item
    join supplier_order_test_context as context
      on context.configuration_order_id = order_item.supplier_order_id
    where order_item.commercial_configuration_id
        = context.shared_configuration_id
      and order_item.commercial_configuration_code_id
        = context.commercial_code_1b_id
      and order_item.commercial_code_snapshot = '1B'
  ) <> 1 then
    raise exception 'B failed: configuration line or alias snapshot is incorrect.';
  end if;
end;
$$;

-- Current pickup workers require universal readiness and automatically create
-- the matching stock entry. Seed readiness as fixture state, outside the
-- authenticated client contract, before exercising those workers.
reset role;

update public.supplier_order_items
set ready_quantity = 3
where supplier_order_id = (
  select physical_order_id from supplier_order_test_context
);

update public.supplier_order_items
set ready_quantity = ordered_quantity
where supplier_order_id = (
  select configuration_order_id from supplier_order_test_context
);

set local role authenticated;

-- E and M: pickup 0 -> 3 of 5 becomes PARTIAL.
insert into supplier_order_test_results (test_name, result)
select
  'partial_pickup',
  public.set_supplier_order_item_picked_quantity(
    context.physical_line_id,
    3,
    'Pickup verification',
    gen_random_uuid()
  )
from supplier_order_test_context as context;

do $$
begin
  if (
    select result ->> 'status'
    from supplier_order_test_results
    where test_name = 'partial_pickup'
  ) <> 'PARTIAL' then
    raise exception 'M failed: partial pickup is not PARTIAL.';
  end if;
end;
$$;

-- F: pickup above ordered quantity fails.
select pg_temp.expect_supplier_order_error(
  format(
    'select public.set_supplier_order_item_picked_quantity(%L::uuid, 6, null, %L::uuid)',
    physical_line_id,
    gen_random_uuid()
  )
)
from supplier_order_test_context;

-- G and N: mark all on the independent configuration order, then status is
-- COMPLETED. The physical order remains partial for cancellation checks.
insert into supplier_order_test_results (test_name, result)
select
  'all_picked',
  public.mark_supplier_order_all_picked(
    context.configuration_order_id,
    null,
    gen_random_uuid()
  )
from supplier_order_test_context as context;

do $$
begin
  if (
    select result ->> 'status'
    from supplier_order_test_results
    where test_name = 'all_picked'
  ) <> 'COMPLETED' then
    raise exception 'N failed: fully picked order is not COMPLETED.';
  end if;
end;
$$;

-- H: atomic pickup already stocked the three picked units; a reduction is
-- rejected by the canonical monotonic pickup contract.
select pg_temp.expect_supplier_order_error(
  format(
    'select public.set_supplier_order_item_picked_quantity(%L::uuid, 1, null, %L::uuid)',
    physical_line_id,
    gen_random_uuid()
  )
)
from supplier_order_test_context;

-- I and O: untouched order can be fully cancelled and derives CANCELLED.
insert into supplier_order_test_results (test_name, result)
select
  'cancellation_create',
  public.create_supplier_order(
    '910003',
    current_date,
    null,
    jsonb_build_array(
      jsonb_build_object(
        'kind', 'ITEM',
        'item_id', context.physical_item_id,
        'quantity', 2
      )
    ),
    context.cancellation_create_key
  )
from supplier_order_test_context as context;

update supplier_order_test_context
set cancellation_order_id = (
  select (result ->> 'supplier_order_id')::uuid
  from supplier_order_test_results
  where test_name = 'cancellation_create'
);

insert into supplier_order_test_results (test_name, result)
select
  'full_cancel',
  public.cancel_supplier_order(
    context.cancellation_order_id,
    'Cancellation verification',
    gen_random_uuid()
  )
from supplier_order_test_context as context;

do $$
begin
  if (
    select result ->> 'status'
    from supplier_order_test_results
    where test_name = 'full_cancel'
  ) <> 'CANCELLED' then
    raise exception 'I/O failed: cancelled order is not CANCELLED.';
  end if;
end;
$$;

-- J: the picked/stocked order cannot use full cancellation.
select pg_temp.expect_supplier_order_error(
  format(
    'select public.cancel_supplier_order(%L::uuid, null, %L::uuid)',
    physical_order_id,
    gen_random_uuid()
  )
)
from supplier_order_test_context;

-- K: cancelling the remaining balance preserves picked and stocked quantities.
insert into supplier_order_test_results (test_name, result)
select
  'remaining_cancel',
  public.cancel_supplier_order_remaining(
    context.physical_order_id,
    'Remaining balance verification',
    gen_random_uuid()
  )
from supplier_order_test_context as context;

do $$
begin
  if (
    select waiting_pickup_quantity
    from public.supplier_order_summaries
    where id = (
      select physical_order_id from supplier_order_test_context
    )
  ) <> 0 then
    raise exception 'K failed: remaining pickup quantity was not cancelled.';
  end if;

  if (
    select jsonb_build_array(
      result ->> 'status',
      result ->> 'picked_quantity',
      result ->> 'cancelled_quantity'
    )
    from supplier_order_test_results
    where test_name = 'remaining_cancel'
  ) is distinct from jsonb_build_array('CANCELLED', '3', '2') then
    raise exception
      'K/O failed: remaining cancellation did not preserve picked 3 and cancel 2.';
  end if;
end;
$$;

-- Q: reads are available to an authenticated active profile.
do $$
begin
  if not exists (
    select 1
    from public.supplier_order_summaries
    where id = (
      select physical_order_id from supplier_order_test_context
    )
  ) then
    raise exception 'Q failed: active authenticated read did not return the order.';
  end if;
end;
$$;

-- R: direct writes remain blocked for the authenticated client role.
select pg_temp.expect_supplier_order_error(
  $statement$
    insert into public.supplier_orders (
      negotiation_number,
      order_date,
      created_by_name_snapshot
    )
    values ('DIRECT-WRITE-MUST-FAIL', current_date, 'Blocked')
  $statement$
);

select pg_temp.expect_supplier_order_error(
  format(
    'update public.supplier_orders set notes = %L where id = %L::uuid',
    'DIRECT UPDATE MUST FAIL',
    physical_order_id
  )
)
from supplier_order_test_context;

select pg_temp.expect_supplier_order_error(
  format(
    'delete from public.supplier_orders where id = %L::uuid',
    physical_order_id
  )
)
from supplier_order_test_context;

-- S: a JWT subject without an active profile can neither read nor execute.
select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);

do $$
begin
  if exists (select 1 from public.supplier_order_summaries) then
    raise exception 'S failed: a user without an active profile could read orders.';
  end if;
end;
$$;

select pg_temp.expect_supplier_order_error(
  format(
    'select public.create_supplier_order(%L, current_date, null, %L::jsonb, %L::uuid)',
    '910004',
    jsonb_build_array(
      jsonb_build_object(
        'kind', 'ITEM',
        'item_id', physical_item_id,
        'quantity', 1
      )
    )::text,
    gen_random_uuid()
  )
)
from supplier_order_test_context;

select set_config(
  'request.jwt.claim.sub',
  (select user_id::text from supplier_order_test_context),
  true
);

-- T: an alias from another physical configuration is rejected.
select pg_temp.expect_supplier_order_error(
  format(
    'select public.create_supplier_order(%L, current_date, null, %L::jsonb, %L::uuid)',
    '910005',
    jsonb_build_array(
      jsonb_build_object(
        'kind', 'COMMERCIAL_CONFIGURATION',
        'commercial_configuration_id', shared_configuration_id,
        'commercial_configuration_code_id',
          alternate_commercial_code_id,
        'quantity', 1
      )
    )::text,
    gen_random_uuid()
  )
)
from supplier_order_test_context;

-- U and V: exactly one catalog target is mandatory.
select pg_temp.expect_supplier_order_error(
  format(
    'select public.create_supplier_order(%L, current_date, null, %L::jsonb, %L::uuid)',
    '910006',
    jsonb_build_array(
      jsonb_build_object(
        'kind', 'ITEM',
        'item_id', physical_item_id,
        'commercial_configuration_id', shared_configuration_id,
        'quantity', 1
      )
    )::text,
    gen_random_uuid()
  )
)
from supplier_order_test_context;

select pg_temp.expect_supplier_order_error(
  format(
    'select public.create_supplier_order(%L, current_date, null, %L::jsonb, %L::uuid)',
    '910007',
    jsonb_build_array(
      jsonb_build_object(
        'kind', 'ITEM',
        'quantity', 1
      )
    )::text,
    gen_random_uuid()
  )
)
from supplier_order_test_context;

-- W: the successful create key cannot be reused with another payload.
select pg_temp.expect_supplier_order_error(
  format(
    'select public.create_supplier_order(%L, current_date, %L, %L::jsonb, %L::uuid)',
    '910001',
    'Administrative rollback verification',
    jsonb_build_array(
      jsonb_build_object(
        'kind', 'ITEM',
        'item_id', physical_item_id,
        'quantity', 4
      )
    )::text,
    create_key
  )
)
from supplier_order_test_context;

-- X, Y and Z: stale/invalid edits cannot reduce, remove, or retarget a moved line.
insert into supplier_order_test_results (test_name, result)
select
  'mutation_create',
  public.create_supplier_order(
    '910008',
    current_date,
    null,
    jsonb_build_array(
      jsonb_build_object(
        'kind', 'ITEM',
        'item_id', context.physical_item_id,
        'quantity', 5
      )
    ),
    gen_random_uuid()
  )
from supplier_order_test_context as context;

insert into supplier_order_test_results (test_name, result)
select
  'mutation_header_update',
  public.update_supplier_order(
    summary.id,
    summary.updated_at,
    summary.negotiation_number,
    summary.order_date,
    'Header update verification',
    jsonb_build_array(
      jsonb_build_object(
        'id', order_item.id,
        'kind', 'ITEM',
        'item_id', order_item.item_id,
        'quantity', order_item.ordered_quantity
      )
    ),
    gen_random_uuid()
  )
from public.supplier_order_summaries as summary
join public.supplier_order_items as order_item
  on order_item.supplier_order_id = summary.id
where summary.id = (
  select (result ->> 'supplier_order_id')::uuid
  from supplier_order_test_results
  where test_name = 'mutation_create'
);

reset role;

update public.supplier_order_items
set ready_quantity = 2
where supplier_order_id = (
  select (result ->> 'supplier_order_id')::uuid
  from supplier_order_test_results
  where test_name = 'mutation_create'
);

set local role authenticated;

insert into supplier_order_test_results (test_name, result)
select
  'mutation_pick',
  public.set_supplier_order_item_picked_quantity(
    order_item.id,
    2,
    null,
    gen_random_uuid()
  )
from public.supplier_order_items as order_item
where order_item.supplier_order_id = (
  select (result ->> 'supplier_order_id')::uuid
  from supplier_order_test_results
  where test_name = 'mutation_create'
);

select pg_temp.expect_supplier_order_error(
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
        'quantity', 1
      )
    )::text,
    gen_random_uuid()
  )
)
from public.supplier_order_summaries as summary
join public.supplier_order_items as order_item
  on order_item.supplier_order_id = summary.id
where summary.id = (
  select (result ->> 'supplier_order_id')::uuid
  from supplier_order_test_results
  where test_name = 'mutation_create'
);

select pg_temp.expect_supplier_order_error(
  format(
    'select public.update_supplier_order(%L::uuid, %L::timestamptz, %L, current_date, null, %L::jsonb, %L::uuid)',
    summary.id,
    summary.updated_at,
    summary.negotiation_number,
    jsonb_build_array(
      jsonb_build_object(
        'kind', 'ITEM',
        'item_id', context.alternate_item_id,
        'quantity', 1
      )
    )::text,
    gen_random_uuid()
  )
)
from public.supplier_order_summaries as summary
cross join supplier_order_test_context as context
where summary.id = (
  select (result ->> 'supplier_order_id')::uuid
  from supplier_order_test_results
  where test_name = 'mutation_create'
);

select pg_temp.expect_supplier_order_error(
  format(
    'select public.update_supplier_order(%L::uuid, %L::timestamptz, %L, current_date, null, %L::jsonb, %L::uuid)',
    summary.id,
    summary.updated_at,
    summary.negotiation_number,
    jsonb_build_array(
      jsonb_build_object(
        'id', order_item.id,
        'kind', 'ITEM',
        'item_id', context.alternate_item_id,
        'quantity', 5
      )
    )::text,
    gen_random_uuid()
  )
)
from public.supplier_order_summaries as summary
join public.supplier_order_items as order_item
  on order_item.supplier_order_id = summary.id
cross join supplier_order_test_context as context
where summary.id = (
  select (result ->> 'supplier_order_id')::uuid
  from supplier_order_test_results
  where test_name = 'mutation_create'
);

-- AA: mark-all respects a previously cancelled quantity.
insert into supplier_order_test_results (test_name, result)
select
  'partial_cancel_create',
  public.create_supplier_order(
    '910009',
    current_date,
    null,
    jsonb_build_array(
      jsonb_build_object(
        'kind', 'ITEM',
        'item_id', context.physical_item_id,
        'quantity', 5
      )
    ),
    gen_random_uuid()
  )
from supplier_order_test_context as context;

reset role;

update public.supplier_order_items
set cancelled_quantity = 2,
    ready_quantity = 3
where supplier_order_id = (
  select (result ->> 'supplier_order_id')::uuid
  from supplier_order_test_results
  where test_name = 'partial_cancel_create'
);

set local role authenticated;

insert into supplier_order_test_results (test_name, result)
select
  'partial_cancel_mark_all',
  public.mark_supplier_order_all_picked(
    (result ->> 'supplier_order_id')::uuid,
    null,
    gen_random_uuid()
  )
from supplier_order_test_results
where test_name = 'partial_cancel_create';

do $$
begin
  if not exists (
    select 1
    from public.supplier_order_items
    where supplier_order_id = (
      select (result ->> 'supplier_order_id')::uuid
      from supplier_order_test_results
      where test_name = 'partial_cancel_create'
    )
      and ordered_quantity = 5
      and picked_quantity = 3
      and cancelled_quantity = 2
  ) then
    raise exception 'AA failed: mark-all reopened cancelled quantity.';
  end if;

  if not exists (
    select 1
    from public.supplier_order_items
    where id = (
      select physical_line_id from supplier_order_test_context
    )
      and picked_quantity = 3
      and stocked_quantity = 3
      and cancelled_quantity = 2
  ) then
    raise exception
      'AB failed: remaining cancellation changed picked or stocked quantity.';
  end if;
end;
$$;

-- AC: no private supplier-order helper has a client EXECUTE grant.
reset role;

do $$
begin
  if exists (
    select 1
    from information_schema.routine_privileges
    where specific_schema = 'private'
      and grantee in ('PUBLIC', 'anon', 'authenticated')
      and privilege_type = 'EXECUTE'
      and (
        routine_name like '%supplier_order%'
        or routine_name = 'protect_supplier_order_commercial_code_links'
      )
  ) then
    raise exception 'AC failed: a client role can execute a private helper.';
  end if;
end;
$$;

set local role authenticated;

select pg_temp.expect_supplier_order_error(
  'select private.supplier_order_result(gen_random_uuid())'
);

-- AD: clients cannot change the future stock-entry quantity directly.
select pg_temp.expect_supplier_order_error(
  format(
    'update public.supplier_order_items set stocked_quantity = 0 where id = %L::uuid',
    physical_line_id
  )
)
from supplier_order_test_context;

reset role;

-- P: pickup and stock entry are one atomic operation. Every picked unit in
-- this fixture is stocked exactly once and no movement is orphaned.
do $$
declare
  v_before jsonb := (
    select signature from supplier_order_stock_baseline
  );
begin
  if exists (
    select 1
    from public.supplier_order_items
    where supplier_order_id in (
      select physical_order_id from supplier_order_test_context
      union all
      select configuration_order_id from supplier_order_test_context
      union all
      select (result ->> 'supplier_order_id')::uuid
      from supplier_order_test_results
      where test_name in ('mutation_create', 'partial_cancel_create')
    )
      and stocked_quantity <> picked_quantity
  ) then
    raise exception 'P failed: pickup and stock entry quantities diverged.';
  end if;

  if exists (
    select 1
    from public.supplier_order_stock_entries as entry
    left join public.movement_batches as batch on batch.id = entry.movement_batch_id
    where entry.supplier_order_id in (
      select physical_order_id from supplier_order_test_context
      union all
      select configuration_order_id from supplier_order_test_context
      union all
      select (result ->> 'supplier_order_id')::uuid
      from supplier_order_test_results
      where test_name in ('mutation_create', 'partial_cancel_create')
    )
      and batch.id is null
  ) then
    raise exception 'P failed: pickup created an orphaned stock entry.';
  end if;

  if (select count(*) from public.assembly_operations)
      <> (v_before ->> 'assembly_operations')::integer
    or (select count(*) from public.outbound_batch_lines)
      <> (v_before ->> 'outbound_batch_lines')::integer
    or (
      select count(*)
      from public.movement_batches
      where split_part(coalesce(description, ''), '|', 1) = 'NK_STATS_TEST_V1'
    ) <> (v_before ->> 'nk_stats_test_v1_batches')::integer
    or (
      select md5(coalesce(string_agg(
        id::text || ':' || minimum_stock::text || ':' || updated_at::text,
        ',' order by id
      ), ''))
      from public.items
    ) <> v_before ->> 'item_minimums'
    or (
      select md5(coalesce(string_agg(
        id::text || ':' || minimum_stock::text || ':' || updated_at::text,
        ',' order by id
      ), ''))
      from public.commercial_configurations
    ) <> v_before ->> 'configuration_minimums' then
    raise exception 'P failed: pickup changed an unrelated stock contract.';
  end if;
end;
$$;

select
  'A-AD supplier-order foundation checks passed; all writes will now roll back.'
    as verification_result;

rollback;
