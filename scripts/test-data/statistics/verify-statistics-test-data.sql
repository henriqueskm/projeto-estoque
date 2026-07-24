\set ON_ERROR_STOP on

begin transaction read only;

-- Dataset identity, period, and records created.
with dataset_batches as (
  select batch.*
  from public.movement_batches as batch
  where split_part(coalesce(batch.description, ''), '|', 1) =
    'NK_STATS_TEST_V1'
)
select
  'NK_STATS_TEST_V1' as dataset,
  count(*) as movement_batches,
  min(occurred_at) as first_movement_at,
  max(occurred_at) as last_movement_at,
  count(*) filter (
    where current_date - occurred_at::date between 61 and 90
  ) as batches_days_61_to_90,
  count(*) filter (
    where current_date - occurred_at::date between 31 and 60
  ) as batches_days_31_to_60,
  count(*) filter (
    where current_date - occurred_at::date between 0 and 30
  ) as batches_days_0_to_30
from dataset_batches;

with dataset_batches as (
  select batch.id
  from public.movement_batches as batch
  where split_part(coalesce(batch.description, ''), '|', 1) =
    'NK_STATS_TEST_V1'
)
select
  (select count(*) from public.inbound_batch_lines as line
    join dataset_batches as batch on batch.id = line.batch_id)
    as inbound_batch_lines,
  (select count(*) from public.outbound_batch_lines as line
    join dataset_batches as batch on batch.id = line.batch_id)
    as outbound_batch_lines,
  (select count(*) from public.stock_movements as movement
    join dataset_batches as batch on batch.id = movement.batch_id)
    as stock_movements,
  (select count(*) from public.configuration_stock_movements as movement
    join dataset_batches as batch on batch.id = movement.batch_id)
    as configuration_stock_movements,
  (select count(*) from public.assembly_operations as operation
    join dataset_batches as batch on batch.id = operation.batch_id)
    as assembly_operations,
  (select count(*) from private.configuration_operation_requests as request
    join dataset_batches as batch on batch.id = request.movement_batch_id)
    as configuration_operation_requests,
  (select count(*) from private.stock_adjustment_requests as request
    join dataset_batches as batch on batch.id = request.movement_batch_id)
    as stock_adjustment_requests;

-- Quantities by external and internal operation.
with dataset_batches as (
  select batch.id
  from public.movement_batches as batch
  where split_part(coalesce(batch.description, ''), '|', 1) =
    'NK_STATS_TEST_V1'
),
quantities as (
  select
    'INBOUND'::text as operation,
    coalesce(sum(line.quantity), 0)::bigint as quantity
  from public.inbound_batch_lines as line
  join dataset_batches as batch on batch.id = line.batch_id

  union all

  select
    'OUTBOUND',
    coalesce(sum(line.quantity), 0)::bigint
  from public.outbound_batch_lines as line
  join dataset_batches as batch on batch.id = line.batch_id

  union all

  select
    operation.operation_type,
    coalesce(sum(operation.quantity), 0)::bigint
  from public.assembly_operations as operation
  join dataset_batches as batch on batch.id = operation.batch_id
  group by operation.operation_type
)
select operation, quantity
from quantities
order by operation;

-- External outbound quantities by operational category.
with dataset_batches as (
  select batch.id
  from public.movement_batches as batch
  where split_part(coalesce(batch.description, ''), '|', 1) =
    'NK_STATS_TEST_V1'
),
categorized as (
  select
    case
      when line.commercial_configuration_code_id is not null
        then 'commercial_configuration'
      when item.item_type = 'SERVO' then 'servo_without_kit'
      when item.item_type = 'INSTALLATION_KIT'
        then 'installation_kit_loose'
      when item.item_type = 'REPAIR_KIT' then 'repair_kit'
      when item.item_type = 'LOOSE_PART' then 'loose_part'
      else 'unexpected'
    end as category,
    line.quantity
  from public.outbound_batch_lines as line
  join dataset_batches as batch on batch.id = line.batch_id
  left join public.items as item on item.id = line.item_id
)
select category, sum(quantity)::bigint as quantity
from categorized
group by category
order by category;

-- Commercial aliases remain an audit dimension; physical stock is grouped once.
with dataset_batches as (
  select batch.id
  from public.movement_batches as batch
  where split_part(coalesce(batch.description, ''), '|', 1) =
    'NK_STATS_TEST_V1'
),
commercial_outbound as (
  select
    code.code as commercial_code,
    code.configuration_id,
    servo.code as servo_code,
    kit.code as kit_code,
    line.quantity
  from public.outbound_batch_lines as line
  join dataset_batches as batch on batch.id = line.batch_id
  join public.commercial_configuration_codes as code
    on code.id = line.commercial_configuration_code_id
  join public.commercial_configurations as configuration
    on configuration.id = code.configuration_id
  join public.items as servo on servo.id = configuration.servo_id
  join public.items as kit on kit.id = configuration.installation_kit_id
)
select
  commercial_code,
  configuration_id,
  servo_code || '::' || kit_code as physical_configuration,
  sum(quantity)::bigint as quantity
from commercial_outbound
group by commercial_code, configuration_id, servo_code, kit_code
order by commercial_code;

with dataset_batches as (
  select batch.id
  from public.movement_batches as batch
  where split_part(coalesce(batch.description, ''), '|', 1) =
    'NK_STATS_TEST_V1'
),
commercial_outbound as (
  select
    code.configuration_id,
    servo.code as servo_code,
    kit.code as kit_code,
    line.quantity
  from public.outbound_batch_lines as line
  join dataset_batches as batch on batch.id = line.batch_id
  join public.commercial_configuration_codes as code
    on code.id = line.commercial_configuration_code_id
  join public.commercial_configurations as configuration
    on configuration.id = code.configuration_id
  join public.items as servo on servo.id = configuration.servo_id
  join public.items as kit on kit.id = configuration.installation_kit_id
)
select
  configuration_id,
  servo_code || '::' || kit_code as physical_configuration,
  sum(quantity)::bigint as quantity
from commercial_outbound
group by configuration_id, servo_code, kit_code
order by quantity desc, physical_configuration;

-- Direct item outbound and kit use in internal assembly.
with dataset_batches as (
  select batch.id
  from public.movement_batches as batch
  where split_part(coalesce(batch.description, ''), '|', 1) =
    'NK_STATS_TEST_V1'
)
select
  item.code,
  item.item_type,
  sum(line.quantity)::bigint as quantity
from public.outbound_batch_lines as line
join dataset_batches as batch on batch.id = line.batch_id
join public.items as item on item.id = line.item_id
group by item.code, item.item_type
order by quantity desc, item.code;

with dataset_batches as (
  select batch.id
  from public.movement_batches as batch
  where split_part(coalesce(batch.description, ''), '|', 1) =
    'NK_STATS_TEST_V1'
)
select
  kit.code as kit_code,
  sum(operation.quantity)::bigint as quantity_used
from public.assembly_operations as operation
join dataset_batches as batch on batch.id = operation.batch_id
join public.commercial_configurations as configuration
  on configuration.id = operation.configuration_id
join public.items as kit on kit.id = configuration.installation_kit_id
where operation.operation_type = 'ASSEMBLY'
group by kit.code
order by quantity_used desc, kit.code;

-- Net balance effects attributable only to the dataset.
with dataset_batches as (
  select batch.id
  from public.movement_batches as batch
  where split_part(coalesce(batch.description, ''), '|', 1) =
    'NK_STATS_TEST_V1'
)
select
  item.code,
  sum(movement.quantity_change)::bigint as net_quantity_change
from public.stock_movements as movement
join dataset_batches as batch on batch.id = movement.batch_id
join public.items as item on item.id = movement.item_id
group by item.code
order by item.code;

with dataset_batches as (
  select batch.id
  from public.movement_batches as batch
  where split_part(coalesce(batch.description, ''), '|', 1) =
    'NK_STATS_TEST_V1'
)
select
  configuration.id as configuration_id,
  servo.code || '::' || kit.code as physical_configuration,
  sum(movement.quantity_change)::bigint as net_quantity_change
from public.configuration_stock_movements as movement
join dataset_batches as batch on batch.id = movement.batch_id
join public.commercial_configurations as configuration
  on configuration.id = movement.configuration_id
join public.items as servo on servo.id = configuration.servo_id
join public.items as kit on kit.id = configuration.installation_kit_id
group by configuration.id, servo.code, kit.code
order by physical_configuration;

-- Calendar groupings for future monthly and weekly statistics.
with dataset_batches as (
  select batch.*
  from public.movement_batches as batch
  where split_part(coalesce(batch.description, ''), '|', 1) =
    'NK_STATS_TEST_V1'
)
select
  date_trunc('month', occurred_at)::date as calendar_month,
  count(*) as batches
from dataset_batches
group by calendar_month
order by calendar_month;

with dataset_batches as (
  select batch.*
  from public.movement_batches as batch
  where split_part(coalesce(batch.description, ''), '|', 1) =
    'NK_STATS_TEST_V1'
)
select
  date_trunc('week', occurred_at)::date as calendar_week,
  count(*) as batches
from dataset_batches
group by calendar_week
order by calendar_week;

-- Structural checks against expected-statistics.json.
with dataset_batches as (
  select batch.*
  from public.movement_batches as batch
  where split_part(coalesce(batch.description, ''), '|', 1) =
    'NK_STATS_TEST_V1'
),
checks as (
  select
    'movement_batches = 30'::text as check_name,
    (select count(*) from dataset_batches) = 30 as passed

  union all

  select
    'reserved batch ids are exact',
    not exists (
      select 1
      from dataset_batches as batch
      where batch.id not in (
        select (
          '7a7a0000-0000-4000-8000-' ||
          lpad(sequence_number::text, 12, '0')
        )::uuid
        from generate_series(1, 30) as sequence_number
      )
    )
    and (select count(*) from dataset_batches) = 30

  union all

  select
    'inbound_batch_lines = 13',
    (
      select count(*)
      from public.inbound_batch_lines as line
      join dataset_batches as batch on batch.id = line.batch_id
    ) = 13

  union all

  select
    'outbound_batch_lines = 11',
    (
      select count(*)
      from public.outbound_batch_lines as line
      join dataset_batches as batch on batch.id = line.batch_id
    ) = 11

  union all

  select
    'stock_movements = 30',
    (
      select count(*)
      from public.stock_movements as movement
      join dataset_batches as batch on batch.id = movement.batch_id
    ) = 30

  union all

  select
    'configuration_stock_movements = 12',
    (
      select count(*)
      from public.configuration_stock_movements as movement
      join dataset_batches as batch on batch.id = movement.batch_id
    ) = 12

  union all

  select
    'assembly_operations = 6',
    (
      select count(*)
      from public.assembly_operations as operation
      join dataset_batches as batch on batch.id = operation.batch_id
    ) = 6

  union all

  select
    'no negative physical balances',
    not exists (
      select 1 from public.stock_balances where quantity < 0
    )
    and not exists (
      select 1
      from public.configuration_stock_balances
      where quantity < 0
    )

  union all

  select
    'aliases 1B and 1D share one physical configuration',
    (
      select count(distinct configuration_id)
      from public.commercial_configuration_codes
      where code in ('1B', '1D')
    ) = 1

  union all

  select
    'servo 3 intentionally has no dataset movement',
    not exists (
      select 1
      from public.stock_movements as movement
      join dataset_batches as batch on batch.id = movement.batch_id
      join public.items as item on item.id = movement.item_id
      where item.code = '3'
    )

  union all

  select
    'configuration 3A intentionally has no dataset movement',
    not exists (
      select 1
      from public.configuration_stock_movements as movement
      join dataset_batches as batch on batch.id = movement.batch_id
      join public.commercial_configuration_codes as code
        on code.configuration_id = movement.configuration_id
      where code.code = '3A'
    )

  union all

  select
    'at least three calendar months are represented',
    (
      select count(distinct date_trunc('month', occurred_at))
      from dataset_batches
    ) >= 3
)
select check_name, passed
from checks
order by check_name;

commit;
