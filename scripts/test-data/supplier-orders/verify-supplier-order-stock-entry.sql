-- Administrative verification only. Review before running manually.
-- All fixtures and stock changes are isolated by one transaction.
begin;

create temporary table supplier_order_stock_entry_context (
  user_id uuid not null,
  user_name text not null,
  servo_id uuid not null,
  kit_id uuid not null,
  repair_id uuid not null,
  loose_part_id uuid not null,
  configuration_id uuid not null,
  code_1b_id uuid not null,
  code_1d_id uuid not null,
  active_order_id uuid not null default gen_random_uuid(),
  finalized_order_id uuid not null default gen_random_uuid(),
  cancelled_order_id uuid not null default gen_random_uuid(),
  servo_line_id uuid not null default gen_random_uuid(),
  kit_line_id uuid not null default gen_random_uuid(),
  repair_line_id uuid not null default gen_random_uuid(),
  loose_part_line_id uuid not null default gen_random_uuid(),
  code_1b_line_id uuid not null default gen_random_uuid(),
  code_1d_line_id uuid not null default gen_random_uuid(),
  finalized_line_id uuid not null default gen_random_uuid(),
  cancelled_line_id uuid not null default gen_random_uuid(),
  first_key uuid not null default gen_random_uuid(),
  second_key uuid not null default gen_random_uuid(),
  third_key uuid not null default gen_random_uuid(),
  finalized_key uuid not null default gen_random_uuid(),
  cancelled_key uuid not null default gen_random_uuid(),
  stale_key uuid not null default gen_random_uuid(),
  rollback_key uuid not null default gen_random_uuid(),
  concurrency_key uuid not null default gen_random_uuid()
) on commit drop;

insert into supplier_order_stock_entry_context (
  user_id,
  user_name,
  servo_id,
  kit_id,
  repair_id,
  loose_part_id,
  configuration_id,
  code_1b_id,
  code_1d_id
)
select
  profile.id,
  btrim(profile.name),
  servo.id,
  kit.id,
  repair.id,
  loose_part.id,
  code_1b.configuration_id,
  code_1b.id,
  code_1d.id
from lateral (
  select id, name
  from public.profiles
  where is_active
    and nullif(btrim(name), '') is not null
  order by id
  limit 1
) as profile
cross join lateral (
  select id
  from public.items
  where item_type = 'SERVO' and is_active
  order by code, id
  limit 1
) as servo
cross join lateral (
  select id
  from public.items
  where item_type = 'INSTALLATION_KIT' and is_active
  order by code, id
  limit 1
) as kit
cross join lateral (
  select id
  from public.items
  where item_type = 'REPAIR_KIT' and is_active
  order by code, id
  limit 1
) as repair
cross join lateral (
  select id
  from public.items
  where item_type = 'LOOSE_PART' and is_active
  order by code, id
  limit 1
) as loose_part
cross join lateral (
  select id, configuration_id
  from public.commercial_configuration_codes
  where code = '1B' and is_active
  limit 1
) as code_1b
cross join lateral (
  select id, configuration_id
  from public.commercial_configuration_codes
  where code = '1D' and is_active
  limit 1
) as code_1d
where code_1b.configuration_id = code_1d.configuration_id;

do $$
begin
  if (select count(*) from supplier_order_stock_entry_context) <> 1 then
    raise exception
      'Preflight failed: active profile, four physical item types, and aliases 1B/1D on one configuration are required.';
  end if;
end;
$$;

create temporary table supplier_order_stock_entry_baseline
on commit drop
as
select jsonb_build_object(
  'supplier_orders', (select count(*) from public.supplier_orders),
  'supplier_order_items', (
    select count(*) from public.supplier_order_items
  ),
  'supplier_order_events', (
    select count(*) from public.supplier_order_events
  ),
  'supplier_order_stock_entries', (
    select count(*) from public.supplier_order_stock_entries
  ),
  'supplier_order_stock_entry_lines', (
    select count(*) from public.supplier_order_stock_entry_lines
  ),
  'movement_batches', (select count(*) from public.movement_batches),
  'inbound_batch_lines', (
    select count(*) from public.inbound_batch_lines
  ),
  'outbound_batch_lines', (
    select count(*) from public.outbound_batch_lines
  ),
  'stock_movements', (select count(*) from public.stock_movements),
  'configuration_stock_movements', (
    select count(*) from public.configuration_stock_movements
  ),
  'assembly_operations', (
    select count(*) from public.assembly_operations
  ),
  'item_minimums', (
    select jsonb_build_object(
      'quantity', coalesce(sum(minimum_stock), 0),
      'signature', md5(
        coalesce(
          string_agg(
            id::text || ':' || minimum_stock::text || ':' || updated_at::text,
            ',' order by id
          ),
          ''
        )
      )
    )
    from public.items
  ),
  'configuration_minimums', (
    select jsonb_build_object(
      'quantity', coalesce(sum(minimum_stock), 0),
      'signature', md5(
        coalesce(
          string_agg(
            id::text || ':' || minimum_stock::text || ':' || updated_at::text,
            ',' order by id
          ),
          ''
        )
      )
    )
    from public.commercial_configurations
  ),
  'statistics_dataset_batches', (
    select count(*)
    from public.movement_batches
    where description like 'NK_STATS_TEST_V1%'
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

create temporary table supplier_order_stock_entry_target_baseline
on commit drop
as
select
  target.kind,
  target.id,
  case target.kind
    when 'ITEM' then coalesce(stock.quantity, 0)
    else coalesce(configuration_stock.quantity, 0)
  end as quantity
from supplier_order_stock_entry_context as context
cross join lateral (
  values
    ('ITEM'::text, context.servo_id),
    ('ITEM', context.kit_id),
    ('ITEM', context.repair_id),
    ('ITEM', context.loose_part_id),
    ('CONFIGURATION', context.configuration_id)
) as target(kind, id)
left join public.stock_balances as stock
  on target.kind = 'ITEM' and stock.item_id = target.id
left join public.configuration_stock_balances as configuration_stock
  on target.kind = 'CONFIGURATION'
 and configuration_stock.configuration_id = target.id;

create temporary table supplier_order_stock_entry_results (
  test_name text primary key,
  result jsonb not null
) on commit drop;

create function pg_temp.expect_supplier_order_stock_entry_error(
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

grant all on table supplier_order_stock_entry_context to authenticated;
grant all on table supplier_order_stock_entry_results to authenticated;
grant select on table supplier_order_stock_entry_target_baseline
to authenticated;
grant execute on function pg_temp.expect_supplier_order_stock_entry_error(
  text,
  text
) to authenticated;

savepoint supplier_order_stock_entry_test;

insert into public.supplier_orders (
  id,
  negotiation_number,
  order_date,
  notes,
  created_by,
  created_by_name_snapshot,
  finalized_at,
  finalized_by,
  finalized_by_name_snapshot,
  finalization_note,
  cancelled_at,
  cancelled_by,
  cancelled_by_name_snapshot,
  cancellation_note
)
select
  fixture.order_id,
  fixture.negotiation_number,
  current_date,
  'Administrative stock-entry verification',
  context.user_id,
  context.user_name,
  fixture.finalized_at,
  case when fixture.finalized_at is null then null else context.user_id end,
  case when fixture.finalized_at is null then null else context.user_name end,
  case when fixture.finalized_at is null then null else 'Finalized fixture' end,
  fixture.cancelled_at,
  case when fixture.cancelled_at is null then null else context.user_id end,
  case when fixture.cancelled_at is null then null else context.user_name end,
  case when fixture.cancelled_at is null then null else 'Cancelled fixture' end
from supplier_order_stock_entry_context as context
cross join lateral (
  values
    (
      context.active_order_id,
      '940001',
      null::timestamptz,
      null::timestamptz
    ),
    (
      context.finalized_order_id,
      '940002',
      now(),
      null::timestamptz
    ),
    (
      context.cancelled_order_id,
      '940003',
      null::timestamptz,
      now()
    )
) as fixture(
  order_id,
  negotiation_number,
  finalized_at,
  cancelled_at
);

insert into public.supplier_order_items (
  id,
  supplier_order_id,
  item_id,
  commercial_configuration_id,
  commercial_configuration_code_id,
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
  fixture.line_id,
  fixture.order_id,
  fixture.item_id,
  fixture.configuration_id,
  fixture.commercial_code_id,
  'SERVER_PENDING',
  'SERVER_PENDING',
  'LOOSE_PART',
  fixture.ordered_quantity,
  fixture.picked_quantity,
  fixture.picked_quantity,
  0,
  fixture.cancelled_quantity,
  fixture.position
from supplier_order_stock_entry_context as context
cross join lateral (
  values
    (
      context.servo_line_id,
      context.active_order_id,
      context.servo_id,
      null::uuid,
      null::uuid,
      5,
      5,
      0,
      0
    ),
    (
      context.kit_line_id,
      context.active_order_id,
      context.kit_id,
      null::uuid,
      null::uuid,
      5,
      5,
      0,
      1
    ),
    (
      context.repair_line_id,
      context.active_order_id,
      context.repair_id,
      null::uuid,
      null::uuid,
      5,
      5,
      0,
      2
    ),
    (
      context.loose_part_line_id,
      context.active_order_id,
      context.loose_part_id,
      null::uuid,
      null::uuid,
      5,
      5,
      0,
      3
    ),
    (
      context.code_1b_line_id,
      context.active_order_id,
      null::uuid,
      context.configuration_id,
      context.code_1b_id,
      5,
      5,
      0,
      4
    ),
    (
      context.code_1d_line_id,
      context.active_order_id,
      null::uuid,
      context.configuration_id,
      context.code_1d_id,
      3,
      3,
      0,
      5
    ),
    (
      context.finalized_line_id,
      context.finalized_order_id,
      context.servo_id,
      null::uuid,
      null::uuid,
      2,
      2,
      0,
      0
    ),
    (
      context.cancelled_line_id,
      context.cancelled_order_id,
      context.kit_id,
      null::uuid,
      null::uuid,
      10,
      4,
      6,
      0
    )
) as fixture(
  line_id,
  order_id,
  item_id,
  configuration_id,
  commercial_code_id,
  ordered_quantity,
  picked_quantity,
  cancelled_quantity,
  position
);

create temporary table supplier_order_stock_entry_closure_baseline
on commit drop
as
select
  supplier_order.id,
  supplier_order.updated_at,
  supplier_order.cancelled_at,
  supplier_order.cancellation_note,
  supplier_order.finalized_at,
  supplier_order.finalized_by,
  supplier_order.finalized_by_name_snapshot,
  supplier_order.finalization_note
from public.supplier_orders as supplier_order
where supplier_order.id in (
  select active_order_id from supplier_order_stock_entry_context
  union all
  select finalized_order_id from supplier_order_stock_entry_context
  union all
  select cancelled_order_id from supplier_order_stock_entry_context
);

grant select on table supplier_order_stock_entry_closure_baseline
to authenticated;

set local role authenticated;

select set_config(
  'request.jwt.claim.sub',
  (select user_id::text from supplier_order_stock_entry_context),
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

-- BJ-BN: duplicates, extra fields, foreign-order lines, and client targets.
select pg_temp.expect_supplier_order_stock_entry_error(
  format(
    'select public.create_supplier_order_stock_entry(%L::uuid, %L::jsonb, null, %L::timestamptz, gen_random_uuid())',
    context.active_order_id,
    jsonb_build_array(
      jsonb_build_object(
        'supplier_order_item_id', context.servo_line_id,
        'quantity', 1
      ),
      jsonb_build_object(
        'supplier_order_item_id', context.servo_line_id,
        'quantity', 1
      )
    ),
    summary.updated_at
  ),
  'same supplier-order line'
)
from supplier_order_stock_entry_context as context
join public.supplier_order_summaries as summary
  on summary.id = context.active_order_id;

select pg_temp.expect_supplier_order_stock_entry_error(
  format(
    'select public.create_supplier_order_stock_entry(%L::uuid, %L::jsonb, null, %L::timestamptz, gen_random_uuid())',
    context.active_order_id,
    jsonb_build_array(
      jsonb_build_object(
        'supplier_order_item_id', context.kit_line_id,
        'quantity', 1,
        'unexpected', true
      )
    ),
    summary.updated_at
  ),
  'unexpected fields'
)
from supplier_order_stock_entry_context as context
join public.supplier_order_summaries as summary
  on summary.id = context.active_order_id;

select pg_temp.expect_supplier_order_stock_entry_error(
  format(
    'select public.create_supplier_order_stock_entry(%L::uuid, %L::jsonb, null, %L::timestamptz, gen_random_uuid())',
    context.active_order_id,
    jsonb_build_array(
      jsonb_build_object(
        'supplier_order_item_id', context.finalized_line_id,
        'quantity', 1
      )
    ),
    summary.updated_at
  ),
  'belong'
)
from supplier_order_stock_entry_context as context
join public.supplier_order_summaries as summary
  on summary.id = context.active_order_id;

select pg_temp.expect_supplier_order_stock_entry_error(
  format(
    'select public.create_supplier_order_stock_entry(%L::uuid, %L::jsonb, null, %L::timestamptz, gen_random_uuid())',
    context.active_order_id,
    jsonb_build_array(
      jsonb_build_object(
        'supplier_order_item_id', context.servo_line_id,
        'quantity', 1,
        'item_id', context.kit_id
      )
    ),
    summary.updated_at
  ),
  'unexpected fields'
)
from supplier_order_stock_entry_context as context
join public.supplier_order_summaries as summary
  on summary.id = context.active_order_id;

select pg_temp.expect_supplier_order_stock_entry_error(
  format(
    'select public.create_supplier_order_stock_entry(%L::uuid, %L::jsonb, null, %L::timestamptz, gen_random_uuid())',
    context.active_order_id,
    jsonb_build_array(
      jsonb_build_object(
        'supplier_order_item_id', context.code_1b_line_id,
        'quantity', 1,
        'commercial_configuration_id', gen_random_uuid()
      )
    ),
    summary.updated_at
  ),
  'unexpected fields'
)
from supplier_order_stock_entry_context as context
join public.supplier_order_summaries as summary
  on summary.id = context.active_order_id;

-- A-O and AC-AI: one mixed partial entry through the public wrapper.
insert into supplier_order_stock_entry_results (test_name, result)
select
  'first_entry',
  public.create_supplier_order_stock_entry(
    context.active_order_id,
    jsonb_build_array(
      jsonb_build_object(
        'supplier_order_item_id', context.servo_line_id,
        'quantity', 2
      ),
      jsonb_build_object(
        'supplier_order_item_id', context.kit_line_id,
        'quantity', 2
      ),
      jsonb_build_object(
        'supplier_order_item_id', context.repair_line_id,
        'quantity', 2
      ),
      jsonb_build_object(
        'supplier_order_item_id', context.loose_part_line_id,
        'quantity', 2
      ),
      jsonb_build_object(
        'supplier_order_item_id', context.code_1b_line_id,
        'quantity', 1
      ),
      jsonb_build_object(
        'supplier_order_item_id', context.code_1d_line_id,
        'quantity', 1
      )
    ),
    '  First partial stock entry  ',
    summary.updated_at,
    context.first_key
  )
from supplier_order_stock_entry_context as context
join public.supplier_order_summaries as summary
  on summary.id = context.active_order_id;

do $$
declare
  v_context supplier_order_stock_entry_context%rowtype;
  v_result jsonb;
  v_batch_id uuid;
  v_entry_id uuid;
begin
  select * into v_context from supplier_order_stock_entry_context;
  select result into v_result
  from supplier_order_stock_entry_results
  where test_name = 'first_entry';

  v_batch_id := (v_result ->> 'movement_batch_id')::uuid;
  v_entry_id := (v_result ->> 'supplier_order_stock_entry_id')::uuid;

  if (v_result ->> 'stock_entry_line_count')::integer <> 6
    or (v_result ->> 'stock_entry_quantity')::integer <> 10
    or (v_result ->> 'waiting_stock_quantity')::integer <> 18 then
    raise exception 'A-O failed: the mixed partial-entry result is inconsistent.';
  end if;

  if not exists (
    select 1
    from public.movement_batches
    where id = v_batch_id
      and movement_type = 'INBOUND'
      and source = 'MANUAL'
      and user_id = v_context.user_id
      and user_name_snapshot = v_context.user_name
      and description like 'Entrada pelo pedido 940001%'
  ) then
    raise exception 'AC/AI failed: the normal inbound batch is inconsistent.';
  end if;

  if (
    select count(*)
    from public.supplier_order_stock_entries
    where id = v_entry_id
      and supplier_order_id = v_context.active_order_id
      and movement_batch_id = v_batch_id
      and note = 'First partial stock entry'
      and created_by = v_context.user_id
      and created_by_name_snapshot = v_context.user_name
  ) <> 1 then
    raise exception 'AE failed: the order-to-batch link is inconsistent.';
  end if;

  if (
    select count(*)
    from public.supplier_order_stock_entry_lines
    where supplier_order_stock_entry_id = v_entry_id
  ) <> 6 then
    raise exception 'AF failed: expected six order-item links.';
  end if;

  if (
    select count(*)
    from public.inbound_batch_lines
    where batch_id = v_batch_id
  ) <> 6 then
    raise exception 'AD failed: expected six consolidated inbound lines.';
  end if;

  if exists (
    select 1
    from supplier_order_stock_entry_target_baseline as baseline
    left join public.stock_balances as balance
      on baseline.kind = 'ITEM' and balance.item_id = baseline.id
    where baseline.kind = 'ITEM'
      and coalesce(balance.quantity, 0) <> baseline.quantity + 2
  ) then
    raise exception 'E failed: a physical balance did not increase by two.';
  end if;

  if not exists (
    select 1
    from supplier_order_stock_entry_target_baseline as baseline
    join public.configuration_stock_balances as balance
      on balance.configuration_id = baseline.id
    where baseline.kind = 'CONFIGURATION'
      and balance.quantity = baseline.quantity + 2
  ) then
    raise exception 'K/O failed: aliases did not add two to one configuration.';
  end if;

  if (
    select count(*)
    from public.stock_movements
    where batch_id = v_batch_id
  ) <> 4
    or (
      select count(*)
      from public.configuration_stock_movements
      where batch_id = v_batch_id
    ) <> 1
    or exists (
      select 1
      from public.assembly_operations
      where batch_id = v_batch_id
    ) then
    raise exception 'L failed: stock movements do not match mixed inbound semantics.';
  end if;

  if (
    select count(*)
    from public.supplier_order_events
    where supplier_order_id = v_context.active_order_id
      and event_type = 'STOCK_ENTRY_CREATED'
      and idempotency_key = v_context.first_key
      and details ->> 'movement_batch_id' = v_batch_id::text
      and (details ->> 'line_count')::integer = 6
      and (details ->> 'total_quantity')::integer = 10
  ) <> 1 then
    raise exception 'AG failed: STOCK_ENTRY_CREATED is inconsistent.';
  end if;

  if exists (
    select 1
    from public.supplier_order_items as order_item
    where order_item.supplier_order_id = v_context.active_order_id
      and (
        order_item.ordered_quantity <> case
          when order_item.id = v_context.code_1d_line_id then 3
          else 5
        end
        or order_item.picked_quantity <> case
          when order_item.id = v_context.code_1d_line_id then 3
          else 5
        end
        or order_item.cancelled_quantity <> 0
        or order_item.stocked_quantity <> case
          when order_item.id in (
            v_context.code_1b_line_id,
            v_context.code_1d_line_id
          ) then 1
          else 2
        end
      )
  ) then
    raise exception 'F-I failed: order quantities changed unexpectedly.';
  end if;

  if (
    select count(distinct commercial_configuration_id)
    from public.supplier_order_stock_entry_lines
    where supplier_order_stock_entry_id = v_entry_id
      and commercial_configuration_id is not null
  ) <> 1 then
    raise exception 'J-O failed: aliases did not resolve to one configuration.';
  end if;
end;
$$;

-- AJ-AM/AP: identical retry returns the exact logical result and no writes.
insert into supplier_order_stock_entry_results (test_name, result)
select
  'first_retry',
  public.create_supplier_order_stock_entry(
    context.active_order_id,
    jsonb_build_array(
      jsonb_build_object(
        'supplier_order_item_id', context.servo_line_id,
        'quantity', 2
      ),
      jsonb_build_object(
        'supplier_order_item_id', context.kit_line_id,
        'quantity', 2
      ),
      jsonb_build_object(
        'supplier_order_item_id', context.repair_line_id,
        'quantity', 2
      ),
      jsonb_build_object(
        'supplier_order_item_id', context.loose_part_line_id,
        'quantity', 2
      ),
      jsonb_build_object(
        'supplier_order_item_id', context.code_1b_line_id,
        'quantity', 1
      ),
      jsonb_build_object(
        'supplier_order_item_id', context.code_1d_line_id,
        'quantity', 1
      )
    ),
    'First partial stock entry',
    (event.details -> 'request' ->> 'expected_updated_at')::timestamptz,
    context.first_key
  )
from supplier_order_stock_entry_context as context
join public.supplier_order_events as event
  on event.user_id = context.user_id
 and event.idempotency_key = context.first_key;

do $$
begin
  if (
    select first.result is distinct from retry.result
    from supplier_order_stock_entry_results as first
    cross join supplier_order_stock_entry_results as retry
    where first.test_name = 'first_entry'
      and retry.test_name = 'first_retry'
  ) then
    raise exception 'AJ-AP failed: identical retry changed its result.';
  end if;

  if (
    select count(*)
    from public.supplier_order_events
    where idempotency_key = (
      select first_key from supplier_order_stock_entry_context
    )
  ) <> 1 then
    raise exception 'AK-AM failed: retry duplicated the event.';
  end if;
end;
$$;

-- P-R/BW: additional partial entries; the second uses two lines in one batch.
insert into supplier_order_stock_entry_results (test_name, result)
select
  'second_entry',
  public.create_supplier_order_stock_entry(
    context.active_order_id,
    jsonb_build_array(
      jsonb_build_object(
        'supplier_order_item_id', context.servo_line_id,
        'quantity', 1
      ),
      jsonb_build_object(
        'supplier_order_item_id', context.kit_line_id,
        'quantity', 1
      )
    ),
    null,
    summary.updated_at,
    context.second_key
  )
from supplier_order_stock_entry_context as context
join public.supplier_order_summaries as summary
  on summary.id = context.active_order_id;

insert into supplier_order_stock_entry_results (test_name, result)
select
  'third_entry',
  public.create_supplier_order_stock_entry(
    context.active_order_id,
    jsonb_build_array(
      jsonb_build_object(
        'supplier_order_item_id', context.servo_line_id,
        'quantity', 2
      )
    ),
    null,
    summary.updated_at,
    context.third_key
  )
from supplier_order_stock_entry_context as context
join public.supplier_order_summaries as summary
  on summary.id = context.active_order_id;

do $$
declare
  v_context supplier_order_stock_entry_context%rowtype;
  v_second_result jsonb;
begin
  select * into v_context from supplier_order_stock_entry_context;
  select result into v_second_result
  from supplier_order_stock_entry_results
  where test_name = 'second_entry';

  if (
    select stocked_quantity
    from public.supplier_order_items
    where id = v_context.servo_line_id
  ) <> 5 then
    raise exception 'P-R failed: multiple partial entries did not total five.';
  end if;

  if (v_second_result ->> 'stock_entry_line_count')::integer <> 2
    or (
      select count(*)
      from public.supplier_order_stock_entry_lines
      where supplier_order_stock_entry_id =
        (v_second_result ->> 'supplier_order_stock_entry_id')::uuid
    ) <> 2 then
    raise exception 'BW failed: two requested lines did not share one entry batch.';
  end if;
end;
$$;

-- BX: one invalid line rolls the complete logical operation back.
select pg_temp.expect_supplier_order_stock_entry_error(
  format(
    'select public.create_supplier_order_stock_entry(%L::uuid, %L::jsonb, null, %L::timestamptz, %L::uuid)',
    context.active_order_id,
    jsonb_build_array(
      jsonb_build_object(
        'supplier_order_item_id', context.repair_line_id,
        'quantity', 1
      ),
      jsonb_build_object(
        'supplier_order_item_id', context.servo_line_id,
        'quantity', 1
      )
    ),
    summary.updated_at,
    context.rollback_key
  ),
  'cannot exceed'
)
from supplier_order_stock_entry_context as context
join public.supplier_order_summaries as summary
  on summary.id = context.active_order_id;

do $$
begin
  if exists (
      select 1
      from public.supplier_order_events
      where idempotency_key = (
        select rollback_key from supplier_order_stock_entry_context
      )
    )
    or exists (
      select 1
      from public.movement_batches
      where idempotency_key = (
        select rollback_key from supplier_order_stock_entry_context
      )
    ) then
    raise exception 'BX failed: the rejected mixed request left audit data.';
  end if;
end;
$$;

-- S-V, AN, AO, and invalid payload shapes must fail without side effects.
select pg_temp.expect_supplier_order_stock_entry_error(
  format(
    'select public.create_supplier_order_stock_entry(%L::uuid, %L::jsonb, null, %L::timestamptz, gen_random_uuid())',
    context.active_order_id,
    jsonb_build_array(
      jsonb_build_object(
        'supplier_order_item_id', context.servo_line_id,
        'quantity', 1
      )
    ),
    summary.updated_at
  ),
  'cannot exceed'
)
from supplier_order_stock_entry_context as context
join public.supplier_order_summaries as summary
  on summary.id = context.active_order_id;

select pg_temp.expect_supplier_order_stock_entry_error(
  format(
    'select public.create_supplier_order_stock_entry(%L::uuid, %L::jsonb, null, %L::timestamptz, gen_random_uuid())',
    context.active_order_id,
    jsonb_build_array(
      jsonb_build_object(
        'supplier_order_item_id', context.kit_line_id,
        'quantity', 0
      )
    ),
    summary.updated_at
  ),
  'positive'
)
from supplier_order_stock_entry_context as context
join public.supplier_order_summaries as summary
  on summary.id = context.active_order_id;

select pg_temp.expect_supplier_order_stock_entry_error(
  format(
    'select public.create_supplier_order_stock_entry(%L::uuid, %L::jsonb, null, %L::timestamptz, gen_random_uuid())',
    context.active_order_id,
    jsonb_build_array(
      jsonb_build_object(
        'supplier_order_item_id', context.kit_line_id,
        'quantity', -1
      )
    ),
    summary.updated_at
  ),
  'positive'
)
from supplier_order_stock_entry_context as context
join public.supplier_order_summaries as summary
  on summary.id = context.active_order_id;

select pg_temp.expect_supplier_order_stock_entry_error(
  format(
    'select public.create_supplier_order_stock_entry(%L::uuid, %L::jsonb, %L, %L::timestamptz, %L::uuid)',
    context.active_order_id,
    jsonb_build_array(
      jsonb_build_object(
        'supplier_order_item_id', context.kit_line_id,
        'quantity', 1
      )
    ),
    'different request',
    event.details -> 'request' ->> 'expected_updated_at',
    context.first_key
  ),
  'different'
)
from supplier_order_stock_entry_context as context
join public.supplier_order_events as event
  on event.user_id = context.user_id
 and event.idempotency_key = context.first_key;

select pg_temp.expect_supplier_order_stock_entry_error(
  format(
    'select public.create_supplier_order_stock_entry(%L::uuid, %L::jsonb, null, %L::timestamptz, %L::uuid)',
    context.active_order_id,
    jsonb_build_array(
      jsonb_build_object(
        'supplier_order_item_id', context.kit_line_id,
        'quantity', 1
      )
    ),
    summary.updated_at - interval '1 second',
    context.stale_key
  ),
  'changed after'
)
from supplier_order_stock_entry_context as context
join public.supplier_order_summaries as summary
  on summary.id = context.active_order_id;

-- W-AB: finalized and cancelled orders may enter only picked quantities.
insert into supplier_order_stock_entry_results (test_name, result)
select
  'finalized_entry',
  public.create_supplier_order_stock_entry(
    context.finalized_order_id,
    jsonb_build_array(
      jsonb_build_object(
        'supplier_order_item_id', context.finalized_line_id,
        'quantity', 1
      )
    ),
    null,
    summary.updated_at,
    context.finalized_key
  )
from supplier_order_stock_entry_context as context
join public.supplier_order_summaries as summary
  on summary.id = context.finalized_order_id;

insert into supplier_order_stock_entry_results (test_name, result)
select
  'cancelled_entry',
  public.create_supplier_order_stock_entry(
    context.cancelled_order_id,
    jsonb_build_array(
      jsonb_build_object(
        'supplier_order_item_id', context.cancelled_line_id,
        'quantity', 3
      )
    ),
    null,
    summary.updated_at,
    context.cancelled_key
  )
from supplier_order_stock_entry_context as context
join public.supplier_order_summaries as summary
  on summary.id = context.cancelled_order_id;

-- AQ: after the first serialized operation uses three of four units, a
-- second logical operation sees one available unit and rejects a request for 3.
select pg_temp.expect_supplier_order_stock_entry_error(
  format(
    'select public.create_supplier_order_stock_entry(%L::uuid, %L::jsonb, null, %L::timestamptz, %L::uuid)',
    context.cancelled_order_id,
    jsonb_build_array(
      jsonb_build_object(
        'supplier_order_item_id', context.cancelled_line_id,
        'quantity', 3
      )
    ),
    summary.updated_at,
    context.concurrency_key
  ),
  'cannot exceed'
)
from supplier_order_stock_entry_context as context
join public.supplier_order_summaries as summary
  on summary.id = context.cancelled_order_id;

do $$
declare
  v_context supplier_order_stock_entry_context%rowtype;
  v_cancelled_batch_id uuid;
begin
  select * into v_context from supplier_order_stock_entry_context;
  select (result ->> 'movement_batch_id')::uuid
  into v_cancelled_batch_id
  from supplier_order_stock_entry_results
  where test_name = 'cancelled_entry';

  if not exists (
    select 1
    from public.supplier_order_summaries
    where id = v_context.finalized_order_id
      and is_finalized
      and is_in_history
      and closure_kind = 'FINALIZED'
      and waiting_stock_quantity = 1
  ) then
    raise exception 'W/X/AA/AB failed: finalized state changed.';
  end if;

  if not exists (
    select 1
    from public.supplier_order_summaries
    where id = v_context.cancelled_order_id
      and status = 'CANCELLED'
      and is_in_history
      and closure_kind = 'CANCELLED'
      and waiting_stock_quantity = 1
  ) then
    raise exception 'Y-Z/AA/AB failed: cancelled state changed.';
  end if;

  if exists (
    select 1
    from public.supplier_orders as current_order
    join supplier_order_stock_entry_closure_baseline as baseline
      on baseline.id = current_order.id
    where current_order.id = v_context.finalized_order_id
      and (
        current_order.finalized_at is distinct from baseline.finalized_at
        or current_order.finalized_by is distinct from baseline.finalized_by
        or current_order.finalized_by_name_snapshot
          is distinct from baseline.finalized_by_name_snapshot
        or current_order.finalization_note
          is distinct from baseline.finalization_note
      )
  ) then
    raise exception 'CD failed: finalization metadata changed.';
  end if;

  if exists (
    select 1
    from public.supplier_orders as current_order
    join supplier_order_stock_entry_closure_baseline as baseline
      on baseline.id = current_order.id
    where current_order.id = v_context.cancelled_order_id
      and (
        current_order.cancelled_at is distinct from baseline.cancelled_at
        or current_order.cancellation_note
          is distinct from baseline.cancellation_note
      )
  ) then
    raise exception 'CE failed: cancellation metadata changed.';
  end if;

  if (
    select count(*)
    from public.stock_movements
    where batch_id = v_cancelled_batch_id
      and item_id = v_context.kit_id
  ) <> 1
    or exists (
      select 1
      from public.configuration_stock_movements
      where batch_id = v_cancelled_batch_id
    ) then
    raise exception 'BT/BU failed: kit-only entry did not stay physical.';
  end if;

  if exists (
      select 1
      from public.supplier_order_events
      where idempotency_key = v_context.concurrency_key
    )
    or exists (
      select 1
      from public.movement_batches
      where idempotency_key = v_context.concurrency_key
    ) then
    raise exception 'AQ failed: rejected serialized request left writes.';
  end if;
end;
$$;

-- AS-AY: client roles can read, but only the public wrapper can write.
do $$
begin
  if not has_function_privilege(
    'authenticated',
    'public.create_supplier_order_stock_entry(uuid,jsonb,text,timestamptz,uuid)',
    'EXECUTE'
  ) then
    raise exception 'AS failed: authenticated lacks wrapper EXECUTE.';
  end if;

  if has_function_privilege(
      'anon',
      'public.create_supplier_order_stock_entry(uuid,jsonb,text,timestamptz,uuid)',
      'EXECUTE'
    )
    or exists (
      select 1
      from pg_catalog.pg_proc as function_definition
      cross join lateral pg_catalog.aclexplode(
        coalesce(
          function_definition.proacl,
          pg_catalog.acldefault('f', function_definition.proowner)
        )
      ) as privilege
      where function_definition.oid =
        'public.create_supplier_order_stock_entry(uuid,jsonb,text,timestamptz,uuid)'::regprocedure
        and privilege.grantee = 0
        and privilege.privilege_type = 'EXECUTE'
    ) then
    raise exception 'AU failed: anon or PUBLIC can execute the wrapper.';
  end if;

  if has_function_privilege(
      'authenticated',
      'private.create_supplier_order_stock_entry(uuid,jsonb,text,timestamptz,uuid,uuid,text)',
      'EXECUTE'
    )
    or has_function_privilege(
      'anon',
      'private.create_supplier_order_stock_entry(uuid,jsonb,text,timestamptz,uuid,uuid,text)',
      'EXECUTE'
    )
    or exists (
      select 1
      from pg_catalog.pg_proc as function_definition
      cross join lateral pg_catalog.aclexplode(
        coalesce(
          function_definition.proacl,
          pg_catalog.acldefault('f', function_definition.proowner)
        )
      ) as privilege
      where function_definition.oid =
        'private.create_supplier_order_stock_entry(uuid,jsonb,text,timestamptz,uuid,uuid,text)'::regprocedure
        and privilege.grantee = 0
        and privilege.privilege_type = 'EXECUTE'
    ) then
    raise exception 'AV failed: a client role can execute the private worker.';
  end if;
end;
$$;

select pg_temp.expect_supplier_order_stock_entry_error(
  'update public.supplier_order_items set stocked_quantity = stocked_quantity'
);

select pg_temp.expect_supplier_order_stock_entry_error(
  format(
    'insert into public.supplier_order_stock_entries (supplier_order_id, movement_batch_id, created_by_name_snapshot) values (%L::uuid, gen_random_uuid(), %L)',
    active_order_id,
    user_name
  )
)
from supplier_order_stock_entry_context;

-- CJ: client roles cannot remove immutable stock-entry audit rows.
select pg_temp.expect_supplier_order_stock_entry_error(
  'delete from public.supplier_order_stock_entry_lines where false'
);

select pg_temp.expect_supplier_order_stock_entry_error(
  'delete from public.supplier_order_stock_entries where false'
);

-- CI: security-invoker views honor the active-profile RLS predicate.
reset role;

update public.profiles
set is_active = false
where id = (select user_id from supplier_order_stock_entry_context);

set local role authenticated;

do $$
begin
  if exists (
      select 1
      from public.supplier_order_stock_entry_summaries
    )
    or exists (
      select 1
      from public.supplier_order_stock_entry_line_details
    ) then
    raise exception 'CI failed: an inactive profile read a stock-entry view.';
  end if;
end;
$$;

reset role;

update public.profiles
set is_active = true
where id = (select user_id from supplier_order_stock_entry_context);

set local role authenticated;

-- Force deferred cross-table allocation checks before evaluating the fixture.
set constraints all immediate;

do $$
declare
  v_context supplier_order_stock_entry_context%rowtype;
  v_first_entry_id uuid;
  v_first_batch_id uuid;
begin
  select * into v_context from supplier_order_stock_entry_context;
  select
    (result ->> 'supplier_order_stock_entry_id')::uuid,
    (result ->> 'movement_batch_id')::uuid
  into v_first_entry_id, v_first_batch_id
  from supplier_order_stock_entry_results
  where test_name = 'first_entry';

  if (
    select count(*)
    from public.supplier_order_stock_entries
    where supplier_order_id in (
      v_context.active_order_id,
      v_context.finalized_order_id,
      v_context.cancelled_order_id
    )
  ) <> 5 then
    raise exception 'AC-AH failed: expected exactly five stock entries.';
  end if;

  if (
    select count(*)
    from public.movement_batches
    where id in (
      select movement_batch_id
      from public.supplier_order_stock_entries
      where supplier_order_id in (
        v_context.active_order_id,
        v_context.finalized_order_id,
        v_context.cancelled_order_id
      )
    )
  ) <> 5 then
    raise exception 'AC-AH failed: expected exactly five movement batches.';
  end if;

  if (
    select count(distinct movement_batch_id)
    from public.supplier_order_stock_entries
    where supplier_order_id in (
      v_context.active_order_id,
      v_context.finalized_order_id,
      v_context.cancelled_order_id
    )
  ) <> 5 then
    raise exception 'BO/BP failed: an entry did not own exactly one unique batch.';
  end if;

  if exists (
    select 1
    from public.supplier_order_stock_entry_lines as entry_line
    join public.supplier_order_items as order_item
      on order_item.id = entry_line.supplier_order_item_id
    where entry_line.item_id is distinct from order_item.item_id
      or entry_line.commercial_configuration_id
        is distinct from order_item.commercial_configuration_id
  ) then
    raise exception 'AY failed: a linked target differs from its order item.';
  end if;

  if exists (
    select 1
    from public.supplier_order_stock_entry_lines as entry_line
    join public.supplier_order_stock_entries as entry
      on entry.id = entry_line.supplier_order_stock_entry_id
    join public.inbound_batch_lines as inbound_line
      on inbound_line.id = entry_line.inbound_batch_line_id
    where entry.supplier_order_id in (
      v_context.active_order_id,
      v_context.finalized_order_id,
      v_context.cancelled_order_id
    )
      and inbound_line.batch_id <> entry.movement_batch_id
  ) then
    raise exception 'BQ/BZ failed: a link does not reference its real batch line.';
  end if;

  if exists (
    select 1
    from public.supplier_order_stock_entries as entry
    cross join lateral (
      select coalesce(sum(entry_line.quantity), 0)::bigint as quantity
      from public.supplier_order_stock_entry_lines as entry_line
      where entry_line.supplier_order_stock_entry_id = entry.id
    ) as linked
    cross join lateral (
      select coalesce(sum(inbound_line.quantity), 0)::bigint as quantity
      from public.inbound_batch_lines as inbound_line
      where inbound_line.batch_id = entry.movement_batch_id
    ) as inbound
    where entry.supplier_order_id in (
      v_context.active_order_id,
      v_context.finalized_order_id,
      v_context.cancelled_order_id
    )
      and linked.quantity <> inbound.quantity
  ) then
    raise exception 'BR failed: linked and inbound totals differ.';
  end if;

  if exists (
    select 1
    from public.supplier_order_items as order_item
    cross join lateral (
      select coalesce(sum(entry_line.quantity), 0)::bigint as quantity
      from public.supplier_order_stock_entry_lines as entry_line
      where entry_line.supplier_order_item_id = order_item.id
    ) as linked
    where order_item.supplier_order_id in (
      v_context.active_order_id,
      v_context.finalized_order_id,
      v_context.cancelled_order_id
    )
      and linked.quantity <> order_item.stocked_quantity
  ) then
    raise exception 'BS failed: linked history differs from stocked_quantity.';
  end if;

  if (
    select count(distinct entry_line.commercial_configuration_id)
    from public.supplier_order_stock_entry_lines as entry_line
    where entry_line.supplier_order_stock_entry_id = v_first_entry_id
      and entry_line.supplier_order_item_id in (
        v_context.code_1b_line_id,
        v_context.code_1d_line_id
      )
  ) <> 1
    or (
      select coalesce(sum(quantity_change), 0)
      from public.configuration_stock_movements
      where batch_id = v_first_batch_id
        and configuration_id = v_context.configuration_id
    ) <> 2 then
    raise exception 'BV failed: aliases did not share one physical configuration movement.';
  end if;

  if exists (
    select 1
    from public.supplier_order_stock_entries as entry
    join public.movement_batches as batch
      on batch.id = entry.movement_batch_id
    where entry.supplier_order_id in (
      v_context.active_order_id,
      v_context.finalized_order_id,
      v_context.cancelled_order_id
    )
      and (
        batch.movement_type <> 'INBOUND'
        or batch.source <> 'MANUAL'
        or batch.description not like 'Entrada pelo pedido %'
      )
  ) then
    raise exception 'BY/CA-CC failed: a batch is not a normal external inbound.';
  end if;

  if exists (
      select 1
      from public.outbound_batch_lines
      where batch_id in (
        select movement_batch_id
        from public.supplier_order_stock_entries
        where supplier_order_id in (
          v_context.active_order_id,
          v_context.finalized_order_id,
          v_context.cancelled_order_id
        )
      )
    )
    or exists (
      select 1
      from public.assembly_operations
      where batch_id in (
        select movement_batch_id
        from public.supplier_order_stock_entries
        where supplier_order_id in (
          v_context.active_order_id,
          v_context.finalized_order_id,
          v_context.cancelled_order_id
        )
      )
    ) then
    raise exception 'CB/CC failed: inbound entries leaked into outbound or internal operations.';
  end if;

  if (
    select coalesce(sum(inbound_line.quantity), 0)::bigint
    from public.inbound_batch_lines as inbound_line
    where inbound_line.batch_id in (
      select movement_batch_id
      from public.supplier_order_stock_entries
      where supplier_order_id in (
        v_context.active_order_id,
        v_context.finalized_order_id,
        v_context.cancelled_order_id
      )
    )
  ) <> (
    select coalesce(sum(entry_line.quantity), 0)::bigint
    from public.supplier_order_stock_entry_lines as entry_line
    join public.supplier_order_stock_entries as entry
      on entry.id = entry_line.supplier_order_stock_entry_id
    where entry.supplier_order_id in (
      v_context.active_order_id,
      v_context.finalized_order_id,
      v_context.cancelled_order_id
    )
  ) then
    raise exception 'CA failed: Statistics inbound quantity differs from linked quantity.';
  end if;

  if exists (
    select 1
    from (
      values
        (
          v_context.active_order_id,
          'third_entry'::text
        ),
        (
          v_context.finalized_order_id,
          'finalized_entry'::text
        ),
        (
          v_context.cancelled_order_id,
          'cancelled_entry'::text
        )
    ) as expected(order_id, test_name)
    join public.supplier_orders as supplier_order
      on supplier_order.id = expected.order_id
    join supplier_order_stock_entry_results as result
      on result.test_name = expected.test_name
    where supplier_order.updated_at is distinct from
      (result.result ->> 'updated_at')::timestamptz
  ) then
    raise exception 'CF failed: returned and persisted updated_at differ.';
  end if;
end;
$$;

-- BA-BI: remove every fixture and stock delta, then compare exact baselines.
rollback to savepoint supplier_order_stock_entry_test;

do $$
declare
  v_before jsonb;
  v_after jsonb;
begin
  select signature into v_before
  from supplier_order_stock_entry_baseline;

  select jsonb_build_object(
    'supplier_orders', (select count(*) from public.supplier_orders),
    'supplier_order_items', (
      select count(*) from public.supplier_order_items
    ),
    'supplier_order_events', (
      select count(*) from public.supplier_order_events
    ),
    'supplier_order_stock_entries', (
      select count(*) from public.supplier_order_stock_entries
    ),
    'supplier_order_stock_entry_lines', (
      select count(*) from public.supplier_order_stock_entry_lines
    ),
    'movement_batches', (select count(*) from public.movement_batches),
    'inbound_batch_lines', (
      select count(*) from public.inbound_batch_lines
    ),
    'outbound_batch_lines', (
      select count(*) from public.outbound_batch_lines
    ),
    'stock_movements', (select count(*) from public.stock_movements),
    'configuration_stock_movements', (
      select count(*) from public.configuration_stock_movements
    ),
    'assembly_operations', (
      select count(*) from public.assembly_operations
    ),
    'item_minimums', (
      select jsonb_build_object(
        'quantity', coalesce(sum(minimum_stock), 0),
        'signature', md5(
          coalesce(
            string_agg(
              id::text
                || ':' || minimum_stock::text
                || ':' || updated_at::text,
              ',' order by id
            ),
            ''
          )
        )
      )
      from public.items
    ),
    'configuration_minimums', (
      select jsonb_build_object(
        'quantity', coalesce(sum(minimum_stock), 0),
        'signature', md5(
          coalesce(
            string_agg(
              id::text
                || ':' || minimum_stock::text
                || ':' || updated_at::text,
              ',' order by id
            ),
            ''
          )
        )
      )
      from public.commercial_configurations
    ),
    'statistics_dataset_batches', (
      select count(*)
      from public.movement_batches
      where description like 'NK_STATS_TEST_V1%'
    ),
    'stock_balances', (
      select jsonb_build_object(
        'count', count(*),
        'quantity', coalesce(sum(quantity), 0),
        'signature', md5(
          coalesce(
            string_agg(
              item_id::text
                || ':' || quantity::text
                || ':' || updated_at::text,
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
  ) into v_after;

  if v_after is distinct from v_before then
    raise exception 'BA-BI failed: rollback did not restore the exact baseline.';
  end if;
end;
$$;

rollback;
