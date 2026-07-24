-- Reset protegido do cenário NK_STATS_TEST_MINIMUMS_V1.
-- Uso explícito:
--   psql ... --set=confirm_reset=NK_STATS_TEST_MINIMUMS_V1 \
--     --file=reset-statistics-test-minimums.sql
--
-- O reset aborta se algum alvo tiver sido alterado depois da aplicação.

\if :{?confirm_reset}
\else
  \echo 'Defina confirm_reset=NK_STATS_TEST_MINIMUMS_V1 para autorizar o reset.'
  \quit
\endif

\if :'confirm_reset' != 'NK_STATS_TEST_MINIMUMS_V1'
  \echo 'Confirmação inválida. Reset não executado.'
  \quit
\endif

begin;

lock table public.movement_batches in share mode nowait;
lock table public.items in share row exclusive mode nowait;
lock table public.commercial_configurations in share row exclusive mode nowait;

create temporary table nk_minimum_item_baseline (
  id uuid primary key,
  code text not null unique,
  original_minimum integer not null,
  original_updated_at timestamptz not null,
  applied_minimum integer not null
) on commit drop;

insert into nk_minimum_item_baseline values
  ('d9bfc725-87a3-4194-8f51-bdc49d95bd8c', '1', 0, '2026-07-16T04:11:03.765458Z', 1),
  ('98d8747f-b6af-4b87-b5c4-57fc69d41256', '2', 0, '2026-07-16T02:14:17.097403Z', 10),
  ('544f9dae-86a2-4c9c-b8e3-d0b41936c6fd', '3', 0, '2026-07-16T04:11:03.765458Z', 1),
  ('87c505a5-08b1-42c0-8dd9-6d38745a5990', 'KT-18', 0, '2026-07-16T04:11:03.765458Z', 8),
  ('f805c45e-148e-4c1d-a5a9-05fdedddf30e', 'R064', 0, '2026-07-16T04:11:03.765458Z', 7),
  ('4a6d41ee-752a-43fc-b52e-abccbd9cdf7d', '110', 0, '2026-07-20T05:10:34.909620Z', 7);

create temporary table nk_minimum_configuration_baseline (
  id uuid primary key,
  representative_code text not null unique,
  original_minimum integer not null,
  original_updated_at timestamptz not null,
  applied_minimum integer not null
) on commit drop;

insert into nk_minimum_configuration_baseline values
  ('ffdbc822-37ab-4018-a476-b7e6e1f0e596', '1B', 0, '2026-07-16T04:11:03.765458Z', 1),
  ('123d6873-cf58-4d08-be18-43cd89d08335', '1F', 0, '2026-07-16T04:11:03.765458Z', 2),
  ('8adb70fd-60d2-4a9c-a2c5-7001c1685bf4', '3A', 0, '2026-07-16T04:11:03.765458Z', 1);

do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.movement_batches
  where description like 'NK_STATS_TEST_V1%';

  if v_count <> 30 then
    raise exception
      'Reset NK_STATS_TEST_MINIMUMS_V1 abortado: dataset base ausente ou divergente';
  end if;

  select count(*) into v_count
  from public.items i
  join nk_minimum_item_baseline b on b.id = i.id
  where i.code = b.code
    and i.minimum_stock = b.applied_minimum
    and i.updated_at = '2026-07-24T01:26:00.000Z'::timestamptz;

  if v_count <> 6 then
    raise exception
      'Reset NK_STATS_TEST_MINIMUMS_V1 abortado: item alterado após a aplicação (% de 6 intactos)',
      v_count;
  end if;

  select count(*) into v_count
  from public.commercial_configurations cc
  join nk_minimum_configuration_baseline b on b.id = cc.id
  where cc.minimum_stock = b.applied_minimum
    and cc.updated_at = '2026-07-24T01:26:00.000Z'::timestamptz;

  if v_count <> 3 then
    raise exception
      'Reset NK_STATS_TEST_MINIMUMS_V1 abortado: configuração alterada após a aplicação (% de 3 intactas)',
      v_count;
  end if;
end
$$;

update public.items i
set
  minimum_stock = b.original_minimum,
  updated_at = b.original_updated_at
from nk_minimum_item_baseline b
where i.id = b.id;

update public.commercial_configurations cc
set
  minimum_stock = b.original_minimum,
  updated_at = b.original_updated_at
from nk_minimum_configuration_baseline b
where cc.id = b.id;

do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.items i
  join nk_minimum_item_baseline b on b.id = i.id
  where i.minimum_stock = b.original_minimum
    and i.updated_at = b.original_updated_at;

  if v_count <> 6 then
    raise exception 'Reset NK_STATS_TEST_MINIMUMS_V1 abortado: restauração incompleta dos itens';
  end if;

  select count(*) into v_count
  from public.commercial_configurations cc
  join nk_minimum_configuration_baseline b on b.id = cc.id
  where cc.minimum_stock = b.original_minimum
    and cc.updated_at = b.original_updated_at;

  if v_count <> 3 then
    raise exception 'Reset NK_STATS_TEST_MINIMUMS_V1 abortado: restauração incompleta das configurações';
  end if;
end
$$;

commit;
