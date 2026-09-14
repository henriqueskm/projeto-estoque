begin;

create function private.cancel_supplier_order_checked(
  p_supplier_order_id uuid,
  p_cancellation_note text,
  p_expected_order_updated_at timestamptz,
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
  v_cancellation_note text;
  v_request jsonb;
  v_existing_result jsonb;
  v_order public.supplier_orders%rowtype;
  v_result jsonb;
begin
  if p_supplier_order_id is null
    or p_expected_order_updated_at is null
    or p_idempotency_key is null
    or p_user_id is null
    or nullif(btrim(p_user_name), '') is null then
    raise exception using
      errcode = '22023',
      message = 'Order, expected order version, idempotency key, and authenticated user are required.';
  end if;

  v_cancellation_note := nullif(btrim(p_cancellation_note), '');

  if v_cancellation_note is null then
    raise exception using
      errcode = '22023',
      message = 'A cancellation reason is required.';
  end if;

  if char_length(v_cancellation_note) > 2000 then
    raise exception using
      errcode = '22023',
      message = 'p_cancellation_note must contain at most 2000 characters.';
  end if;

  v_request := jsonb_build_object(
    'supplier_order_id', p_supplier_order_id,
    'cancellation_note', v_cancellation_note
  );

  -- The idempotency ledger owns the advisory lock. An identical replay must
  -- return the committed result before the old preview version is compared.
  v_existing_result := private.supplier_order_existing_result(
    p_user_id,
    p_idempotency_key,
    'ORDER_CANCELLED',
    v_request
  );

  if v_existing_result is not null then
    return v_existing_result
      || jsonb_build_object('idempotent_replay', true);
  end if;

  -- Preserve the official lock order: parent order, then every line by UUID.
  select supplier_order.*
  into v_order
  from public.supplier_orders as supplier_order
  where supplier_order.id = p_supplier_order_id
  for update;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'The supplier order does not exist.';
  end if;

  perform 1
  from public.supplier_order_items as order_item
  where order_item.supplier_order_id = p_supplier_order_id
  order by order_item.id
  for update;

  if v_order.updated_at is distinct from p_expected_order_updated_at then
    raise exception using
      errcode = '40001',
      message = 'supplier_order_version_conflict';
  end if;

  v_result := private.cancel_supplier_order(
    p_supplier_order_id,
    v_cancellation_note,
    p_idempotency_key,
    p_user_id,
    btrim(p_user_name)
  );

  return v_result || jsonb_build_object('idempotent_replay', false);
end;
$$;

create function private.cancel_supplier_order_remaining_checked(
  p_supplier_order_id uuid,
  p_cancellation_note text,
  p_expected_order_updated_at timestamptz,
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
  v_cancellation_note text;
  v_request jsonb;
  v_existing_result jsonb;
  v_order public.supplier_orders%rowtype;
  v_result jsonb;
begin
  if p_supplier_order_id is null
    or p_expected_order_updated_at is null
    or p_idempotency_key is null
    or p_user_id is null
    or nullif(btrim(p_user_name), '') is null then
    raise exception using
      errcode = '22023',
      message = 'Order, expected order version, idempotency key, and authenticated user are required.';
  end if;

  v_cancellation_note := nullif(btrim(p_cancellation_note), '');

  if v_cancellation_note is null then
    raise exception using
      errcode = '22023',
      message = 'A cancellation reason is required.';
  end if;

  if char_length(v_cancellation_note) > 2000 then
    raise exception using
      errcode = '22023',
      message = 'p_cancellation_note must contain at most 2000 characters.';
  end if;

  v_request := jsonb_build_object(
    'supplier_order_id', p_supplier_order_id,
    'cancellation_note', v_cancellation_note
  );

  v_existing_result := private.supplier_order_existing_result(
    p_user_id,
    p_idempotency_key,
    'REMAINING_QUANTITY_CANCELLED',
    v_request
  );

  if v_existing_result is not null then
    return v_existing_result
      || jsonb_build_object('idempotent_replay', true);
  end if;

  select supplier_order.*
  into v_order
  from public.supplier_orders as supplier_order
  where supplier_order.id = p_supplier_order_id
  for update;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'The supplier order does not exist.';
  end if;

  perform 1
  from public.supplier_order_items as order_item
  where order_item.supplier_order_id = p_supplier_order_id
  order by order_item.id
  for update;

  if v_order.updated_at is distinct from p_expected_order_updated_at then
    raise exception using
      errcode = '40001',
      message = 'supplier_order_version_conflict';
  end if;

  v_result := private.cancel_supplier_order_remaining(
    p_supplier_order_id,
    v_cancellation_note,
    p_idempotency_key,
    p_user_id,
    btrim(p_user_name)
  );

  return v_result || jsonb_build_object('idempotent_replay', false);
end;
$$;

create function public.cancel_supplier_order_checked(
  p_supplier_order_id uuid,
  p_cancellation_note text,
  p_expected_order_updated_at timestamptz,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user record;
begin
  select *
  into v_user
  from private.require_supplier_order_user();

  return private.cancel_supplier_order_checked(
    p_supplier_order_id,
    p_cancellation_note,
    p_expected_order_updated_at,
    p_idempotency_key,
    v_user.user_id,
    v_user.user_name
  );
end;
$$;

create function public.cancel_supplier_order_remaining_checked(
  p_supplier_order_id uuid,
  p_cancellation_note text,
  p_expected_order_updated_at timestamptz,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user record;
begin
  select *
  into v_user
  from private.require_supplier_order_user();

  return private.cancel_supplier_order_remaining_checked(
    p_supplier_order_id,
    p_cancellation_note,
    p_expected_order_updated_at,
    p_idempotency_key,
    v_user.user_id,
    v_user.user_name
  );
end;
$$;

revoke all on function private.cancel_supplier_order_checked(
  uuid,
  text,
  timestamptz,
  uuid,
  uuid,
  text
) from public, anon, authenticated;

revoke all on function private.cancel_supplier_order_remaining_checked(
  uuid,
  text,
  timestamptz,
  uuid,
  uuid,
  text
) from public, anon, authenticated;

revoke all on function public.cancel_supplier_order_checked(
  uuid,
  text,
  timestamptz,
  uuid
) from public, anon, authenticated;

revoke all on function public.cancel_supplier_order_remaining_checked(
  uuid,
  text,
  timestamptz,
  uuid
) from public, anon, authenticated;

grant execute on function public.cancel_supplier_order_checked(
  uuid,
  text,
  timestamptz,
  uuid
) to authenticated, service_role;

grant execute on function public.cancel_supplier_order_remaining_checked(
  uuid,
  text,
  timestamptz,
  uuid
) to authenticated, service_role;

-- Keep the legacy wrappers available only to service integrations while
-- closing every client-role bypass around the versioned mutation contract.
revoke execute on function public.set_supplier_order_item_picked_quantity(
  uuid,
  integer,
  text,
  uuid
) from public, anon, authenticated;

revoke execute on function public.mark_supplier_order_all_picked(
  uuid,
  text,
  uuid
) from public, anon, authenticated;

revoke execute on function public.cancel_supplier_order(
  uuid,
  text,
  uuid
) from public, anon, authenticated;

revoke execute on function public.cancel_supplier_order_remaining(
  uuid,
  text,
  uuid
) from public, anon, authenticated;

grant execute on function public.set_supplier_order_item_picked_quantity(
  uuid,
  integer,
  text,
  uuid
) to service_role;

grant execute on function public.mark_supplier_order_all_picked(
  uuid,
  text,
  uuid
) to service_role;

grant execute on function public.cancel_supplier_order(
  uuid,
  text,
  uuid
) to service_role;

grant execute on function public.cancel_supplier_order_remaining(
  uuid,
  text,
  uuid
) to service_role;

comment on function private.cancel_supplier_order_checked(
  uuid,
  text,
  timestamptz,
  uuid,
  uuid,
  text
) is
  'Checks an order cancellation version under stable order/line locks. Identical retries return from the existing event ledger before the stale comparison.';

comment on function private.cancel_supplier_order_remaining_checked(
  uuid,
  text,
  timestamptz,
  uuid,
  uuid,
  text
) is
  'Checks a remaining-quantity cancellation version under stable order/line locks. Identical retries return from the existing event ledger before the stale comparison.';

comment on function public.cancel_supplier_order_checked(
  uuid,
  text,
  timestamptz,
  uuid
) is
  'Cancels an eligible supplier order only when the displayed order version is current.';

comment on function public.cancel_supplier_order_remaining_checked(
  uuid,
  text,
  timestamptz,
  uuid
) is
  'Cancels an eligible supplier-order remainder only when the displayed order version is current.';

commit;
