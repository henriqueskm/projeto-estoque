\set ON_ERROR_STOP on

\if :{?confirm_reset}
\else
  \echo 'Refusing reset: pass --set=confirm_reset=NK_STATS_TEST_V1'
  \quit 3
\endif

begin;

select set_config(
  'nk_stats.confirm_reset',
  :'confirm_reset',
  true
);

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
  if current_setting('nk_stats.confirm_reset', true) <>
    'NK_STATS_TEST_V1' then
    raise exception using
      errcode = 'P0001',
      message =
        'Reset confirmation must equal NK_STATS_TEST_V1 exactly.';
  end if;
end;
$$;

create temporary table nk_stats_expected_batch_ids (
  batch_id uuid primary key
) on commit drop;

insert into nk_stats_expected_batch_ids (batch_id)
select (
  '7a7a0000-0000-4000-8000-' ||
  lpad(sequence_number::text, 12, '0')
)::uuid
from generate_series(1, 30) as sequence_number;

create temporary table nk_stats_dataset_batches on commit drop as
select batch.*
from public.movement_batches as batch
join nk_stats_expected_batch_ids as expected
  on expected.batch_id = batch.id
where split_part(coalesce(batch.description, ''), '|', 1) =
  'NK_STATS_TEST_V1';

do $$
begin
  if (select count(*) from pg_temp.nk_stats_dataset_batches) <> 30
    or exists (
      select 1
      from public.movement_batches as batch
      where split_part(coalesce(batch.description, ''), '|', 1) =
        'NK_STATS_TEST_V1'
        and not exists (
          select 1
          from pg_temp.nk_stats_expected_batch_ids as expected
          where expected.batch_id = batch.id
        )
    )
    or exists (
      select 1
      from pg_temp.nk_stats_expected_batch_ids as expected
      join public.movement_batches as batch on batch.id = expected.batch_id
      where split_part(coalesce(batch.description, ''), '|', 1) <>
        'NK_STATS_TEST_V1'
    ) then
    raise exception using
      errcode = 'P0001',
      message =
        'NK_STATS_TEST_V1 batch identity is incomplete or ambiguous. Reset aborted.';
  end if;
end;
$$;

create temporary table nk_stats_manifest on commit drop as
select batch.inbound_request_payload -> 0 as value
from nk_stats_dataset_batches as batch
where batch.id =
  '7a7a0000-0000-4000-8000-000000000001'::uuid;

do $$
begin
  if (select count(*) from pg_temp.nk_stats_manifest) <> 1
    or coalesce(
      (select value ->> 'kind' from pg_temp.nk_stats_manifest),
      ''
    ) <> 'NK_STATS_TEST_MANIFEST'
    or coalesce(
      (select value ->> 'dataset' from pg_temp.nk_stats_manifest),
      ''
    ) <> 'NK_STATS_TEST_V1' then
    raise exception using
      errcode = 'P0001',
      message =
        'NK_STATS_TEST_V1 baseline manifest is missing or invalid. Reset aborted.';
  end if;
end;
$$;

create temporary table nk_stats_item_baseline on commit drop as
select baseline.*
from nk_stats_manifest as manifest
cross join lateral jsonb_to_recordset(
  manifest.value -> 'item_balances'
) as baseline(
  item_id uuid,
  code text,
  row_existed boolean,
  quantity integer,
  updated_at timestamptz
);

alter table nk_stats_item_baseline
add primary key (item_id);

create temporary table nk_stats_configuration_baseline on commit drop as
select baseline.*
from nk_stats_manifest as manifest
cross join lateral jsonb_to_recordset(
  manifest.value -> 'configuration_balances'
) as baseline(
  configuration_id uuid,
  representative_code text,
  row_existed boolean,
  quantity integer,
  updated_at timestamptz
);

alter table nk_stats_configuration_baseline
add primary key (configuration_id);

create temporary table nk_stats_item_net on commit drop as
select
  movement.item_id,
  sum(movement.quantity_change)::integer as quantity_change
from public.stock_movements as movement
join nk_stats_dataset_batches as batch on batch.id = movement.batch_id
group by movement.item_id;

create temporary table nk_stats_configuration_net on commit drop as
select
  movement.configuration_id,
  sum(movement.quantity_change)::integer as quantity_change
from public.configuration_stock_movements as movement
join nk_stats_dataset_batches as batch on batch.id = movement.batch_id
group by movement.configuration_id;

do $$
declare
  v_seeded_at timestamptz;
begin
  select (value ->> 'seeded_at')::timestamptz
  into v_seeded_at
  from pg_temp.nk_stats_manifest;

  if v_seeded_at is null then
    raise exception using
      errcode = 'P0001',
      message = 'NK_STATS_TEST_V1 seeded_at is missing.';
  end if;

  if exists (
    select 1
    from public.movement_batches as batch
    where batch.created_at > v_seeded_at
      and split_part(coalesce(batch.description, ''), '|', 1) <>
        'NK_STATS_TEST_V1'
  ) then
    raise exception using
      errcode = 'P0001',
      message =
        'Non-dataset operations were created after NK_STATS_TEST_V1. Reset aborted to protect real history.';
  end if;

  if exists (
    select 1
    from public.movement_batches as batch
    where batch.reversed_batch_id in (
      select dataset.id from pg_temp.nk_stats_dataset_batches as dataset
    )
      and batch.id not in (
        select dataset.id from pg_temp.nk_stats_dataset_batches as dataset
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message =
        'A non-dataset reversal references NK_STATS_TEST_V1. Reset aborted.';
  end if;

  if (select count(*) from pg_temp.nk_stats_item_baseline) <> 12
    or (select count(*) from pg_temp.nk_stats_configuration_baseline) <> 5
    or (
      select count(*)
      from public.inbound_batch_lines as line
      join pg_temp.nk_stats_dataset_batches as batch
        on batch.id = line.batch_id
    ) <> 13
    or (
      select count(*)
      from public.outbound_batch_lines as line
      join pg_temp.nk_stats_dataset_batches as batch
        on batch.id = line.batch_id
    ) <> 11
    or (
      select count(*)
      from public.stock_movements as movement
      join pg_temp.nk_stats_dataset_batches as batch
        on batch.id = movement.batch_id
    ) <> 30
    or (
      select count(*)
      from public.configuration_stock_movements as movement
      join pg_temp.nk_stats_dataset_batches as batch
        on batch.id = movement.batch_id
    ) <> 12
    or (
      select count(*)
      from public.assembly_operations as operation
      join pg_temp.nk_stats_dataset_batches as batch
        on batch.id = operation.batch_id
    ) <> 6 then
    raise exception using
      errcode = 'P0001',
      message =
        'NK_STATS_TEST_V1 record counts differ from its approved manifest.';
  end if;

  if exists (
    select 1
    from pg_temp.nk_stats_item_baseline as baseline
    left join pg_temp.nk_stats_item_net as net
      on net.item_id = baseline.item_id
    left join public.stock_balances as balance
      on balance.item_id = baseline.item_id
    where net.item_id is null
       or balance.item_id is null
       or balance.quantity::bigint - net.quantity_change::bigint <>
          baseline.quantity::bigint
       or balance.quantity::bigint - net.quantity_change::bigint < 0
  ) or exists (
    select 1
    from pg_temp.nk_stats_configuration_baseline as baseline
    left join pg_temp.nk_stats_configuration_net as net
      on net.configuration_id = baseline.configuration_id
    left join public.configuration_stock_balances as balance
      on balance.configuration_id = baseline.configuration_id
    where net.configuration_id is null
       or balance.configuration_id is null
       or balance.quantity::bigint - net.quantity_change::bigint <>
          baseline.quantity::bigint
       or balance.quantity::bigint - net.quantity_change::bigint < 0
  ) then
    raise exception using
      errcode = 'P0001',
      message =
        'Current balances no longer match the NK_STATS_TEST_V1 manifest. Reset aborted.';
  end if;
end;
$$;

update public.stock_balances as balance
set
  quantity = baseline.quantity,
  updated_at = baseline.updated_at
from nk_stats_item_baseline as baseline
where balance.item_id = baseline.item_id
  and baseline.row_existed;

delete from public.stock_balances as balance
using nk_stats_item_baseline as baseline
where balance.item_id = baseline.item_id
  and not baseline.row_existed;

update public.configuration_stock_balances as balance
set
  quantity = baseline.quantity,
  updated_at = baseline.updated_at
from nk_stats_configuration_baseline as baseline
where balance.configuration_id = baseline.configuration_id
  and baseline.row_existed;

delete from public.configuration_stock_balances as balance
using nk_stats_configuration_baseline as baseline
where balance.configuration_id = baseline.configuration_id
  and not baseline.row_existed;

delete from private.stock_adjustment_requests as request
using nk_stats_dataset_batches as batch
where request.movement_batch_id = batch.id;

delete from private.configuration_operation_requests as request
using nk_stats_dataset_batches as batch
where request.movement_batch_id = batch.id;

delete from public.inbound_batch_lines as line
using nk_stats_dataset_batches as batch
where line.batch_id = batch.id;

delete from public.outbound_batch_lines as line
using nk_stats_dataset_batches as batch
where line.batch_id = batch.id;

delete from public.assembly_operations as operation
using nk_stats_dataset_batches as batch
where operation.batch_id = batch.id;

delete from public.configuration_stock_movements as movement
using nk_stats_dataset_batches as batch
where movement.batch_id = batch.id;

delete from public.stock_movements as movement
using nk_stats_dataset_batches as batch
where movement.batch_id = batch.id;

delete from public.movement_batches as movement_batch
using nk_stats_dataset_batches as dataset
where movement_batch.id = dataset.id;

do $$
begin
  if exists (
    select 1
    from public.movement_batches
    where split_part(coalesce(description, ''), '|', 1) =
      'NK_STATS_TEST_V1'
  )
  or exists (
    select 1
    from pg_temp.nk_stats_item_baseline as baseline
    left join public.stock_balances as balance
      on balance.item_id = baseline.item_id
    where (
      baseline.row_existed
      and (
        balance.item_id is null
        or balance.quantity is distinct from baseline.quantity
        or balance.updated_at is distinct from baseline.updated_at
      )
    ) or (
      not baseline.row_existed
      and balance.item_id is not null
    )
  )
  or exists (
    select 1
    from pg_temp.nk_stats_configuration_baseline as baseline
    left join public.configuration_stock_balances as balance
      on balance.configuration_id = baseline.configuration_id
    where (
      baseline.row_existed
      and (
        balance.configuration_id is null
        or balance.quantity is distinct from baseline.quantity
        or balance.updated_at is distinct from baseline.updated_at
      )
    ) or (
      not baseline.row_existed
      and balance.configuration_id is not null
    )
  ) then
    raise exception using
      errcode = 'P0001',
      message =
        'NK_STATS_TEST_V1 reset final validation failed. Transaction rolled back.';
  end if;
end;
$$;

commit;
