-- Keep the existing private writer as the single mutation path while exposing
-- an explicit policy switch to callers. The Assistente uses false; the
-- historical three-argument API and /saida keep the legacy true behavior.

create function public.stock_outbound_items(
  p_lines jsonb,
  p_idempotency_key uuid,
  p_description text,
  p_allow_auto_assembly boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_user_name text;
  v_existing_batch_id uuid;
  v_record record;
  v_configuration_quantity integer;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception using
      errcode = '28000',
      message = 'An authenticated user is required.';
  end if;

  if p_idempotency_key is null then
    raise exception using
      errcode = '22023',
      message = 'p_idempotency_key is required for a batch stock outbound.';
  end if;

  if p_allow_auto_assembly is null then
    raise exception using
      errcode = '22023',
      message = 'p_allow_auto_assembly is required for a batch stock outbound.';
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

  -- Serialize every public overload by actor and idempotency key. This lets a
  -- completed replay reach the canonical writer before any balance preflight
  -- and prevents a same-key race from inverting the writer's lock order.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_user_id::text || ':' || p_idempotency_key::text,
      0
    )
  );

  select batch.id
  into v_existing_batch_id
  from public.movement_batches as batch
  where batch.user_id = v_user_id
    and batch.idempotency_key = p_idempotency_key
  for share;

  if found then
    return private.stock_outbound_items(
      p_lines,
      p_idempotency_key,
      v_user_id,
      v_user_name,
      p_description
    );
  end if;

  if not p_allow_auto_assembly then
    if p_lines is null
      or jsonb_typeof(p_lines) is distinct from 'array'
      or jsonb_array_length(p_lines) = 0 then
      raise exception using
        errcode = '22023',
        message = 'p_lines must be a non-empty JSON array.';
    end if;

    -- Match the canonical writer's catalog lock order before inspecting the
    -- mounted balances. Invalid catalog/payload details remain fail-closed in
    -- the canonical writer and cannot leave effects because this transaction
    -- is atomic.
    for v_record in
      select distinct (payload.value ->> 'commercial_code_id')::uuid as commercial_code_id
      from jsonb_array_elements(p_lines) as payload(value)
      where payload.value ->> 'kind' = 'COMMERCIAL_CODE'
      order by commercial_code_id
    loop
      perform 1
      from public.commercial_configuration_codes as commercial_code
      where commercial_code.id = v_record.commercial_code_id
      for share;
    end loop;

    for v_record in
      with requested_configurations as (
        select
          commercial_code.configuration_id,
          sum((payload.value ->> 'quantity')::numeric) as quantity
        from jsonb_array_elements(p_lines) as payload(value)
        join public.commercial_configuration_codes as commercial_code
          on commercial_code.id =
            (payload.value ->> 'commercial_code_id')::uuid
        where payload.value ->> 'kind' = 'COMMERCIAL_CODE'
        group by commercial_code.configuration_id
      )
      select requested.configuration_id, requested.quantity
      from requested_configurations as requested
      order by requested.configuration_id
    loop
      perform 1
      from public.commercial_configurations as configuration
      where configuration.id = v_record.configuration_id
      for share;

      select balance.quantity
      into v_configuration_quantity
      from public.configuration_stock_balances as balance
      where balance.configuration_id = v_record.configuration_id
      for update;

      v_configuration_quantity := coalesce(v_configuration_quantity, 0);

      if v_record.quantity > v_configuration_quantity then
        raise exception using
          errcode = '23514',
          message = format(
            'Automatic assembly is disabled for this batch stock outbound: configuration %s has %s assembled and requires %s.',
            v_record.configuration_id,
            v_configuration_quantity,
            v_record.quantity
          );
      end if;
    end loop;
  end if;

  return private.stock_outbound_items(
    p_lines,
    p_idempotency_key,
    v_user_id,
    v_user_name,
    p_description
  );
end;
$$;

create or replace function public.stock_outbound_items(
  p_lines jsonb,
  p_idempotency_key uuid,
  p_description text default null
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.stock_outbound_items(
    p_lines,
    p_idempotency_key,
    p_description,
    true
  );
$$;

revoke all on function public.stock_outbound_items(jsonb, uuid, text, boolean)
from public, anon, authenticated;

grant execute on function public.stock_outbound_items(jsonb, uuid, text, boolean)
to authenticated;

revoke all on function public.stock_outbound_items(jsonb, uuid, text)
from public, anon, authenticated;

grant execute on function public.stock_outbound_items(jsonb, uuid, text)
to authenticated;
