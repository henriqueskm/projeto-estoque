begin;

create function private.stock_adjustment_checked_existing_result(
  p_target_type text,
  p_target_id uuid,
  p_counted_quantity integer,
  p_reason text,
  p_idempotency_key uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request private.stock_adjustment_requests%rowtype;
  v_other_batch_id uuid;
begin
  select request.*
  into v_request
  from private.stock_adjustment_requests as request
  where request.user_id = p_user_id
    and request.idempotency_key = p_idempotency_key
  for share;

  if not found then
    return null;
  end if;

  if v_request.completed_at is null then
    raise exception using
      errcode = '23505',
      message = 'The existing stock adjustment request could not be resolved.';
  end if;

  if v_request.target_type is distinct from p_target_type
    or v_request.item_id is distinct from (
      case when p_target_type = 'ITEM' then p_target_id end
    )
    or v_request.configuration_id is distinct from (
      case when p_target_type = 'CONFIGURATION' then p_target_id end
    )
    or v_request.counted_quantity is distinct from p_counted_quantity
    or v_request.reason is distinct from p_reason then
    raise exception using
      errcode = '22023',
      message = 'p_idempotency_key has already been used with a different stock adjustment request.';
  end if;

  select batch.id
  into v_other_batch_id
  from public.movement_batches as batch
  where batch.user_id = p_user_id
    and batch.idempotency_key = p_idempotency_key;

  if found and v_other_batch_id is distinct from v_request.movement_batch_id then
    raise exception using
      errcode = '22023',
      message = 'p_idempotency_key has already been used by another stock operation.';
  end if;

  return jsonb_build_object(
    'movement_batch_id', v_request.movement_batch_id,
    'adjustment_applied', v_request.quantity_change <> 0,
    'quantity_before', v_request.quantity_before,
    'quantity_change', v_request.quantity_change,
    'quantity_after', v_request.quantity_after
  );
end;
$$;

create function private.adjust_inventory_stock_checked(
  p_target_type text,
  p_target_id uuid,
  p_counted_quantity integer,
  p_expected_quantity integer,
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
  v_normalized_reason text;
  v_item_type text;
  v_current_quantity integer;
  v_existing_result jsonb;
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

  if p_expected_quantity is null or p_expected_quantity < 0 then
    raise exception using
      errcode = '22023',
      message = 'p_expected_quantity must be a non-negative PostgreSQL integer.';
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

  -- A completed logical attempt wins over the now-old displayed balance.
  v_existing_result := private.stock_adjustment_checked_existing_result(
    p_target_type,
    p_target_id,
    p_counted_quantity,
    v_normalized_reason,
    p_idempotency_key,
    p_user_id
  );

  if v_existing_result is not null then
    return v_existing_result;
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
    into v_current_quantity
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
    into v_current_quantity
    from public.configuration_stock_balances as balance
    where balance.configuration_id = p_target_id
    for update;
  end if;

  if v_current_quantity is null then
    raise exception using
      errcode = '23514',
      message = 'The stock balance could not be locked for adjustment.';
  end if;

  -- A concurrent identical key can complete while this call waits for the
  -- balance lock. Resolve that replay before comparing the stale preview.
  v_existing_result := private.stock_adjustment_checked_existing_result(
    p_target_type,
    p_target_id,
    p_counted_quantity,
    v_normalized_reason,
    p_idempotency_key,
    p_user_id
  );

  if v_existing_result is not null then
    return v_existing_result;
  end if;

  if v_current_quantity is distinct from p_expected_quantity then
    raise exception using
      errcode = '40001',
      message = 'stock_adjustment_quantity_conflict';
  end if;

  return private.adjust_inventory_stock(
    p_target_type,
    p_target_id,
    p_counted_quantity,
    v_normalized_reason,
    p_idempotency_key,
    p_user_id,
    p_user_name
  );
end;
$$;

create function public.adjust_item_stock_checked(
  p_item_id uuid,
  p_counted_quantity integer,
  p_expected_quantity integer,
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

  return private.adjust_inventory_stock_checked(
    'ITEM',
    p_item_id,
    p_counted_quantity,
    p_expected_quantity,
    p_reason,
    p_idempotency_key,
    v_user_id,
    v_user_name
  );
end;
$$;

create function public.adjust_configuration_stock_checked(
  p_configuration_id uuid,
  p_counted_quantity integer,
  p_expected_quantity integer,
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

  return private.adjust_inventory_stock_checked(
    'CONFIGURATION',
    p_configuration_id,
    p_counted_quantity,
    p_expected_quantity,
    p_reason,
    p_idempotency_key,
    v_user_id,
    v_user_name
  );
end;
$$;

revoke all on function private.stock_adjustment_checked_existing_result(
  text,
  uuid,
  integer,
  text,
  uuid,
  uuid
) from public, anon, authenticated, service_role;

revoke all on function private.adjust_inventory_stock_checked(
  text,
  uuid,
  integer,
  integer,
  text,
  uuid,
  uuid,
  text
) from public, anon, authenticated, service_role;

revoke all on function public.adjust_item_stock_checked(
  uuid,
  integer,
  integer,
  text,
  uuid
) from public, anon, authenticated, service_role;

revoke all on function public.adjust_configuration_stock_checked(
  uuid,
  integer,
  integer,
  text,
  uuid
) from public, anon, authenticated, service_role;

grant execute on function public.adjust_item_stock_checked(
  uuid,
  integer,
  integer,
  text,
  uuid
) to authenticated, service_role;

grant execute on function public.adjust_configuration_stock_checked(
  uuid,
  integer,
  integer,
  text,
  uuid
) to authenticated, service_role;

revoke execute on function public.adjust_item_stock(
  uuid,
  integer,
  text,
  uuid
) from public, anon, authenticated;

revoke execute on function public.adjust_configuration_stock(
  uuid,
  integer,
  text,
  uuid
) from public, anon, authenticated;

grant execute on function public.adjust_item_stock(
  uuid,
  integer,
  text,
  uuid
) to service_role;

grant execute on function public.adjust_configuration_stock(
  uuid,
  integer,
  text,
  uuid
) to service_role;

comment on function private.stock_adjustment_checked_existing_result(
  text,
  uuid,
  integer,
  text,
  uuid,
  uuid
) is
  'Returns a completed absolute-adjustment replay after validating its canonical target, quantity, and reason.';

comment on function private.adjust_inventory_stock_checked(
  text,
  uuid,
  integer,
  integer,
  text,
  uuid,
  uuid,
  text
) is
  'Protects absolute inventory adjustments with a locked expected-quantity comparison before delegating to the canonical writer.';

comment on function public.adjust_item_stock_checked(
  uuid,
  integer,
  integer,
  text,
  uuid
) is
  'Adjusts an item only when its locked quantity matches the displayed expected quantity.';

comment on function public.adjust_configuration_stock_checked(
  uuid,
  integer,
  integer,
  text,
  uuid
) is
  'Adjusts a configuration only when its locked quantity matches the displayed expected quantity.';

commit;
