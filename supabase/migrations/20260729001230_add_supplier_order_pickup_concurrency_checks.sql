create function private.set_supplier_order_item_picked_quantity_checked(
  p_supplier_order_item_id uuid,
  p_target_picked_quantity integer,
  p_description text,
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
  v_description text;
  v_request jsonb;
  v_existing_result jsonb;
  v_result jsonb;
  v_order public.supplier_orders%rowtype;
  v_line public.supplier_order_items%rowtype;
begin
  if p_supplier_order_item_id is null
    or p_target_picked_quantity is null
    or p_target_picked_quantity < 0
    or p_expected_order_updated_at is null
    or p_idempotency_key is null
    or p_user_id is null
    or nullif(btrim(p_user_name), '') is null then
    raise exception using
      errcode = '22023',
      message = 'Line, nonnegative target, expected order version, idempotency key, and authenticated user are required.';
  end if;

  v_description := nullif(btrim(p_description), '');

  if v_description is not null and char_length(v_description) > 2000 then
    raise exception using
      errcode = '22023',
      message = 'p_description must contain at most 2000 characters.';
  end if;

  -- Keep the canonical request identical to the existing worker so its
  -- immutable event remains the single idempotency ledger.
  v_request := jsonb_build_object(
    'supplier_order_item_id', p_supplier_order_item_id,
    'picked_quantity', p_target_picked_quantity,
    'description', v_description
  );

  -- The helper acquires the per-user/key advisory transaction lock first.
  -- An identical replay returns before checking the now-stale preview token.
  v_existing_result := private.supplier_order_existing_result(
    p_user_id,
    p_idempotency_key,
    'PICKED_QUANTITY_CHANGED',
    v_request
  );

  if v_existing_result is not null then
    return v_existing_result
      || jsonb_build_object('idempotent_replay', true);
  end if;

  -- Preserve the official lock order: parent order, then affected line.
  select supplier_order.*
  into v_order
  from public.supplier_order_items as order_item
  join public.supplier_orders as supplier_order
    on supplier_order.id = order_item.supplier_order_id
  where order_item.id = p_supplier_order_item_id
  for update of supplier_order;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'The supplier-order line does not exist.';
  end if;

  select order_item.*
  into v_line
  from public.supplier_order_items as order_item
  where order_item.id = p_supplier_order_item_id
    and order_item.supplier_order_id = v_order.id
  for update;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'The supplier-order line does not exist.';
  end if;

  -- This comparison is inside the same transaction, after every required
  -- row lock, and before the delegated worker can write anything.
  if v_order.updated_at is distinct from p_expected_order_updated_at then
    raise exception using
      errcode = '40001',
      message = 'supplier_order_version_conflict';
  end if;

  v_result := private.set_supplier_order_item_picked_quantity(
    p_supplier_order_item_id,
    p_target_picked_quantity,
    v_description,
    p_idempotency_key,
    p_user_id,
    btrim(p_user_name)
  );

  return v_result || jsonb_build_object('idempotent_replay', false);
end;
$$;

create function private.mark_supplier_order_all_picked_checked(
  p_supplier_order_id uuid,
  p_description text,
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
  v_description text;
  v_request jsonb;
  v_existing_result jsonb;
  v_result jsonb;
  v_order public.supplier_orders%rowtype;
  v_added_picked_quantity bigint := 0;
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

  v_description := nullif(btrim(p_description), '');

  if v_description is not null and char_length(v_description) > 2000 then
    raise exception using
      errcode = '22023',
      message = 'p_description must contain at most 2000 characters.';
  end if;

  -- Keep the canonical request identical to the existing worker.
  v_request := jsonb_build_object(
    'supplier_order_id', p_supplier_order_id,
    'description', v_description
  );

  v_existing_result := private.supplier_order_existing_result(
    p_user_id,
    p_idempotency_key,
    'ALL_ITEMS_MARKED_PICKED',
    v_request
  );

  if v_existing_result is not null then
    select coalesce(
      sum(
        (change.value ->> 'new_picked_quantity')::bigint
          - (change.value ->> 'previous_picked_quantity')::bigint
      ),
      0
    )
    into v_added_picked_quantity
    from public.supplier_order_events as event
    cross join lateral jsonb_array_elements(
      coalesce(event.details -> 'changes', '[]'::jsonb)
    ) as change(value)
    where event.user_id = p_user_id
      and event.idempotency_key = p_idempotency_key
      and event.event_type = 'ALL_ITEMS_MARKED_PICKED';

    return v_existing_result || jsonb_build_object(
      'added_picked_quantity', v_added_picked_quantity,
      'idempotent_replay', true
    );
  end if;

  -- Preserve the official lock order: parent order, then all lines by UUID.
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

  select coalesce(
    sum(
      order_item.ordered_quantity
        - order_item.cancelled_quantity
        - order_item.picked_quantity
    ),
    0
  )
  into v_added_picked_quantity
  from public.supplier_order_items as order_item
  where order_item.supplier_order_id = p_supplier_order_id;

  v_result := private.mark_supplier_order_all_picked(
    p_supplier_order_id,
    v_description,
    p_idempotency_key,
    p_user_id,
    btrim(p_user_name)
  );

  return v_result || jsonb_build_object(
    'added_picked_quantity', v_added_picked_quantity,
    'idempotent_replay', false
  );
end;
$$;

create function public.set_supplier_order_item_picked_quantity_checked(
  p_supplier_order_item_id uuid,
  p_target_picked_quantity integer,
  p_description text,
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

  return private.set_supplier_order_item_picked_quantity_checked(
    p_supplier_order_item_id,
    p_target_picked_quantity,
    p_description,
    p_expected_order_updated_at,
    p_idempotency_key,
    v_user.user_id,
    v_user.user_name
  );
end;
$$;

create function public.mark_supplier_order_all_picked_checked(
  p_supplier_order_id uuid,
  p_description text,
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

  return private.mark_supplier_order_all_picked_checked(
    p_supplier_order_id,
    p_description,
    p_expected_order_updated_at,
    p_idempotency_key,
    v_user.user_id,
    v_user.user_name
  );
end;
$$;

revoke all on function private.set_supplier_order_item_picked_quantity_checked(
  uuid,
  integer,
  text,
  timestamptz,
  uuid,
  uuid,
  text
) from public, anon, authenticated;

revoke all on function private.mark_supplier_order_all_picked_checked(
  uuid,
  text,
  timestamptz,
  uuid,
  uuid,
  text
) from public, anon, authenticated;

revoke all on function public.set_supplier_order_item_picked_quantity_checked(
  uuid,
  integer,
  text,
  timestamptz,
  uuid
) from public, anon, authenticated;

revoke all on function public.mark_supplier_order_all_picked_checked(
  uuid,
  text,
  timestamptz,
  uuid
) from public, anon, authenticated;

grant execute on function public.set_supplier_order_item_picked_quantity_checked(
  uuid,
  integer,
  text,
  timestamptz,
  uuid
) to authenticated;

grant execute on function public.mark_supplier_order_all_picked_checked(
  uuid,
  text,
  timestamptz,
  uuid
) to authenticated;

comment on function private.set_supplier_order_item_picked_quantity_checked(
  uuid,
  integer,
  text,
  timestamptz,
  uuid,
  uuid,
  text
) is
  'Checks an Assistant pickup preview token under the official order/line locks, then delegates the absolute quantity and audit to the existing worker.';

comment on function private.mark_supplier_order_all_picked_checked(
  uuid,
  text,
  timestamptz,
  uuid,
  uuid,
  text
) is
  'Checks an Assistant mark-all preview token under stable order/line locks, then delegates the atomic update and audit to the existing worker.';

comment on function public.set_supplier_order_item_picked_quantity_checked(
  uuid,
  integer,
  text,
  timestamptz,
  uuid
) is
  'Sets one supplier-order picked quantity to an absolute target for Assistant proposals. Identical retries remain idempotent; a new request with a stale order version fails after locking and before any write.';

comment on function public.mark_supplier_order_all_picked_checked(
  uuid,
  text,
  timestamptz,
  uuid
) is
  'Atomically marks every available supplier-order quantity as picked for Assistant proposals. Identical retries remain idempotent; a new request with a stale order version fails after locking and before any write.';
