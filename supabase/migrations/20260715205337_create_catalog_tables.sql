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

create function public.enforce_item_subtype_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actual_item_type text;
  expected_item_type text;
  subtype_table text;
begin
  if tg_table_name = 'items' then
    if exists (
      select 1 from public.servo_models where item_id = new.id
    ) then
      expected_item_type := 'SERVO';
      subtype_table := 'servo_models';
    elsif exists (
      select 1 from public.installation_kits where item_id = new.id
    ) then
      expected_item_type := 'INSTALLATION_KIT';
      subtype_table := 'installation_kits';
    elsif exists (
      select 1 from public.repair_kits where item_id = new.id
    ) then
      expected_item_type := 'REPAIR_KIT';
      subtype_table := 'repair_kits';
    elsif exists (
      select 1 from public.loose_parts where item_id = new.id
    ) then
      expected_item_type := 'LOOSE_PART';
      subtype_table := 'loose_parts';
    end if;

    if expected_item_type is not null
      and new.item_type <> expected_item_type then
      raise exception using
        errcode = '23514',
        message = format(
          'Item %s is registered in public.%I and must keep item_type %s; attempted %s.',
          new.id,
          subtype_table,
          expected_item_type,
          new.item_type
        );
    end if;

    return new;
  end if;

  expected_item_type := tg_argv[0];

  select item_type
  into actual_item_type
  from public.items
  where id = new.item_id
  for update;

  if not found then
    raise exception using
      errcode = '23503',
      message = format(
        'Item %s does not exist and cannot be associated with public.%I.',
        new.item_id,
        tg_table_name
      );
  end if;

  if actual_item_type <> expected_item_type then
    raise exception using
      errcode = '23514',
      message = format(
        'Item %s has item_type %s and cannot be associated with public.%I; expected %s.',
        new.item_id,
        actual_item_type,
        tg_table_name,
        expected_item_type
      );
  end if;

  return new;
end;
$$;

create trigger items_enforce_subtype_integrity
before update of item_type on public.items
for each row
when (old.item_type is distinct from new.item_type)
execute function public.enforce_item_subtype_integrity();

create trigger servo_models_enforce_item_type
before insert or update of item_id on public.servo_models
for each row
execute function public.enforce_item_subtype_integrity('SERVO');

create trigger installation_kits_enforce_item_type
before insert or update of item_id on public.installation_kits
for each row
execute function public.enforce_item_subtype_integrity('INSTALLATION_KIT');

create trigger repair_kits_enforce_item_type
before insert or update of item_id on public.repair_kits
for each row
execute function public.enforce_item_subtype_integrity('REPAIR_KIT');

create trigger loose_parts_enforce_item_type
before insert or update of item_id on public.loose_parts
for each row
execute function public.enforce_item_subtype_integrity('LOOSE_PART');

create index items_description_idx
  on public.items (description);

create index commercial_configurations_installation_kit_id_idx
  on public.commercial_configurations (installation_kit_id);

create index servo_repair_compatibility_repair_kit_id_idx
  on public.servo_repair_compatibility (repair_kit_id);
