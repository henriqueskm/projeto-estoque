create table public.items (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  description text not null,
  item_type text not null,
  minimum_stock integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint items_item_type_check check (
    item_type in (
      'SERVO',
      'INSTALLATION_KIT',
      'REPAIR_KIT',
      'LOOSE_PART'
    )
  ),
  constraint items_minimum_stock_check check (minimum_stock >= 0)
);

create table public.servo_models (
  item_id uuid primary key references public.items (id) on delete cascade,
  model text,
  notes text,
  created_at timestamptz not null default now()
);

create table public.installation_kits (
  item_id uuid primary key references public.items (id) on delete cascade,
  name text,
  notes text,
  created_at timestamptz not null default now()
);

create table public.repair_kits (
  item_id uuid primary key references public.items (id) on delete cascade,
  name text,
  notes text,
  created_at timestamptz not null default now()
);

create table public.loose_parts (
  item_id uuid primary key references public.items (id) on delete cascade,
  notes text,
  created_at timestamptz not null default now()
);

create table public.commercial_configurations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  description text,
  servo_id uuid not null references public.servo_models (item_id),
  installation_kit_id uuid not null references public.installation_kits (item_id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commercial_configurations_servo_kit_key unique (
    servo_id,
    installation_kit_id
  )
);

comment on table public.commercial_configurations is
  'Commercial codes represent a servo and installation kit combination, not a physical inventory item.';

create table public.servo_repair_compatibility (
  servo_id uuid references public.servo_models (item_id) on delete cascade,
  repair_kit_id uuid references public.repair_kits (item_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (servo_id, repair_kit_id)
);

create index items_description_idx
  on public.items (description);

create index commercial_configurations_installation_kit_id_idx
  on public.commercial_configurations (installation_kit_id);
