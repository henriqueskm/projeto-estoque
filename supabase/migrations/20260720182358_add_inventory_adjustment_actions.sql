create table private.stock_adjustment_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  user_name_snapshot text,
  idempotency_key uuid not null,
  target_type text not null,
  item_id uuid references public.items (id) on delete restrict,
  configuration_id uuid
    references public.commercial_configurations (id) on delete restrict,
  counted_quantity integer not null,
  reason text not null,
  movement_batch_id uuid
    references public.movement_batches (id) on delete restrict,
  quantity_before integer,
  quantity_change integer,
  quantity_after integer,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint stock_adjustment_requests_target_type_check check (
    target_type in ('ITEM', 'CONFIGURATION')
  ),
  constraint stock_adjustment_requests_target_check check (
    (target_type = 'ITEM' and item_id is not null and configuration_id is null)
    or
    (target_type = 'CONFIGURATION' and item_id is null and configuration_id is not null)
  ),
  constraint stock_adjustment_requests_counted_quantity_check check (
    counted_quantity >= 0
  ),
  constraint stock_adjustment_requests_reason_check check (
    btrim(reason) <> '' and char_length(reason) <= 500
  ),
  constraint stock_adjustment_requests_completion_check check (
    (
      quantity_before is null
      and quantity_change is null
      and quantity_after is null
      and movement_batch_id is null
      and completed_at is null
    )
    or
    (
      quantity_before >= 0
      and quantity_change is not null
      and quantity_after >= 0
      and quantity_after = counted_quantity
      and quantity_after = quantity_before + quantity_change
      and completed_at is not null
      and (
        (quantity_change = 0 and movement_batch_id is null)
        or
        (quantity_change <> 0 and movement_batch_id is not null)
      )
    )
  )
);

comment on table private.stock_adjustment_requests is
  'Private idempotency records for physical inventory adjustments, including no-op requests that must not create empty movement batches.';

create unique index stock_adjustment_requests_user_key_uidx
  on private.stock_adjustment_requests (user_id, idempotency_key)
  where user_id is not null;

create unique index stock_adjustment_requests_movement_batch_uidx
  on private.stock_adjustment_requests (movement_batch_id)
  where movement_batch_id is not null;

revoke all privileges on table private.stock_adjustment_requests
from public, anon, authenticated;

create table public.minimum_stock_changes (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items (id) on delete restrict,
  previous_minimum_stock integer not null,
  new_minimum_stock integer not null,
  user_id uuid references public.profiles (id) on delete set null,
  user_name_snapshot text,
  created_at timestamptz not null default now(),
  constraint minimum_stock_changes_previous_value_check check (
    previous_minimum_stock >= 0
  ),
  constraint minimum_stock_changes_new_value_check check (
    new_minimum_stock >= 0
  ),
  constraint minimum_stock_changes_distinct_values_check check (
    previous_minimum_stock <> new_minimum_stock
  )
);

comment on table public.minimum_stock_changes is
  'Audit history for item minimum-stock settings. These changes are catalog configuration, not physical stock movements.';

create index minimum_stock_changes_item_id_idx
  on public.minimum_stock_changes (item_id);

create index minimum_stock_changes_user_id_idx
  on public.minimum_stock_changes (user_id);

create index minimum_stock_changes_created_at_idx
  on public.minimum_stock_changes (created_at);

alter table public.minimum_stock_changes enable row level security;

create policy minimum_stock_changes_select_active_users
on public.minimum_stock_changes
for select
to authenticated
using ((select private.is_active_profile()));

revoke all privileges on table public.minimum_stock_changes
from public, anon, authenticated;

grant select on table public.minimum_stock_changes
to authenticated;

create function private.adjust_inventory_stock(
  p_target_type text,
  p_target_id uuid,
  p_counted_quantity integer,
  p_reason text,
  p_idempotency_key uuid,
  p_user_id uuid,
  p_user_name text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request_id uuid;
  v_normalized_reason text;
  v_item_type text;
  v_quantity_before integer;
  v_quantity_change integer;
  v_batch_id uuid;
  v_existing_target_type text;
  v_existing_item_id uuid;
  v_existing_configuration_id uuid;
  v_existing_counted_quantity integer;
  v_existing_reason text;
  v_existing_batch_id uuid;
  v_existing_quantity_before integer;
  v_existing_quantity_change integer;
  v_existing_quantity_after integer;
  v_existing_completed_at timestamptz;
  v_other_batch_id uuid;
begin
  if p_user_id is null then
    raise exception using
      errcode = '22023',
      message = 'p_user_id is required for a stock adjustment.';
  end if;

  if p_target_type not in ('ITEM', 'CONFIGURATION') then
    raise exception using
      errcode = '22023',
      message = 'p_target_type must be ITEM or CONFIGURATION.';
  end if;

  if p_target_id is null then
    raise exception using
      errcode = '22023',
      message = 'p_target_id is required for a stock adjustment.';
  end if;

  if p_counted_quantity is null or p_counted_quantity < 0 then
    raise exception using
      errcode = '22023',
      message = 'p_counted_quantity must be a non-negative PostgreSQL integer.';
  end if;

  v_normalized_reason := btrim(p_reason);

  if v_normalized_reason is null
    or v_normalized_reason = ''
    or char_length(v_normalized_reason) > 500 then
    raise exception using
      errcode = '22023',
      message = 'p_reason must contain between 1 and 500 characters.';
  end if;

  if p_idempotency_key is null then
    raise exception using
      errcode = '22023',
      message = 'p_idempotency_key is required for a stock adjustment.';
  end if;

  insert into private.stock_adjustment_requests (
    user_id,
    user_name_snapshot,
    idempotency_key,
    target_type,
    item_id,
    configuration_id,
    counted_quantity,
    reason
  )
  values (
    p_user_id,
    p_user_name,
    p_idempotency_key,
    p_target_type,
    case when p_target_type = 'ITEM' then p_target_id end,
    case when p_target_type = 'CONFIGURATION' then p_target_id end,
    p_counted_quantity,
    v_normalized_reason
  )
  on conflict (user_id, idempotency_key)
    where user_id is not null
  do nothing
  returning id into v_request_id;

  if not found then
    select
      request.target_type,
      request.item_id,
      request.configuration_id,
      request.counted_quantity,
      request.reason,
      request.movement_batch_id,
      request.quantity_before,
      request.quantity_change,
      request.quantity_after,
      request.completed_at
    into
      v_existing_target_type,
      v_existing_item_id,
      v_existing_configuration_id,
      v_existing_counted_quantity,
      v_existing_reason,
      v_existing_batch_id,
      v_existing_quantity_before,
      v_existing_quantity_change,
      v_existing_quantity_after,
      v_existing_completed_at
    from private.stock_adjustment_requests as request
    where request.user_id = p_user_id
      and request.idempotency_key = p_idempotency_key
    for share;

    if not found or v_existing_completed_at is null then
      raise exception using
        errcode = '23505',
        message = 'The existing stock adjustment request could not be resolved.';
    end if;

    if v_existing_target_type is distinct from p_target_type
      or v_existing_item_id is distinct from (
        case when p_target_type = 'ITEM' then p_target_id end
      )
      or v_existing_configuration_id is distinct from (
        case when p_target_type = 'CONFIGURATION' then p_target_id end
      )
      or v_existing_counted_quantity is distinct from p_counted_quantity
      or v_existing_reason is distinct from v_normalized_reason then
      raise exception using
        errcode = '22023',
        message = 'p_idempotency_key has already been used with a different stock adjustment request.';
    end if;

    select batch.id
    into v_other_batch_id
    from public.movement_batches as batch
    where batch.user_id = p_user_id
      and batch.idempotency_key = p_idempotency_key;

    if found and v_other_batch_id is distinct from v_existing_batch_id then
      raise exception using
        errcode = '22023',
        message = 'p_idempotency_key has already been used by another stock operation.';
    end if;

    return jsonb_build_object(
      'movement_batch_id', v_existing_batch_id,
      'adjustment_applied', v_existing_quantity_change <> 0,
      'quantity_before', v_existing_quantity_before,
      'quantity_change', v_existing_quantity_change,
      'quantity_after', v_existing_quantity_after
    );
  end if;

  perform 1
  from public.movement_batches as batch
  where batch.user_id = p_user_id
    and batch.idempotency_key = p_idempotency_key
  for share;

  if found then
    raise exception using
      errcode = '22023',
      message = 'p_idempotency_key has already been used by another stock operation.';
  end if;

  if p_target_type = 'ITEM' then
    select item.item_type
    into v_item_type
    from public.items as item
    where item.id = p_target_id
    for share;

    if not found then
      raise exception using
        errcode = '22023',
        message = format('Item %s does not exist.', p_target_id);
    end if;

    if v_item_type not in (
      'SERVO',
      'INSTALLATION_KIT',
      'REPAIR_KIT',
      'LOOSE_PART'
    ) then
      raise exception using
        errcode = '22023',
        message = format(
          'Item %s has unsupported item_type %s.',
          p_target_id,
          v_item_type
        );
    end if;

    insert into public.stock_balances (item_id, quantity)
    values (p_target_id, 0)
    on conflict (item_id) do nothing;

    select balance.quantity
    into v_quantity_before
    from public.stock_balances as balance
    where balance.item_id = p_target_id
    for update;
  else
    perform 1
    from public.commercial_configurations as configuration
    where configuration.id = p_target_id
    for share;

    if not found then
      raise exception using
        errcode = '22023',
        message = format(
          'Commercial configuration %s does not exist.',
          p_target_id
        );
    end if;

    insert into public.configuration_stock_balances (
      configuration_id,
      quantity
    )
    values (p_target_id, 0)
    on conflict (configuration_id) do nothing;

    select balance.quantity
    into v_quantity_before
    from public.configuration_stock_balances as balance
    where balance.configuration_id = p_target_id
    for update;
  end if;

  if v_quantity_before is null then
    raise exception using
      errcode = '23514',
      message = 'The stock balance could not be locked for adjustment.';
  end if;

  v_quantity_change := p_counted_quantity - v_quantity_before;

  if v_quantity_change = 0 then
    update private.stock_adjustment_requests
    set quantity_before = v_quantity_before,
        quantity_change = 0,
        quantity_after = p_counted_quantity,
        completed_at = now()
    where id = v_request_id;

    return jsonb_build_object(
      'movement_batch_id', null,
      'adjustment_applied', false,
      'quantity_before', v_quantity_before,
      'quantity_change', 0,
      'quantity_after', p_counted_quantity
    );
  end if;

  begin
    insert into public.movement_batches (
      movement_type,
      source,
      user_id,
      user_name_snapshot,
      description,
      idempotency_key
    )
    values (
      'ADJUSTMENT',
      'MANUAL',
      p_user_id,
      p_user_name,
      v_normalized_reason,
      p_idempotency_key
    )
    returning id into v_batch_id;
  exception
    when unique_violation then
      raise exception using
        errcode = '22023',
        message = 'p_idempotency_key has already been used by another stock operation.';
  end;

  if p_target_type = 'ITEM' then
    update public.stock_balances
    set quantity = p_counted_quantity,
        updated_at = now()
    where item_id = p_target_id;

    insert into public.stock_movements (
      batch_id,
      item_id,
      quantity_change,
      quantity_before,
      quantity_after
    )
    values (
      v_batch_id,
      p_target_id,
      v_quantity_change,
      v_quantity_before,
      p_counted_quantity
    );
  else
    update public.configuration_stock_balances
    set quantity = p_counted_quantity,
        updated_at = now()
    where configuration_id = p_target_id;

    insert into public.configuration_stock_movements (
      batch_id,
      configuration_id,
      quantity_change,
      quantity_before,
      quantity_after
    )
    values (
      v_batch_id,
      p_target_id,
      v_quantity_change,
      v_quantity_before,
      p_counted_quantity
    );
  end if;

  update private.stock_adjustment_requests
  set movement_batch_id = v_batch_id,
      quantity_before = v_quantity_before,
      quantity_change = v_quantity_change,
      quantity_after = p_counted_quantity,
      completed_at = now()
  where id = v_request_id;

  return jsonb_build_object(
    'movement_batch_id', v_batch_id,
    'adjustment_applied', true,
    'quantity_before', v_quantity_before,
    'quantity_change', v_quantity_change,
    'quantity_after', p_counted_quantity
  );
end;
$$;

revoke all on function private.adjust_inventory_stock(
  text,
  uuid,
  integer,
  text,
  uuid,
  uuid,
  text
) from public, anon, authenticated;

create function public.adjust_item_stock(
  p_item_id uuid,
  p_counted_quantity integer,
  p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_user_name text;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception using
      errcode = '28000',
      message = 'An authenticated user is required.';
  end if;

  select profile.name
  into v_user_name
  from public.profiles as profile
  where profile.id = v_user_id
    and profile.is_active
  for share;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'The authenticated user does not have an active profile.';
  end if;

  return private.adjust_inventory_stock(
    'ITEM',
    p_item_id,
    p_counted_quantity,
    p_reason,
    p_idempotency_key,
    v_user_id,
    v_user_name
  );
end;
$$;

revoke all on function public.adjust_item_stock(uuid, integer, text, uuid)
from public, anon, authenticated;

grant execute on function public.adjust_item_stock(uuid, integer, text, uuid)
to authenticated;

create function public.adjust_configuration_stock(
  p_configuration_id uuid,
  p_counted_quantity integer,
  p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_user_name text;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception using
      errcode = '28000',
      message = 'An authenticated user is required.';
  end if;

  select profile.name
  into v_user_name
  from public.profiles as profile
  where profile.id = v_user_id
    and profile.is_active
  for share;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'The authenticated user does not have an active profile.';
  end if;

  return private.adjust_inventory_stock(
    'CONFIGURATION',
    p_configuration_id,
    p_counted_quantity,
    p_reason,
    p_idempotency_key,
    v_user_id,
    v_user_name
  );
end;
$$;

revoke all on function public.adjust_configuration_stock(
  uuid,
  integer,
  text,
  uuid
) from public, anon, authenticated;

grant execute on function public.adjust_configuration_stock(
  uuid,
  integer,
  text,
  uuid
) to authenticated;

create function private.set_item_minimum_stock(
  p_item_id uuid,
  p_minimum_stock integer,
  p_user_id uuid,
  p_user_name text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item_type text;
  v_previous_minimum_stock integer;
  v_change_id uuid;
begin
  if p_user_id is null then
    raise exception using
      errcode = '22023',
      message = 'p_user_id is required to change minimum stock.';
  end if;

  if p_minimum_stock is null or p_minimum_stock < 0 then
    raise exception using
      errcode = '22023',
      message = 'p_minimum_stock must be a non-negative PostgreSQL integer.';
  end if;

  select item.item_type, item.minimum_stock
  into v_item_type, v_previous_minimum_stock
  from public.items as item
  where item.id = p_item_id
  for update;

  if not found then
    raise exception using
      errcode = '22023',
      message = format('Item %s does not exist.', p_item_id);
  end if;

  if v_item_type not in (
    'SERVO',
    'INSTALLATION_KIT',
    'REPAIR_KIT',
    'LOOSE_PART'
  ) then
    raise exception using
      errcode = '22023',
      message = format(
        'Item %s has unsupported item_type %s.',
        p_item_id,
        v_item_type
      );
  end if;

  if v_previous_minimum_stock = p_minimum_stock then
    return jsonb_build_object(
      'change_applied', false,
      'change_id', null,
      'previous_minimum_stock', v_previous_minimum_stock,
      'new_minimum_stock', p_minimum_stock
    );
  end if;

  update public.items
  set minimum_stock = p_minimum_stock,
      updated_at = now()
  where id = p_item_id;

  insert into public.minimum_stock_changes (
    item_id,
    previous_minimum_stock,
    new_minimum_stock,
    user_id,
    user_name_snapshot
  )
  values (
    p_item_id,
    v_previous_minimum_stock,
    p_minimum_stock,
    p_user_id,
    p_user_name
  )
  returning id into v_change_id;

  return jsonb_build_object(
    'change_applied', true,
    'change_id', v_change_id,
    'previous_minimum_stock', v_previous_minimum_stock,
    'new_minimum_stock', p_minimum_stock
  );
end;
$$;

revoke all on function private.set_item_minimum_stock(
  uuid,
  integer,
  uuid,
  text
) from public, anon, authenticated;

create function public.set_item_minimum_stock(
  p_item_id uuid,
  p_minimum_stock integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_user_name text;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception using
      errcode = '28000',
      message = 'An authenticated user is required.';
  end if;

  select profile.name
  into v_user_name
  from public.profiles as profile
  where profile.id = v_user_id
    and profile.is_active
  for share;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'The authenticated user does not have an active profile.';
  end if;

  return private.set_item_minimum_stock(
    p_item_id,
    p_minimum_stock,
    v_user_id,
    v_user_name
  );
end;
$$;

revoke all on function public.set_item_minimum_stock(uuid, integer)
from public, anon, authenticated;

grant execute on function public.set_item_minimum_stock(uuid, integer)
to authenticated;
