-- Preview somente leitura do cenário NK_STATS_TEST_MINIMUMS_V1.
-- Este arquivo não altera mínimos, saldos, catálogo ou histórico.

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

with item_targets(code, expected_id, planned_minimum) as (
  values
    ('1', 'd9bfc725-87a3-4194-8f51-bdc49d95bd8c'::uuid, 1),
    ('2', '98d8747f-b6af-4b87-b5c4-57fc69d41256'::uuid, 10),
    ('3', '544f9dae-86a2-4c9c-b8e3-d0b41936c6fd'::uuid, 1),
    ('KT-18', '87c505a5-08b1-42c0-8dd9-6d38745a5990'::uuid, 8),
    ('R064', 'f805c45e-148e-4c1d-a5a9-05fdedddf30e'::uuid, 7),
    ('110', '4a6d41ee-752a-43fc-b52e-abccbd9cdf7d'::uuid, 7)
),
mounted_by_item as (
  select
    cc.servo_id as item_id,
    coalesce(sum(csb.quantity), 0)::bigint as quantity
  from public.commercial_configurations cc
  join public.configuration_stock_balances csb
    on csb.configuration_id = cc.id
  group by cc.servo_id

  union all

  select
    cc.installation_kit_id as item_id,
    coalesce(sum(csb.quantity), 0)::bigint as quantity
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
resolved as (
  select
    t.code,
    i.id,
    i.description,
    i.item_type,
    i.is_active,
    i.minimum_stock as current_minimum,
    i.updated_at as current_updated_at,
    t.planned_minimum,
    coalesce(sb.quantity, 0)::bigint as separate_quantity,
    coalesce(mt.quantity, 0)::bigint as mounted_quantity,
    case
      when i.item_type in ('SERVO', 'INSTALLATION_KIT')
        then coalesce(sb.quantity, 0)::bigint + coalesce(mt.quantity, 0)::bigint
      else coalesce(sb.quantity, 0)::bigint
    end as physical_quantity
  from item_targets t
  left join public.items i
    on i.code = t.code
   and i.id = t.expected_id
  left join public.stock_balances sb on sb.item_id = i.id
  left join mounted_totals mt on mt.item_id = i.id
)
select
  code,
  id,
  description,
  item_type,
  is_active,
  current_minimum,
  current_updated_at,
  planned_minimum,
  separate_quantity,
  mounted_quantity,
  physical_quantity,
  case
    when current_minimum = 0 then 'MINIMUM_ZERO'
    when physical_quantity = 0 then 'ZERO'
    when physical_quantity <= current_minimum then 'LOW'
    else 'HEALTHY'
  end as current_state,
  case
    when planned_minimum = 0 then 'MINIMUM_ZERO'
    when physical_quantity = 0 then 'ZERO'
    when physical_quantity <= planned_minimum then 'LOW'
    else 'HEALTHY'
  end as predicted_state
from resolved
order by code;

with configuration_targets(commercial_code, expected_id, planned_minimum) as (
  values
    ('1B', 'ffdbc822-37ab-4018-a476-b7e6e1f0e596'::uuid, 1),
    ('1F', '123d6873-cf58-4d08-be18-43cd89d08335'::uuid, 2),
    ('3A', '8adb70fd-60d2-4a9c-a2c5-7001c1685bf4'::uuid, 1)
)
select
  t.commercial_code,
  cc.id as configuration_id,
  array_agg(ccc.code order by ccc.code)
    filter (where ccc.is_active) as active_aliases,
  cc.is_active,
  cc.minimum_stock as current_minimum,
  cc.updated_at as current_updated_at,
  t.planned_minimum,
  coalesce(csb.quantity, 0)::bigint as mounted_quantity,
  case
    when cc.minimum_stock = 0 then 'MINIMUM_ZERO'
    when coalesce(csb.quantity, 0) = 0 then 'ZERO'
    when coalesce(csb.quantity, 0) <= cc.minimum_stock then 'LOW'
    else 'HEALTHY'
  end as current_state,
  case
    when t.planned_minimum = 0 then 'MINIMUM_ZERO'
    when coalesce(csb.quantity, 0) = 0 then 'ZERO'
    when coalesce(csb.quantity, 0) <= t.planned_minimum then 'LOW'
    else 'HEALTHY'
  end as predicted_state
from configuration_targets t
left join public.commercial_configurations cc
  on cc.id = t.expected_id
left join public.commercial_configuration_codes ccc
  on ccc.configuration_id = cc.id
left join public.configuration_stock_balances csb
  on csb.configuration_id = cc.id
group by
  t.commercial_code,
  cc.id,
  cc.is_active,
  cc.minimum_stock,
  cc.updated_at,
  t.planned_minimum,
  csb.quantity
order by t.commercial_code;

with item_controls as (
  select
    'item'::text as control_type,
    i.code,
    i.minimum_stock
  from public.items i
  where i.id = 'c893cffe-dd34-4fc4-997d-02d58682cc7f'::uuid
    and i.code = '1INV'
),
configuration_controls as (
  select
    'configuration'::text as control_type,
    string_agg(ccc.code, ', ' order by ccc.code) as code,
    cc.minimum_stock
  from public.commercial_configurations cc
  join public.commercial_configuration_codes ccc
    on ccc.configuration_id = cc.id
   and ccc.is_active
  where cc.id = '23e5f7c3-95a8-4f20-8bc9-778bb20f3135'::uuid
  group by cc.minimum_stock
)
select * from item_controls
union all
select * from configuration_controls
order by control_type;

with planned_item_minimums(id, minimum_stock) as (
  values
    ('d9bfc725-87a3-4194-8f51-bdc49d95bd8c'::uuid, 1),
    ('98d8747f-b6af-4b87-b5c4-57fc69d41256'::uuid, 10),
    ('544f9dae-86a2-4c9c-b8e3-d0b41936c6fd'::uuid, 1),
    ('87c505a5-08b1-42c0-8dd9-6d38745a5990'::uuid, 8),
    ('f805c45e-148e-4c1d-a5a9-05fdedddf30e'::uuid, 7),
    ('4a6d41ee-752a-43fc-b52e-abccbd9cdf7d'::uuid, 7)
),
planned_configuration_minimums(id, minimum_stock) as (
  values
    ('ffdbc822-37ab-4018-a476-b7e6e1f0e596'::uuid, 1),
    ('123d6873-cf58-4d08-be18-43cd89d08335'::uuid, 2),
    ('8adb70fd-60d2-4a9c-a2c5-7001c1685bf4'::uuid, 1)
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
    coalesce(p.minimum_stock, i.minimum_stock) as minimum_stock,
    case
      when i.item_type in ('SERVO', 'INSTALLATION_KIT')
        then coalesce(sb.quantity, 0)::bigint + coalesce(mt.quantity, 0)::bigint
      else coalesce(sb.quantity, 0)::bigint
    end as quantity
  from public.items i
  left join planned_item_minimums p on p.id = i.id
  left join public.stock_balances sb on sb.item_id = i.id
  left join mounted_totals mt on mt.item_id = i.id
  where i.is_active
),
configuration_states as (
  select
    coalesce(p.minimum_stock, cc.minimum_stock) as minimum_stock,
    coalesce(csb.quantity, 0)::bigint as quantity
  from public.commercial_configurations cc
  join public.items servo on servo.id = cc.servo_id and servo.is_active
  join public.items installation_kit
    on installation_kit.id = cc.installation_kit_id
   and installation_kit.is_active
  left join planned_configuration_minimums p on p.id = cc.id
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
)
select
  count(*) filter (
    where minimum_stock > 0 and quantity > 0 and quantity <= minimum_stock
  )::integer as predicted_low_count,
  count(*) filter (
    where minimum_stock > 0 and quantity = 0
  )::integer as predicted_zero_count,
  count(*) filter (
    where minimum_stock > 0 and quantity > minimum_stock
  )::integer as predicted_healthy_with_positive_minimum_count,
  count(*) filter (
    where minimum_stock = 0
  )::integer as predicted_minimum_zero_count
from states;

rollback;
