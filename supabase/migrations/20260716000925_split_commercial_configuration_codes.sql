create table public.commercial_configuration_codes (
  id uuid primary key default gen_random_uuid(),
  configuration_id uuid not null
    references public.commercial_configurations (id) on delete restrict,
  code text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.commercial_configuration_codes is
  'Commercial codes used to find a physical servo and installation kit configuration.';

insert into public.commercial_configuration_codes (
  configuration_id,
  code,
  is_active,
  created_at,
  updated_at
)
select
  id,
  code,
  is_active,
  created_at,
  updated_at
from public.commercial_configurations;

alter table public.commercial_configurations
drop column code;

comment on table public.commercial_configurations is
  'Physical servo and installation kit configurations. Commercial codes are stored separately.';

create index commercial_configuration_codes_configuration_id_idx
  on public.commercial_configuration_codes (configuration_id);

alter table public.commercial_configuration_codes enable row level security;

create policy commercial_configuration_codes_select_active_users
on public.commercial_configuration_codes
for select
to authenticated
using ((select private.is_active_profile()));

revoke all privileges on table public.commercial_configuration_codes
from anon, authenticated;

grant select on table public.commercial_configuration_codes
to authenticated;
