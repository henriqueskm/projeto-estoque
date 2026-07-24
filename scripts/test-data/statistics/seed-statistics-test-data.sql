\set ON_ERROR_STOP on

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

lock table public.movement_batches in share row exclusive mode nowait;
lock table public.inbound_batch_lines in share row exclusive mode nowait;
lock table public.outbound_batch_lines in share row exclusive mode nowait;
lock table public.stock_movements in share row exclusive mode nowait;
lock table public.configuration_stock_movements
  in share row exclusive mode nowait;
lock table public.assembly_operations in share row exclusive mode nowait;
lock table public.stock_balances in share row exclusive mode nowait;
lock table public.configuration_stock_balances
  in share row exclusive mode nowait;
lock table private.stock_adjustment_requests
  in share row exclusive mode nowait;
lock table private.configuration_operation_requests
  in share row exclusive mode nowait;

do $$
begin
  if exists (
    select 1
    from public.movement_batches
    where split_part(coalesce(description, ''), '|', 1) =
      'NK_STATS_TEST_V1'
  ) then
    raise exception using
      errcode = 'P0001',
      message =
        'NK_STATS_TEST_V1 already exists. Run its verified reset before reseeding.';
  end if;
end;
$$;

create temporary table nk_stats_actor on commit drop as
select id, btrim(name) as name
from public.profiles
where is_active
  and nullif(btrim(name), '') is not null
order by id
limit 1;

do $$
begin
  if (select count(*) from pg_temp.nk_stats_actor) <> 1 then
    raise exception using
      errcode = 'P0001',
      message =
        'NK_STATS_TEST_V1 requires one existing active profile with a registered name.';
  end if;
end;
$$;

create temporary table nk_stats_required_items (
  code text primary key,
  expected_type text not null,
  should_move boolean not null
) on commit drop;

insert into nk_stats_required_items (code, expected_type, should_move)
values
  ('1', 'SERVO', true),
  ('2', 'SERVO', true),
  ('1INV', 'SERVO', true),
  ('1DESL', 'SERVO', true),
  ('6RB', 'SERVO', true),
  ('3', 'SERVO', false),
  ('KT-02', 'INSTALLATION_KIT', true),
  ('KT-18', 'INSTALLATION_KIT', true),
  ('KT-07', 'INSTALLATION_KIT', true),
  ('KT-29', 'INSTALLATION_KIT', true),
  ('KT-71', 'INSTALLATION_KIT', true),
  ('R064', 'REPAIR_KIT', true),
  ('110', 'LOOSE_PART', true);

create temporary table nk_stats_items on commit drop as
select
  required.code,
  item.id as item_id,
  item.item_type,
  item.description,
  required.should_move
from nk_stats_required_items as required
join public.items as item
  on item.code = required.code
 and item.item_type = required.expected_type
 and item.is_active;

do $$
begin
  if (select count(*) from pg_temp.nk_stats_items) <>
    (select count(*) from pg_temp.nk_stats_required_items) then
    raise exception using
      errcode = 'P0001',
      message =
        'NK_STATS_TEST_V1 required item catalog is incomplete, inactive, or has an unexpected type.';
  end if;
end;
$$;

create temporary table nk_stats_required_codes (
  code text primary key,
  should_move boolean not null
) on commit drop;

insert into nk_stats_required_codes (code, should_move)
values
  ('1B', true),
  ('1D', true),
  ('2A', true),
  ('1F', true),
  ('1H', true),
  ('6P', true),
  ('3A', false);

create temporary table nk_stats_codes on commit drop as
select
  required.code,
  commercial_code.id as commercial_code_id,
  commercial_code.configuration_id,
  configuration.servo_id,
  configuration.installation_kit_id,
  required.should_move
from nk_stats_required_codes as required
join public.commercial_configuration_codes as commercial_code
  on commercial_code.code = required.code
 and commercial_code.is_active
join public.commercial_configurations as configuration
  on configuration.id = commercial_code.configuration_id
 and configuration.is_active
join public.items as servo
  on servo.id = configuration.servo_id
 and servo.item_type = 'SERVO'
 and servo.is_active
join public.items as installation_kit
  on installation_kit.id = configuration.installation_kit_id
 and installation_kit.item_type = 'INSTALLATION_KIT'
 and installation_kit.is_active;

do $$
begin
  if (select count(*) from pg_temp.nk_stats_codes) <>
    (select count(*) from pg_temp.nk_stats_required_codes) then
    raise exception using
      errcode = 'P0001',
      message =
        'NK_STATS_TEST_V1 required commercial catalog is incomplete or inactive.';
  end if;

  if (
    select count(distinct configuration_id)
    from pg_temp.nk_stats_codes
    where code in ('1B', '1D')
  ) <> 1 then
    raise exception using
      errcode = 'P0001',
      message = 'Commercial aliases 1B and 1D must share one physical configuration.';
  end if;
end;
$$;

create temporary table nk_stats_batches (
  sequence_number integer primary key,
  batch_id uuid not null unique,
  idempotency_key uuid not null unique,
  batch_key text not null unique,
  days_ago integer not null,
  movement_type text not null,
  label text not null
) on commit drop;

insert into nk_stats_batches (
  sequence_number,
  batch_id,
  idempotency_key,
  batch_key,
  days_ago,
  movement_type,
  label
)
select
  event.sequence_number,
  (
    '7a7a0000-0000-4000-8000-' ||
    lpad(event.sequence_number::text, 12, '0')
  )::uuid,
  (
    '8b8b0000-0000-4000-8000-' ||
    lpad(event.sequence_number::text, 12, '0')
  )::uuid,
  'B' || lpad(event.sequence_number::text, 3, '0'),
  event.days_ago,
  event.movement_type,
  event.label
from (
  values
    (1, 88, 'INBOUND', 'INBOUND_SERVO_1'),
    (2, 87, 'INBOUND', 'INBOUND_KT_02'),
    (3, 85, 'INBOUND', 'INBOUND_SERVO_2'),
    (4, 84, 'INBOUND', 'INBOUND_KT_18'),
    (5, 82, 'INBOUND', 'INBOUND_R064'),
    (6, 81, 'INBOUND', 'INBOUND_LOOSE_PART_110'),
    (7, 79, 'INBOUND', 'INBOUND_SERVO_1INV'),
    (8, 78, 'INBOUND', 'INBOUND_KT_07'),
    (9, 77, 'INBOUND', 'INBOUND_SERVO_1DESL'),
    (10, 76, 'INBOUND', 'INBOUND_KT_29'),
    (11, 75, 'INBOUND', 'INBOUND_SERVO_6RB'),
    (12, 74, 'INBOUND', 'INBOUND_KT_71'),
    (13, 70, 'ASSEMBLY', 'ASSEMBLY_1B'),
    (14, 64, 'OUTBOUND', 'OUTBOUND_BOX_1B'),
    (15, 58, 'OUTBOUND', 'OUTBOUND_SERVO_1'),
    (16, 54, 'OUTBOUND', 'OUTBOUND_KT_02'),
    (17, 50, 'OUTBOUND', 'OUTBOUND_R064'),
    (18, 46, 'OUTBOUND', 'OUTBOUND_LOOSE_PART_110'),
    (19, 42, 'ASSEMBLY', 'ASSEMBLY_2A'),
    (20, 38, 'OUTBOUND', 'OUTBOUND_BOX_2A'),
    (21, 34, 'DISASSEMBLY', 'DISASSEMBLY_1B'),
    (22, 30, 'ASSEMBLY', 'ASSEMBLY_1F'),
    (23, 26, 'OUTBOUND', 'OUTBOUND_BOX_1F'),
    (24, 22, 'ASSEMBLY', 'ASSEMBLY_1H'),
    (25, 18, 'OUTBOUND', 'OUTBOUND_BOX_1H'),
    (26, 14, 'ASSEMBLY', 'ASSEMBLY_6P'),
    (27, 10, 'OUTBOUND', 'OUTBOUND_BOX_6P'),
    (28, 6, 'OUTBOUND', 'OUTBOUND_BOX_1D_ALIAS'),
    (29, 3, 'INBOUND', 'REPLENISH_SERVO_1'),
    (30, 1, 'OUTBOUND', 'INTENSE_DAY_OUTBOUND_SERVO_1')
) as event(sequence_number, days_ago, movement_type, label);

do $$
begin
  if exists (
    select 1
    from pg_temp.nk_stats_batches as planned
    join public.movement_batches as existing
      on existing.id = planned.batch_id
      or (
        existing.user_id = (select id from pg_temp.nk_stats_actor)
        and existing.idempotency_key = planned.idempotency_key
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'A UUID reserved for NK_STATS_TEST_V1 is already in use.';
  end if;
end;
$$;

create temporary table nk_stats_stock_plan (
  batch_sequence integer not null,
  item_code text not null,
  quantity_change integer not null,
  primary key (batch_sequence, item_code)
) on commit drop;

insert into nk_stats_stock_plan values
  (1, '1', 30),
  (2, 'KT-02', 24),
  (3, '2', 12),
  (4, 'KT-18', 10),
  (5, 'R064', 12),
  (6, '110', 10),
  (7, '1INV', 6),
  (8, 'KT-07', 6),
  (9, '1DESL', 5),
  (10, 'KT-29', 5),
  (11, '6RB', 4),
  (12, 'KT-71', 4),
  (13, '1', -10),
  (13, 'KT-02', -10),
  (15, '1', -6),
  (16, 'KT-02', -3),
  (17, 'R064', -5),
  (18, '110', -4),
  (19, '2', -5),
  (19, 'KT-18', -5),
  (21, '1', 2),
  (21, 'KT-02', 2),
  (22, '1INV', -3),
  (22, 'KT-07', -3),
  (24, '1DESL', -2),
  (24, 'KT-29', -2),
  (26, '6RB', -2),
  (26, 'KT-71', -2),
  (29, '1', 8),
  (30, '1', -5);

create temporary table nk_stats_configuration_plan (
  batch_sequence integer primary key,
  commercial_code text not null,
  quantity_change integer not null
) on commit drop;

insert into nk_stats_configuration_plan values
  (13, '1B', 10),
  (14, '1B', -4),
  (19, '2A', 5),
  (20, '2A', -2),
  (21, '1B', -2),
  (22, '1F', 3),
  (23, '1F', -2),
  (24, '1H', 2),
  (25, '1H', -1),
  (26, '6P', 2),
  (27, '6P', -1),
  (28, '1D', -2);

create temporary table nk_stats_item_baseline on commit drop as
select
  item.item_id,
  item.code,
  balance.item_id is not null as row_existed,
  coalesce(balance.quantity, 0)::integer as quantity,
  balance.updated_at
from nk_stats_items as item
left join public.stock_balances as balance
  on balance.item_id = item.item_id
where item.should_move;

create temporary table nk_stats_configuration_baseline on commit drop as
select distinct on (code.configuration_id)
  code.configuration_id,
  code.code,
  balance.configuration_id is not null as row_existed,
  coalesce(balance.quantity, 0)::integer as quantity,
  balance.updated_at
from nk_stats_codes as code
left join public.configuration_stock_balances as balance
  on balance.configuration_id = code.configuration_id
where code.should_move
order by code.configuration_id, code.code;

create temporary table nk_stats_resolved_stock_movements on commit drop as
select
  plan.batch_sequence,
  item.item_id,
  item.code,
  plan.quantity_change,
  (
    baseline.quantity::bigint +
    coalesce(
      sum(plan.quantity_change) over (
        partition by item.item_id
        order by plan.batch_sequence
        rows between unbounded preceding and 1 preceding
      ),
      0
    )
  ) as quantity_before,
  (
    baseline.quantity::bigint +
    sum(plan.quantity_change) over (
      partition by item.item_id
      order by plan.batch_sequence
      rows between unbounded preceding and current row
    )
  ) as quantity_after
from nk_stats_stock_plan as plan
join nk_stats_items as item
  on item.code = plan.item_code
join nk_stats_item_baseline as baseline
  on baseline.item_id = item.item_id;

create temporary table nk_stats_resolved_configuration_movements
on commit drop as
select
  plan.batch_sequence,
  code.configuration_id,
  code.commercial_code_id,
  code.code,
  plan.quantity_change,
  (
    baseline.quantity::bigint +
    coalesce(
      sum(plan.quantity_change) over (
        partition by code.configuration_id
        order by plan.batch_sequence
        rows between unbounded preceding and 1 preceding
      ),
      0
    )
  ) as quantity_before,
  (
    baseline.quantity::bigint +
    sum(plan.quantity_change) over (
      partition by code.configuration_id
      order by plan.batch_sequence
      rows between unbounded preceding and current row
    )
  ) as quantity_after
from nk_stats_configuration_plan as plan
join nk_stats_codes as code
  on code.code = plan.commercial_code
join nk_stats_configuration_baseline as baseline
  on baseline.configuration_id = code.configuration_id;

do $$
begin
  if exists (
    select 1
    from pg_temp.nk_stats_resolved_stock_movements
    where quantity_before < 0
       or quantity_after < 0
       or quantity_before > 2147483647
       or quantity_after > 2147483647
  ) or exists (
    select 1
    from pg_temp.nk_stats_resolved_configuration_movements
    where quantity_before < 0
       or quantity_after < 0
       or quantity_before > 2147483647
       or quantity_after > 2147483647
  ) then
    raise exception using
      errcode = '22003',
      message =
        'NK_STATS_TEST_V1 would create a negative or overflowing balance.';
  end if;
end;
$$;

insert into public.movement_batches (
  id,
  movement_type,
  source,
  user_id,
  user_name_snapshot,
  description,
  idempotency_key,
  inbound_request_payload,
  occurred_at,
  created_at
)
select
  batch.batch_id,
  batch.movement_type,
  'MANUAL',
  actor.id,
  actor.name,
  'NK_STATS_TEST_V1|' || batch.batch_key || '|' || batch.label,
  batch.idempotency_key,
  case
    when batch.sequence_number = 1 then jsonb_build_array(
      jsonb_build_object(
        'kind', 'NK_STATS_TEST_MANIFEST',
        'dataset', 'NK_STATS_TEST_V1',
        'seeded_at', current_timestamp,
        'item_balances', (
          select jsonb_agg(
            jsonb_build_object(
              'item_id', baseline.item_id,
              'code', baseline.code,
              'row_existed', baseline.row_existed,
              'quantity', baseline.quantity,
              'updated_at', baseline.updated_at
            )
            order by baseline.code
          )
          from nk_stats_item_baseline as baseline
        ),
        'configuration_balances', (
          select jsonb_agg(
            jsonb_build_object(
              'configuration_id', baseline.configuration_id,
              'representative_code', baseline.code,
              'row_existed', baseline.row_existed,
              'quantity', baseline.quantity,
              'updated_at', baseline.updated_at
            )
            order by baseline.code
          )
          from nk_stats_configuration_baseline as baseline
        )
      )
    )
    else null
  end,
  date_trunc('day', current_timestamp)
    - make_interval(days => batch.days_ago)
    + make_interval(hours => 9 + batch.sequence_number % 8),
  current_timestamp
from nk_stats_batches as batch
cross join nk_stats_actor as actor
order by batch.sequence_number;

insert into public.stock_movements (
  batch_id,
  item_id,
  quantity_change,
  quantity_before,
  quantity_after,
  created_at
)
select
  batch.batch_id,
  movement.item_id,
  movement.quantity_change,
  movement.quantity_before::integer,
  movement.quantity_after::integer,
  batch_row.occurred_at
from nk_stats_resolved_stock_movements as movement
join nk_stats_batches as batch
  on batch.sequence_number = movement.batch_sequence
join public.movement_batches as batch_row
  on batch_row.id = batch.batch_id
order by movement.batch_sequence, movement.item_id;

insert into public.configuration_stock_movements (
  batch_id,
  configuration_id,
  quantity_change,
  quantity_before,
  quantity_after,
  created_at
)
select
  batch.batch_id,
  movement.configuration_id,
  movement.quantity_change,
  movement.quantity_before::integer,
  movement.quantity_after::integer,
  batch_row.occurred_at
from nk_stats_resolved_configuration_movements as movement
join nk_stats_batches as batch
  on batch.sequence_number = movement.batch_sequence
join public.movement_batches as batch_row
  on batch_row.id = batch.batch_id
order by movement.batch_sequence;

insert into public.inbound_batch_lines (
  batch_id,
  item_id,
  quantity,
  created_at
)
select
  batch.batch_id,
  movement.item_id,
  movement.quantity_change,
  batch_row.occurred_at
from nk_stats_resolved_stock_movements as movement
join nk_stats_batches as batch
  on batch.sequence_number = movement.batch_sequence
 and batch.movement_type = 'INBOUND'
join public.movement_batches as batch_row
  on batch_row.id = batch.batch_id;

create temporary table nk_stats_outbound_lines (
  batch_sequence integer primary key,
  target_kind text not null,
  target_code text not null,
  quantity integer not null
) on commit drop;

insert into nk_stats_outbound_lines values
  (14, 'COMMERCIAL_CODE', '1B', 4),
  (15, 'ITEM', '1', 6),
  (16, 'ITEM', 'KT-02', 3),
  (17, 'ITEM', 'R064', 5),
  (18, 'ITEM', '110', 4),
  (20, 'COMMERCIAL_CODE', '2A', 2),
  (23, 'COMMERCIAL_CODE', '1F', 2),
  (25, 'COMMERCIAL_CODE', '1H', 1),
  (27, 'COMMERCIAL_CODE', '6P', 1),
  (28, 'COMMERCIAL_CODE', '1D', 2),
  (30, 'ITEM', '1', 5);

insert into public.outbound_batch_lines (
  batch_id,
  item_id,
  commercial_configuration_code_id,
  quantity,
  assembled_quantity_used,
  auto_assembled_quantity,
  created_at
)
select
  batch.batch_id,
  case when line.target_kind = 'ITEM' then item.item_id end,
  case
    when line.target_kind = 'COMMERCIAL_CODE'
      then code.commercial_code_id
  end,
  line.quantity,
  case
    when line.target_kind = 'COMMERCIAL_CODE' then line.quantity
    else 0
  end,
  0,
  batch_row.occurred_at
from nk_stats_outbound_lines as line
join nk_stats_batches as batch
  on batch.sequence_number = line.batch_sequence
join public.movement_batches as batch_row
  on batch_row.id = batch.batch_id
left join nk_stats_items as item
  on line.target_kind = 'ITEM'
 and item.code = line.target_code
left join nk_stats_codes as code
  on line.target_kind = 'COMMERCIAL_CODE'
 and code.code = line.target_code;

create temporary table nk_stats_assembly_plan (
  batch_sequence integer primary key,
  commercial_code text not null,
  operation_type text not null,
  quantity integer not null
) on commit drop;

insert into nk_stats_assembly_plan values
  (13, '1B', 'ASSEMBLY', 10),
  (19, '2A', 'ASSEMBLY', 5),
  (21, '1B', 'DISASSEMBLY', 2),
  (22, '1F', 'ASSEMBLY', 3),
  (24, '1H', 'ASSEMBLY', 2),
  (26, '6P', 'ASSEMBLY', 2);

insert into public.assembly_operations (
  batch_id,
  configuration_id,
  commercial_configuration_code_id,
  commercial_code_snapshot,
  operation_type,
  quantity,
  created_at
)
select
  batch.batch_id,
  code.configuration_id,
  code.commercial_code_id,
  code.code,
  operation.operation_type,
  operation.quantity,
  batch_row.occurred_at
from nk_stats_assembly_plan as operation
join nk_stats_batches as batch
  on batch.sequence_number = operation.batch_sequence
join public.movement_batches as batch_row
  on batch_row.id = batch.batch_id
join nk_stats_codes as code
  on code.code = operation.commercial_code;

insert into public.stock_balances (item_id, quantity, updated_at)
select
  baseline.item_id,
  (
    baseline.quantity::bigint + sum(movement.quantity_change)::bigint
  )::integer,
  current_timestamp
from nk_stats_item_baseline as baseline
join nk_stats_resolved_stock_movements as movement
  on movement.item_id = baseline.item_id
group by baseline.item_id, baseline.quantity
on conflict (item_id) do update
set
  quantity = excluded.quantity,
  updated_at = excluded.updated_at;

insert into public.configuration_stock_balances (
  configuration_id,
  quantity,
  updated_at
)
select
  baseline.configuration_id,
  (
    baseline.quantity::bigint + sum(movement.quantity_change)::bigint
  )::integer,
  current_timestamp
from nk_stats_configuration_baseline as baseline
join nk_stats_resolved_configuration_movements as movement
  on movement.configuration_id = baseline.configuration_id
group by baseline.configuration_id, baseline.quantity
on conflict (configuration_id) do update
set
  quantity = excluded.quantity,
  updated_at = excluded.updated_at;

do $$
declare
  v_dataset_batches integer;
begin
  select count(*)
  into v_dataset_batches
  from public.movement_batches
  where split_part(coalesce(description, ''), '|', 1) =
    'NK_STATS_TEST_V1';

  if v_dataset_batches <> 30
    or (
      select count(*)
      from public.inbound_batch_lines as line
      join public.movement_batches as batch on batch.id = line.batch_id
      where split_part(coalesce(batch.description, ''), '|', 1) =
        'NK_STATS_TEST_V1'
    ) <> 13
    or (
      select count(*)
      from public.outbound_batch_lines as line
      join public.movement_batches as batch on batch.id = line.batch_id
      where split_part(coalesce(batch.description, ''), '|', 1) =
        'NK_STATS_TEST_V1'
    ) <> 11
    or (
      select count(*)
      from public.stock_movements as movement
      join public.movement_batches as batch on batch.id = movement.batch_id
      where split_part(coalesce(batch.description, ''), '|', 1) =
        'NK_STATS_TEST_V1'
    ) <> 30
    or (
      select count(*)
      from public.configuration_stock_movements as movement
      join public.movement_batches as batch on batch.id = movement.batch_id
      where split_part(coalesce(batch.description, ''), '|', 1) =
        'NK_STATS_TEST_V1'
    ) <> 12
    or (
      select count(*)
      from public.assembly_operations as operation
      join public.movement_batches as batch on batch.id = operation.batch_id
      where split_part(coalesce(batch.description, ''), '|', 1) =
        'NK_STATS_TEST_V1'
    ) <> 6 then
    raise exception using
      errcode = 'P0001',
      message = 'NK_STATS_TEST_V1 final record counts are inconsistent.';
  end if;

  if exists (select 1 from public.stock_balances where quantity < 0)
    or exists (
      select 1
      from public.configuration_stock_balances
      where quantity < 0
    ) then
    raise exception using
      errcode = '23514',
      message = 'NK_STATS_TEST_V1 final balance validation failed.';
  end if;
end;
$$;

commit;
