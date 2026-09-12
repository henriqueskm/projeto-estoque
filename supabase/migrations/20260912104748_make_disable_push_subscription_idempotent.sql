create or replace function public.disable_push_subscription(
  p_device_id uuid,
  p_firebase_installation_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_firebase_installation_id text :=
    nullif(btrim(p_firebase_installation_id), '');
  v_disabled boolean := false;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication is required.';
  end if;

  if not exists (
    select 1
    from public.profiles as profile
    where profile.id = v_user_id
      and profile.is_active
  ) then
    raise exception using errcode = '42501', message = 'An active internal profile is required.';
  end if;

  if v_firebase_installation_id is null
    or char_length(v_firebase_installation_id) > 512
    or v_firebase_installation_id ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'The Firebase installation ID is invalid.';
  end if;

  update public.push_subscriptions
  set enabled = false,
      updated_at = now(),
      last_seen_at = now()
  where user_id = v_user_id
    and firebase_installation_id = v_firebase_installation_id
  returning true into v_disabled;

  return jsonb_build_object('disabled', coalesce(v_disabled, false));
end;
$$;
