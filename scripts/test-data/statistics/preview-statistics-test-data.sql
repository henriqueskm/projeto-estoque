\set ON_ERROR_STOP on

-- Read-only preview for NK_STATS_TEST_V1.
begin transaction read only;

select
  'operational_baseline' as section,
  (select count(*) from public.stock_balances where quantity <> 0)
    as nonzero_item_balances,
  (select count(*) from public.configuration_stock_balances where quantity <> 0)
    as nonzero_configuration_balances,
  (select count(*) from public.movement_batches) as movement_batches,
  (select count(*) from public.stock_movements) as stock_movements,
  (select count(*) from public.configuration_stock_movements)
    as configuration_stock_movements,
  (select count(*) from public.assembly_operations) as assembly_operations;

select
  'existing_dataset' as section,
  count(*) as batches
from public.movement_batches
where split_part(coalesce(description, ''), '|', 1) = 'NK_STATS_TEST_V1';

with dataset_batches as (
  select batch.*
  from public.movement_batches as batch
  where split_part(coalesce(batch.description, ''), '|', 1) =
    'NK_STATS_TEST_V1'
)
select
  'reset_record_preview' as section,
  (select count(*) from dataset_batches) as movement_batches,
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
    as assembly_operations;

with manifest as (
  select batch.inbound_request_payload -> 0 as value
  from public.movement_batches as batch
  where batch.id =
    '7a7a0000-0000-4000-8000-000000000001'::uuid
    and split_part(coalesce(batch.description, ''), '|', 1) =
      'NK_STATS_TEST_V1'
),
baseline as (
  select parsed.*
  from manifest
  cross join lateral jsonb_to_recordset(
    manifest.value -> 'item_balances'
  ) as parsed(
    item_id uuid,
    code text,
    row_existed boolean,
    quantity integer,
    updated_at timestamptz
  )
),
dataset_batches as (
  select batch.id
  from public.movement_batches as batch
  where split_part(coalesce(batch.description, ''), '|', 1) =
    'NK_STATS_TEST_V1'
),
net as (
  select
    movement.item_id,
    sum(movement.quantity_change)::integer as quantity_change
  from public.stock_movements as movement
  join dataset_batches as batch on batch.id = movement.batch_id
  group by movement.item_id
)
select
  'reset_item_balance_preview' as section,
  baseline.code,
  baseline.row_existed,
  balance.quantity as current_quantity,
  net.quantity_change as dataset_net_change,
  baseline.quantity as predicted_quantity_after_reset
from baseline
left join public.stock_balances as balance
  on balance.item_id = baseline.item_id
left join net on net.item_id = baseline.item_id
order by baseline.code;

with manifest as (
  select batch.inbound_request_payload -> 0 as value
  from public.movement_batches as batch
  where batch.id =
    '7a7a0000-0000-4000-8000-000000000001'::uuid
    and split_part(coalesce(batch.description, ''), '|', 1) =
      'NK_STATS_TEST_V1'
),
baseline as (
  select parsed.*
  from manifest
  cross join lateral jsonb_to_recordset(
    manifest.value -> 'configuration_balances'
  ) as parsed(
    configuration_id uuid,
    representative_code text,
    row_existed boolean,
    quantity integer,
    updated_at timestamptz
  )
),
dataset_batches as (
  select batch.id
  from public.movement_batches as batch
  where split_part(coalesce(batch.description, ''), '|', 1) =
    'NK_STATS_TEST_V1'
),
net as (
  select
    movement.configuration_id,
    sum(movement.quantity_change)::integer as quantity_change
  from public.configuration_stock_movements as movement
  join dataset_batches as batch on batch.id = movement.batch_id
  group by movement.configuration_id
)
select
  'reset_configuration_balance_preview' as section,
  baseline.representative_code,
  baseline.configuration_id,
  baseline.row_existed,
  balance.quantity as current_quantity,
  net.quantity_change as dataset_net_change,
  baseline.quantity as predicted_quantity_after_reset
from baseline
left join public.configuration_stock_balances as balance
  on balance.configuration_id = baseline.configuration_id
left join net on net.configuration_id = baseline.configuration_id
order by baseline.representative_code;

with required_items(code, expected_type, planned_net_change) as (
  values
    ('1', 'SERVO', 19),
    ('2', 'SERVO', 7),
    ('1INV', 'SERVO', 3),
    ('1DESL', 'SERVO', 3),
    ('6RB', 'SERVO', 2),
    ('KT-02', 'INSTALLATION_KIT', 13),
    ('KT-18', 'INSTALLATION_KIT', 5),
    ('KT-07', 'INSTALLATION_KIT', 3),
    ('KT-29', 'INSTALLATION_KIT', 3),
    ('KT-71', 'INSTALLATION_KIT', 2),
    ('R064', 'REPAIR_KIT', 7),
    ('110', 'LOOSE_PART', 6)
)
select
  required.code,
  required.expected_type,
  item.id is not null as found,
  item.is_active,
  balance.quantity as current_quantity,
  required.planned_net_change,
  coalesce(balance.quantity, 0) + required.planned_net_change
    as predicted_quantity
from required_items as required
left join public.items as item
  on item.code = required.code
 and item.item_type = required.expected_type
left join public.stock_balances as balance
  on balance.item_id = item.id
order by required.code;

with required_codes(code, planned_net_change, role) as (
  values
    ('1B', 2, 'moved'),
    ('1D', 0, 'alias_of_1B'),
    ('2A', 3, 'moved'),
    ('1F', 1, 'moved'),
    ('1H', 1, 'moved'),
    ('6P', 1, 'moved'),
    ('3A', 0, 'intentionally_unmoved')
)
select
  required.code,
  required.role,
  code.id is not null as found,
  code.is_active as code_is_active,
  configuration.id as configuration_id,
  configuration.is_active as configuration_is_active,
  servo.code as servo_code,
  installation_kit.code as kit_code,
  balance.quantity as current_quantity,
  required.planned_net_change,
  coalesce(balance.quantity, 0) + required.planned_net_change
    as predicted_quantity
from required_codes as required
left join public.commercial_configuration_codes as code
  on code.code = required.code
left join public.commercial_configurations as configuration
  on configuration.id = code.configuration_id
left join public.items as servo
  on servo.id = configuration.servo_id
left join public.items as installation_kit
  on installation_kit.id = configuration.installation_kit_id
left join public.configuration_stock_balances as balance
  on balance.configuration_id = configuration.id
order by required.code;

select *
from (
  values
    ('movement_batches', 30),
    ('inbound_batch_lines', 13),
    ('outbound_batch_lines', 11),
    ('stock_movements', 30),
    ('configuration_stock_movements', 12),
    ('assembly_operations', 6),
    ('inbound_units', 136),
    ('outbound_units', 35),
    ('assembled_units', 22),
    ('disassembled_units', 2),
    ('oldest_days_ago', 88),
    ('newest_days_ago', 1)
) as planned(metric, value);

rollback;
