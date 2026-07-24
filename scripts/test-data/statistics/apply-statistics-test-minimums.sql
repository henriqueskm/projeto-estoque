-- Aplica o cenário controlado NK_STATS_TEST_MINIMUMS_V1.
-- Altera somente minimum_stock e updated_at dos alvos explicitamente listados.

begin;

lock table public.movement_batches in share mode nowait;
lock table public.stock_balances in share row exclusive mode nowait;
lock table public.configuration_stock_balances in share row exclusive mode nowait;
lock table public.items in share row exclusive mode nowait;
lock table public.commercial_configurations in share row exclusive mode nowait;

create temporary table nk_minimum_item_targets (
  id uuid primary key,
  code text not null unique,
  original_minimum integer not null,
  original_updated_at timestamptz not null,
  planned_minimum integer not null,
  expected_physical_quantity bigint not null
) on commit drop;

insert into nk_minimum_item_targets values
  ('d9bfc725-87a3-4194-8f51-bdc49d95bd8c', '1', 0, '2026-07-16T04:11:03.765458Z', 1, 22),
  ('98d8747f-b6af-4b87-b5c4-57fc69d41256', '2', 0, '2026-07-16T02:14:17.097403Z', 10, 10),
  ('544f9dae-86a2-4c9c-b8e3-d0b41936c6fd', '3', 0, '2026-07-16T04:11:03.765458Z', 1, 0),
  ('87c505a5-08b1-42c0-8dd9-6d38745a5990', 'KT-18', 0, '2026-07-16T04:11:03.765458Z', 8, 8),
  ('f805c45e-148e-4c1d-a5a9-05fdedddf30e', 'R064', 0, '2026-07-16T04:11:03.765458Z', 7, 7),
  ('4a6d41ee-752a-43fc-b52e-abccbd9cdf7d', '110', 0, '2026-07-20T05:10:34.909620Z', 7, 7);

create temporary table nk_minimum_configuration_targets (
  id uuid primary key,
  representative_code text not null unique,
  original_minimum integer not null,
  original_updated_at timestamptz not null,
  planned_minimum integer not null,
  expected_mounted_quantity bigint not null
) on commit drop;

insert into nk_minimum_configuration_targets values
  ('ffdbc822-37ab-4018-a476-b7e6e1f0e596', '1B', 0, '2026-07-16T04:11:03.765458Z', 1, 3),
  ('123d6873-cf58-4d08-be18-43cd89d08335', '1F', 0, '2026-07-16T04:11:03.765458Z', 2, 1),
  ('8adb70fd-60d2-4a9c-a2c5-7001c1685bf4', '3A', 0, '2026-07-16T04:11:03.765458Z', 1, 0);

do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from (
    select i.id
    from public.items i
    join nk_minimum_item_targets t on t.id = i.id
    where i.minimum_stock = t.planned_minimum
      and i.updated_at = '2026-07-24T01:26:00.000Z'::timestamptz

    union all

    select cc.id
    from public.commercial_configurations cc
    join nk_minimum_configuration_targets t on t.id = cc.id
    where cc.minimum_stock = t.planned_minimum
      and cc.updated_at = '2026-07-24T01:26:00.000Z'::timestamptz
  ) applied_targets;

  if v_count = 9 then
    raise exception
      'NK_STATS_TEST_MINIMUMS_V1 já está aplicado; nenhuma alteração foi feita';
  end if;

  select count(*) into v_count
  from public.movement_batches
  where description like 'NK_STATS_TEST_V1%';

  if v_count <> 30 then
    raise exception
      'NK_STATS_TEST_MINIMUMS_V1 abortado: esperado dataset com 30 batches, encontrado %',
      v_count;
  end if;

  select count(*) into v_count
  from public.items i
  join nk_minimum_item_targets t on t.id = i.id
  where i.code = t.code
    and i.is_active
    and i.minimum_stock = t.original_minimum
    and i.updated_at = t.original_updated_at;

  if v_count <> 6 then
    raise exception
      'NK_STATS_TEST_MINIMUMS_V1 abortado: baseline dos itens divergiu (% de 6 válidos)',
      v_count;
  end if;

  select count(*) into v_count
  from public.commercial_configurations cc
  join nk_minimum_configuration_targets t on t.id = cc.id
  where cc.is_active
    and cc.minimum_stock = t.original_minimum
    and cc.updated_at = t.original_updated_at
    and exists (
      select 1
      from public.commercial_configuration_codes ccc
      where ccc.configuration_id = cc.id
        and ccc.code = t.representative_code
        and ccc.is_active
    );

  if v_count <> 3 then
    raise exception
      'NK_STATS_TEST_MINIMUMS_V1 abortado: baseline das configurações divergiu (% de 3 válidas)',
      v_count;
  end if;

  if (
    select minimum_stock
    from public.items
    where id = 'c893cffe-dd34-4fc4-997d-02d58682cc7f'::uuid
      and code = '1INV'
  ) is distinct from 0 then
    raise exception
      'NK_STATS_TEST_MINIMUMS_V1 abortado: controle 1INV não está com mínimo zero';
  end if;

  if (
    select minimum_stock
    from public.commercial_configurations
    where id = '23e5f7c3-95a8-4f20-8bc9-778bb20f3135'::uuid
  ) is distinct from 0 then
    raise exception
      'NK_STATS_TEST_MINIMUMS_V1 abortado: controle 2A não está com mínimo zero';
  end if;
end
$$;

do $$
declare
  v_count integer;
begin
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
  actual as (
    select
      i.id,
      case
        when i.item_type in ('SERVO', 'INSTALLATION_KIT')
          then coalesce(sb.quantity, 0)::bigint + coalesce(mt.quantity, 0)::bigint
        else coalesce(sb.quantity, 0)::bigint
      end as physical_quantity
    from public.items i
    join nk_minimum_item_targets t on t.id = i.id
    left join public.stock_balances sb on sb.item_id = i.id
    left join mounted_totals mt on mt.item_id = i.id
  )
  select count(*) into v_count
  from actual a
  join nk_minimum_item_targets t on t.id = a.id
  where a.physical_quantity = t.expected_physical_quantity;

  if v_count <> 6 then
    raise exception
      'NK_STATS_TEST_MINIMUMS_V1 abortado: saldos físicos divergiram (% de 6 válidos)',
      v_count;
  end if;

  select count(*) into v_count
  from nk_minimum_configuration_targets t
  left join public.configuration_stock_balances csb
    on csb.configuration_id = t.id
  where coalesce(csb.quantity, 0)::bigint = t.expected_mounted_quantity;

  if v_count <> 3 then
    raise exception
      'NK_STATS_TEST_MINIMUMS_V1 abortado: saldos montados divergiram (% de 3 válidos)',
      v_count;
  end if;
end
$$;

update public.items i
set
  minimum_stock = t.planned_minimum,
  updated_at = '2026-07-24T01:26:00.000Z'::timestamptz
from nk_minimum_item_targets t
where i.id = t.id;

update public.commercial_configurations cc
set
  minimum_stock = t.planned_minimum,
  updated_at = '2026-07-24T01:26:00.000Z'::timestamptz
from nk_minimum_configuration_targets t
where cc.id = t.id;

do $$
declare
  v_count integer;
  v_low integer;
  v_zero integer;
  v_healthy integer;
  v_minimum_zero integer;
begin
  select count(*) into v_count
  from public.items i
  join nk_minimum_item_targets t on t.id = i.id
  where i.minimum_stock = t.planned_minimum
    and i.updated_at = '2026-07-24T01:26:00.000Z'::timestamptz;

  if v_count <> 6 then
    raise exception
      'NK_STATS_TEST_MINIMUMS_V1 abortado: atualização incompleta dos itens';
  end if;

  select count(*) into v_count
  from public.commercial_configurations cc
  join nk_minimum_configuration_targets t on t.id = cc.id
  where cc.minimum_stock = t.planned_minimum
    and cc.updated_at = '2026-07-24T01:26:00.000Z'::timestamptz;

  if v_count <> 3 then
    raise exception
      'NK_STATS_TEST_MINIMUMS_V1 abortado: atualização incompleta das configurações';
  end if;

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
  )
  select
    count(*) filter (
      where minimum_stock > 0 and quantity > 0 and quantity <= minimum_stock
    )::integer,
    count(*) filter (
      where minimum_stock > 0 and quantity = 0
    )::integer,
    count(*) filter (
      where minimum_stock > 0 and quantity > minimum_stock
    )::integer,
    count(*) filter (
      where minimum_stock = 0
    )::integer
  into v_low, v_zero, v_healthy, v_minimum_zero
  from states;

  if (v_low, v_zero, v_healthy, v_minimum_zero) <> (5, 2, 2, 170) then
    raise exception
      'NK_STATS_TEST_MINIMUMS_V1 abortado: classificação divergente (%/%/%/%)',
      v_low,
      v_zero,
      v_healthy,
      v_minimum_zero;
  end if;
end
$$;

commit;
