-- Verificação somente leitura do cenário NK_STATS_TEST_MINIMUMS_V1.

begin transaction read only;

with expected_dataset as (
  select count(*)::integer as batch_count
  from public.movement_batches
  where description like 'NK_STATS_TEST_V1%'
)
select
  'dataset_installed' as check_name,
  batch_count = 30 as passed,
  batch_count::text as observed,
  '30' as expected
from expected_dataset;

with expected(id, code, minimum_stock) as (
  values
    ('d9bfc725-87a3-4194-8f51-bdc49d95bd8c'::uuid, '1', 1),
    ('98d8747f-b6af-4b87-b5c4-57fc69d41256'::uuid, '2', 10),
    ('544f9dae-86a2-4c9c-b8e3-d0b41936c6fd'::uuid, '3', 1),
    ('87c505a5-08b1-42c0-8dd9-6d38745a5990'::uuid, 'KT-18', 8),
    ('f805c45e-148e-4c1d-a5a9-05fdedddf30e'::uuid, 'R064', 7),
    ('4a6d41ee-752a-43fc-b52e-abccbd9cdf7d'::uuid, '110', 7)
),
actual as (
  select
    e.id,
    e.code,
    e.minimum_stock as expected_minimum,
    i.minimum_stock as actual_minimum,
    i.updated_at
  from expected e
  left join public.items i
    on i.id = e.id
   and i.code = e.code
)
select
  'item_' || code as check_name,
  actual_minimum = expected_minimum
    and updated_at = '2026-07-24T01:26:00.000Z'::timestamptz as passed,
  concat_ws(' / ', actual_minimum, updated_at) as observed,
  concat_ws(' / ', expected_minimum, '2026-07-24 01:26:00+00') as expected
from actual
order by code;

with expected(id, code, minimum_stock) as (
  values
    ('ffdbc822-37ab-4018-a476-b7e6e1f0e596'::uuid, '1B', 1),
    ('123d6873-cf58-4d08-be18-43cd89d08335'::uuid, '1F', 2),
    ('8adb70fd-60d2-4a9c-a2c5-7001c1685bf4'::uuid, '3A', 1)
),
actual as (
  select
    e.id,
    e.code,
    e.minimum_stock as expected_minimum,
    cc.minimum_stock as actual_minimum,
    cc.updated_at
  from expected e
  left join public.commercial_configurations cc on cc.id = e.id
  where exists (
    select 1
    from public.commercial_configuration_codes ccc
    where ccc.configuration_id = e.id
      and ccc.code = e.code
      and ccc.is_active
  )
)
select
  'configuration_' || code as check_name,
  actual_minimum = expected_minimum
    and updated_at = '2026-07-24T01:26:00.000Z'::timestamptz as passed,
  concat_ws(' / ', actual_minimum, updated_at) as observed,
  concat_ws(' / ', expected_minimum, '2026-07-24 01:26:00+00') as expected
from actual
order by code;

with expected_item_states(id, code, expected_quantity, expected_state) as (
  values
    ('d9bfc725-87a3-4194-8f51-bdc49d95bd8c'::uuid, '1', 22::bigint, 'HEALTHY'),
    ('98d8747f-b6af-4b87-b5c4-57fc69d41256'::uuid, '2', 10::bigint, 'LOW'),
    ('544f9dae-86a2-4c9c-b8e3-d0b41936c6fd'::uuid, '3', 0::bigint, 'ZERO'),
    ('87c505a5-08b1-42c0-8dd9-6d38745a5990'::uuid, 'KT-18', 8::bigint, 'LOW'),
    ('f805c45e-148e-4c1d-a5a9-05fdedddf30e'::uuid, 'R064', 7::bigint, 'LOW'),
    ('4a6d41ee-752a-43fc-b52e-abccbd9cdf7d'::uuid, '110', 7::bigint, 'LOW')
),
mounted_by_item as (
  select cc.servo_id as item_id, sum(csb.quantity)::bigint as quantity
  from public.commercial_configurations cc
  join public.configuration_stock_balances csb
    on csb.configuration_id = cc.id
  group by cc.servo_id

  union all

  select cc.installation_kit_id as item_id, sum(csb.quantity)::bigint as quantity
  from public.commercial_configurations cc
  join public.configuration_stock_balances csb
    on csb.configuration_id = cc.id
  group by cc.installation_kit_id
),
mounted_totals as (
  select item_id, sum(quantity)::bigint as quantity
  from mounted_by_item
  group by item_id
),
item_states as (
  select
    'item_' || e.code as check_name,
    e.expected_quantity,
    e.expected_state,
    case
      when i.item_type in ('SERVO', 'INSTALLATION_KIT')
        then coalesce(sb.quantity, 0)::bigint + coalesce(mt.quantity, 0)::bigint
      else coalesce(sb.quantity, 0)::bigint
    end as quantity,
    i.minimum_stock
  from expected_item_states e
  join public.items i on i.id = e.id and i.code = e.code
  left join public.stock_balances sb on sb.item_id = i.id
  left join mounted_totals mt on mt.item_id = i.id
),
expected_configuration_states(id, code, expected_quantity, expected_state) as (
  values
    ('ffdbc822-37ab-4018-a476-b7e6e1f0e596'::uuid, '1B/1D', 3::bigint, 'HEALTHY'),
    ('123d6873-cf58-4d08-be18-43cd89d08335'::uuid, '1F', 1::bigint, 'LOW'),
    ('8adb70fd-60d2-4a9c-a2c5-7001c1685bf4'::uuid, '3A', 0::bigint, 'ZERO')
),
configuration_states as (
  select
    'configuration_' || e.code as check_name,
    e.expected_quantity,
    e.expected_state,
    coalesce(csb.quantity, 0)::bigint as quantity,
    cc.minimum_stock
  from expected_configuration_states e
  join public.commercial_configurations cc on cc.id = e.id
  left join public.configuration_stock_balances csb
    on csb.configuration_id = cc.id
),
states as (
  select * from item_states
  union all
  select * from configuration_states
),
classified as (
  select
    *,
    case
      when minimum_stock = 0 then 'MINIMUM_ZERO'
      when quantity = 0 then 'ZERO'
      when quantity <= minimum_stock then 'LOW'
      else 'HEALTHY'
    end as state
  from states
)
select
  check_name,
  quantity = expected_quantity and state = expected_state as passed,
  concat_ws(' / ', quantity, state) as observed,
  concat_ws(' / ', expected_quantity, expected_state) as expected
from classified
order by check_name;

with mounted_by_item as (
  select cc.servo_id as item_id, sum(csb.quantity)::bigint as quantity
  from public.commercial_configurations cc
  join public.configuration_stock_balances csb
    on csb.configuration_id = cc.id
  group by cc.servo_id

  union all

  select cc.installation_kit_id as item_id, sum(csb.quantity)::bigint as quantity
  from public.commercial_configurations cc
  join public.configuration_stock_balances csb
    on csb.configuration_id = cc.id
  group by cc.installation_kit_id
),
mounted_totals as (
  select item_id, sum(quantity)::bigint as quantity
  from mounted_by_item
  group by item_id
),
item_states as (
  select
    i.id,
    i.minimum_stock,
    case
      when i.item_type in ('SERVO', 'INSTALLATION_KIT')
        then coalesce(sb.quantity, 0)::bigint + coalesce(mt.quantity, 0)::bigint
      else coalesce(sb.quantity, 0)::bigint
    end as quantity
  from public.items i
  left join public.stock_balances sb on sb.item_id = i.id
  left join mounted_totals mt on mt.item_id = i.id
  where i.is_active
),
configuration_states as (
  select
    cc.id,
    cc.minimum_stock,
    coalesce(csb.quantity, 0)::bigint as quantity
  from public.commercial_configurations cc
  join public.items servo on servo.id = cc.servo_id and servo.is_active
  join public.items installation_kit
    on installation_kit.id = cc.installation_kit_id
   and installation_kit.is_active
  left join public.configuration_stock_balances csb
    on csb.configuration_id = cc.id
  where cc.is_active
    and exists (
      select 1
      from public.commercial_configuration_codes ccc
      where ccc.configuration_id = cc.id
        and ccc.is_active
    )
),
states as (
  select minimum_stock, quantity from item_states
  union all
  select minimum_stock, quantity from configuration_states
),
summary as (
  select
    count(*) filter (
      where minimum_stock > 0 and quantity > 0 and quantity <= minimum_stock
    )::integer as low_count,
    count(*) filter (
      where minimum_stock > 0 and quantity = 0
    )::integer as zero_count,
    count(*) filter (
      where minimum_stock > 0 and quantity > minimum_stock
    )::integer as healthy_with_positive_minimum_count,
    count(*) filter (
      where minimum_stock = 0
    )::integer as minimum_zero_count
  from states
)
select
  'global_alert_summary' as check_name,
  (low_count, zero_count, healthy_with_positive_minimum_count, minimum_zero_count)
    = (5, 2, 2, 170) as passed,
  concat_ws(
    ' / ',
    low_count,
    zero_count,
    healthy_with_positive_minimum_count,
    minimum_zero_count
  ) as observed,
  '5 / 2 / 2 / 170' as expected
from summary;

select
  'control_item_1INV' as check_name,
  minimum_stock = 0 as passed,
  minimum_stock::text as observed,
  '0' as expected
from public.items
where id = 'c893cffe-dd34-4fc4-997d-02d58682cc7f'::uuid
  and code = '1INV'

union all

select
  'control_configuration_2A' as check_name,
  minimum_stock = 0 as passed,
  minimum_stock::text as observed,
  '0' as expected
from public.commercial_configurations
where id = '23e5f7c3-95a8-4f20-8bc9-778bb20f3135'::uuid;

rollback;
