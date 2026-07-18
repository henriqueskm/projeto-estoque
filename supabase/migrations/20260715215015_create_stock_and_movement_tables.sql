create table public.stock_balances (
  item_id uuid primary key references public.items (id) on delete restrict,
  quantity integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint stock_balances_quantity_check check (quantity >= 0)
);

create table public.configuration_stock_balances (
  configuration_id uuid primary key
    references public.commercial_configurations (id) on delete restrict,
  quantity integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint configuration_stock_balances_quantity_check check (quantity >= 0)
);

create table public.movement_batches (
  id uuid primary key default gen_random_uuid(),
  movement_type text not null,
  source text not null,
  user_id uuid,
  description text,
  reversed_batch_id uuid references public.movement_batches (id) on delete restrict,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint movement_batches_movement_type_check check (
    movement_type in (
      'INBOUND',
      'OUTBOUND',
      'ADJUSTMENT',
      'ASSEMBLY',
      'DISASSEMBLY',
      'REVERSAL'
    )
  ),
  constraint movement_batches_source_check check (
    source in (
      'MANUAL',
      'AI_CHAT',
      'ORDER_PHOTO'
    )
  ),
  constraint movement_batches_reversed_batch_not_self_check check (
    reversed_batch_id is null or reversed_batch_id <> id
  )
);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null
    references public.movement_batches (id) on delete restrict,
  item_id uuid not null references public.items (id) on delete restrict,
  quantity_change integer not null,
  quantity_before integer not null,
  quantity_after integer not null,
  created_at timestamptz not null default now(),
  constraint stock_movements_quantity_change_check check (quantity_change <> 0),
  constraint stock_movements_quantity_before_check check (quantity_before >= 0),
  constraint stock_movements_quantity_after_check check (quantity_after >= 0),
  constraint stock_movements_quantity_consistency_check check (
    quantity_after = quantity_before + quantity_change
  )
);

create table public.configuration_stock_movements (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null
    references public.movement_batches (id) on delete restrict,
  configuration_id uuid not null
    references public.commercial_configurations (id) on delete restrict,
  quantity_change integer not null,
  quantity_before integer not null,
  quantity_after integer not null,
  created_at timestamptz not null default now(),
  constraint configuration_stock_movements_quantity_change_check check (
    quantity_change <> 0
  ),
  constraint configuration_stock_movements_quantity_before_check check (
    quantity_before >= 0
  ),
  constraint configuration_stock_movements_quantity_after_check check (
    quantity_after >= 0
  ),
  constraint configuration_stock_movements_quantity_consistency_check check (
    quantity_after = quantity_before + quantity_change
  )
);

create table public.assembly_operations (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null
    references public.movement_batches (id) on delete restrict,
  configuration_id uuid not null
    references public.commercial_configurations (id) on delete restrict,
  operation_type text not null,
  quantity integer not null,
  created_at timestamptz not null default now(),
  constraint assembly_operations_operation_type_check check (
    operation_type in ('ASSEMBLY', 'DISASSEMBLY')
  ),
  constraint assembly_operations_quantity_check check (quantity > 0)
);

create index movement_batches_reversed_batch_id_idx
  on public.movement_batches (reversed_batch_id);

create index movement_batches_occurred_at_idx
  on public.movement_batches (occurred_at);

create index stock_movements_batch_id_idx
  on public.stock_movements (batch_id);

create index stock_movements_item_id_idx
  on public.stock_movements (item_id);

create index stock_movements_created_at_idx
  on public.stock_movements (created_at);

create index configuration_stock_movements_batch_id_idx
  on public.configuration_stock_movements (batch_id);

create index configuration_stock_movements_configuration_id_idx
  on public.configuration_stock_movements (configuration_id);

create index configuration_stock_movements_created_at_idx
  on public.configuration_stock_movements (created_at);

create index assembly_operations_batch_id_idx
  on public.assembly_operations (batch_id);

create index assembly_operations_configuration_id_idx
  on public.assembly_operations (configuration_id);
