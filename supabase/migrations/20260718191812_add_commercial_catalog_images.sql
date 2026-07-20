begin;

set local lock_timeout = '5s';

create temporary table expected_commercial_catalog_images (
  configuration_id uuid primary key,
  primary_code text not null,
  aliases text[] not null,
  image_path text unique
) on commit drop;

insert into pg_temp.expected_commercial_catalog_images (
  configuration_id,
  primary_code,
  aliases,
  image_path
)
values
  ('205f8975-c6fd-4589-ac8d-090409f1872d'::uuid, '10A', array['10A']::text[], 'catalog/10A.jpg'),
  ('6eadd2d6-d610-40f0-880c-d58590338a26'::uuid, '10B', array['10B']::text[], 'catalog/10B.jpg'),
  ('8da7efe3-590d-433d-a496-a16131e2761e'::uuid, '10C', array['10C']::text[], 'catalog/10C.jpg'),
  ('3db6c1d4-a63b-42ba-8605-70104cb4018b'::uuid, '10D', array['10D']::text[], 'catalog/10D.jpg'),
  ('8ff468fb-07f3-4004-a57e-6e58f8c6e38e'::uuid, '10E', array['10E']::text[], 'catalog/10E.jpg'),
  ('a3efd0b3-16de-4011-bef1-da672f587b59'::uuid, '11A', array['11A']::text[], 'catalog/11A.jpg'),
  ('2e3c0fdf-1fbd-4047-92be-745c3c1ed0f0'::uuid, '11B', array['11B']::text[], 'catalog/11B.jpg'),
  ('36535862-3539-4ea5-b1eb-0179caf19b8c'::uuid, '11C', array['11C']::text[], 'catalog/11C.jpg'),
  ('a51404fd-08b0-4a0f-8225-27d701f11ce5'::uuid, '11D', array['11D']::text[], 'catalog/11D.jpg'),
  ('4129d2bc-0a12-43d4-88f1-ef8e0292b635'::uuid, '11E', array['11E']::text[], null),
  ('13e37106-8962-4c83-9582-a8bc85a109e5'::uuid, '12A', array['12A']::text[], 'catalog/12A.jpg'),
  ('9f7033eb-930b-4529-b73d-1abd4671717f'::uuid, '1A', array['1A']::text[], 'catalog/1A.jpg'),
  ('ffdbc822-37ab-4018-a476-b7e6e1f0e596'::uuid, '1B', array['1B', '1D']::text[], 'catalog/1B.jpg'),
  ('b9726018-bf6e-4cc9-80cb-4385cc82037d'::uuid, '1C', array['1C']::text[], 'catalog/1C.jpg'),
  ('5c3710f7-443e-4515-8daa-5354e3a89e40'::uuid, '1E', array['1E']::text[], 'catalog/1E.jpg'),
  ('123d6873-cf58-4d08-be18-43cd89d08335'::uuid, '1F', array['1F']::text[], 'catalog/1F.jpg'),
  ('384fdece-87a8-42bd-ae99-fb8a80358233'::uuid, '1H', array['1H']::text[], 'catalog/1H.jpg'),
  ('23e5f7c3-95a8-4f20-8bc9-778bb20f3135'::uuid, '2A', array['2A']::text[], 'catalog/2A.jpg'),
  ('dcdad848-f045-45c9-81a2-c1c8f23b0a33'::uuid, '2B', array['2B']::text[], 'catalog/2B.jpg'),
  ('892ebb5d-6de4-42fc-a88b-b59c889fdd04'::uuid, '2C', array['2C']::text[], 'catalog/2C.jpg'),
  ('f49ef85f-1a10-40ed-a3b7-cf4d97156699'::uuid, '2D', array['2D']::text[], 'catalog/2D.jpg'),
  ('1c7d73c6-6025-4a87-af0e-f300b897edee'::uuid, '2E', array['2E']::text[], 'catalog/2E.jpg'),
  ('7e2d56a4-f203-4456-b76e-8255b9e30402'::uuid, '2F', array['2F']::text[], 'catalog/2F.jpg'),
  ('3c3660b9-eba6-483a-b361-1078d1a433d3'::uuid, '2H', array['2H']::text[], 'catalog/2H.jpg'),
  ('8adb70fd-60d2-4a9c-a2c5-7001c1685bf4'::uuid, '3A', array['3A']::text[], 'catalog/3A.jpg'),
  ('ca4a9418-d688-4400-9600-b62cc4077ecb'::uuid, '3B', array['3B']::text[], 'catalog/3B.jpg'),
  ('9e293321-6a65-4ec4-b4f9-c11427e38e4e'::uuid, '3C', array['3C']::text[], 'catalog/3C.jpg'),
  ('468a8e4b-0b8d-4e04-af3d-45d66f1c9ca4'::uuid, '4B', array['4B']::text[], 'catalog/4B.jpg'),
  ('654e578b-fbae-457d-a5e8-2bb37987cdb5'::uuid, '4C', array['4C']::text[], 'catalog/4C.jpg'),
  ('32a5f105-ac3b-430f-8064-66d99843f306'::uuid, '4E', array['4E']::text[], 'catalog/4E.jpg'),
  ('6edd539c-865d-451f-b87e-c3e109a2ae03'::uuid, '4F', array['4F']::text[], 'catalog/4F.jpg'),
  ('0c7b8f4f-6067-42ac-9232-e4b5feab39cb'::uuid, '5B', array['5B']::text[], 'catalog/5B.jpg'),
  ('50a94da7-860a-437d-9391-7c08532bd4bc'::uuid, '5C', array['5C']::text[], 'catalog/5C.jpg'),
  ('63741d1f-4907-4dd5-ad1e-88a792d1fea8'::uuid, '5D', array['5D']::text[], 'catalog/5D.jpg'),
  ('904e836d-f8a3-4257-bbba-a272ecaff2c3'::uuid, '5E', array['5E']::text[], 'catalog/5E.jpg'),
  ('539be51a-52d3-4544-b866-83534880ee16'::uuid, '5F', array['5F']::text[], 'catalog/5F.jpg'),
  ('a8a78bf8-73fd-4a9e-a641-2e3e8db019c9'::uuid, '5G', array['5G']::text[], 'catalog/5G.jpg'),
  ('78ec88aa-28fa-4cda-9614-99504ec150db'::uuid, '5H', array['5H']::text[], 'catalog/5H.jpg'),
  ('40edd720-ab53-4432-8613-1f78ea9a2cb3'::uuid, '5I', array['5I']::text[], 'catalog/5I.jpg'),
  ('b252de6b-83a7-403d-a8ca-0075cf503135'::uuid, '5J', array['5J']::text[], 'catalog/5J.jpg'),
  ('0c8c3783-aa2a-4ec3-bda4-2e2f269ae765'::uuid, '5L', array['5L']::text[], 'catalog/5L.jpg'),
  ('80b12ebf-f1e6-43c8-97b3-404b1f30a215'::uuid, '5M', array['5M']::text[], 'catalog/5M.jpg'),
  ('e6b70d71-f9e7-47ed-b7e4-48a6c1d9c9ec'::uuid, '5P', array['5P']::text[], 'catalog/5P.jpg'),
  ('2356a987-f0be-406e-bb3a-9cb3422a54db'::uuid, '5W', array['5W']::text[], 'catalog/5W.jpg'),
  ('4b20ac5f-5d98-450e-a25f-2ead622d4a76'::uuid, '5X', array['5X']::text[], 'catalog/5X.jpg'),
  ('b6aebf6f-2dd4-4288-ab56-c54e3c96adb2'::uuid, '5Z', array['5Z']::text[], 'catalog/5Z.jpg'),
  ('af76f954-afc2-425c-8e29-056a8acaa7c4'::uuid, '6A', array['6A']::text[], 'catalog/6A.jpg'),
  ('02a08a54-ae8e-47a2-a994-49cf00236052'::uuid, '6B', array['6B']::text[], 'catalog/6B.jpg'),
  ('adbd0b6f-58ab-4996-84d6-59bc998c37d8'::uuid, '6C', array['6C', '6I']::text[], 'catalog/6C.jpg'),
  ('0464114f-853b-40bc-bbf3-0abbcc03ae1f'::uuid, '6F', array['6E', '6F']::text[], 'catalog/6F.jpg'),
  ('a8eaf51c-b980-42f1-b2f5-1ffbc9d5177e'::uuid, '6G', array['6G']::text[], 'catalog/6G.jpg'),
  ('4372efb9-4967-4028-b248-5ee196769efb'::uuid, '6H', array['6H']::text[], 'catalog/6H.jpg'),
  ('0893ea08-f793-43df-805b-6fc86b9901c1'::uuid, '6J', array['6J']::text[], 'catalog/6J.jpg'),
  ('118b36c0-234d-4358-bb3f-e9eba21af4d7'::uuid, '6L', array['6L']::text[], 'catalog/6L.jpg'),
  ('af240c3a-da83-4eb9-85a7-8b0966f27bf3'::uuid, '6O', array['6O']::text[], 'catalog/6O.jpg'),
  ('0837fec5-6a54-4c84-a6e6-e142b34a9e22'::uuid, '6P', array['6P']::text[], 'catalog/6P.jpg'),
  ('2a2f5d77-bfe2-42cb-9942-cba87625b28d'::uuid, '6R', array['6R']::text[], 'catalog/6R.jpg'),
  ('0ab6abcc-ea8b-4a10-8aca-3ffa1020dbb1'::uuid, '7A', array['7A']::text[], 'catalog/7A.jpg'),
  ('371b0c95-d79f-4b2f-81fb-e510309476a2'::uuid, '7AB', array['7AB']::text[], 'catalog/7AB.jpg'),
  ('ab2557cc-697e-44a0-a9d3-4fb1dd7b4f0d'::uuid, '7AC', array['7AC']::text[], 'catalog/7AC.jpg'),
  ('8cd27792-7cfc-4132-81ad-19c3eaa0f864'::uuid, '7AD', array['7AD']::text[], 'catalog/7AD.jpg'),
  ('faeeefa0-5a68-4579-ba76-4f02b349c8f9'::uuid, '7AF', array['7AF']::text[], 'catalog/7AF.jpg'),
  ('3f37e7fe-818d-4e2c-bc1e-343ae39cf63a'::uuid, '7D', array['7D']::text[], 'catalog/7D.jpg'),
  ('91239b2d-eb74-4ca6-8c6f-819b29be665b'::uuid, '7E', array['7E']::text[], 'catalog/7E.jpg'),
  ('cecf8e8f-281a-4bb9-b060-786eb2130c37'::uuid, '7F', array['7F']::text[], 'catalog/7F.jpg'),
  ('b42da7ae-b081-4265-b7c7-a69c0b672258'::uuid, '7H', array['7H']::text[], 'catalog/7H.jpg'),
  ('99addc71-0536-4ae3-ae02-14183c7474d8'::uuid, '7N', array['7N']::text[], 'catalog/7N.jpg'),
  ('77167b40-3c28-49ba-b4ce-808fdb64a022'::uuid, '7P', array['7P']::text[], 'catalog/7P.jpg'),
  ('2a7e7865-7fcf-4944-9cb6-a353d9f21179'::uuid, '7Q', array['7Q']::text[], 'catalog/7Q.jpg'),
  ('6445d19f-5c24-443b-9802-761b39a76da6'::uuid, '7R', array['7R']::text[], 'catalog/7R.jpg'),
  ('519b79a3-0c79-4e9c-9814-b2a3492c52a6'::uuid, '7X', array['7X']::text[], 'catalog/7X.jpg'),
  ('dc74232a-f5c1-4bc2-a4d8-145c5f7c2435'::uuid, '7Y', array['7Y']::text[], 'catalog/7Y.jpg'),
  ('053ae801-b16f-4f48-aa59-8f25e7de1596'::uuid, '7Z', array['7Z']::text[], 'catalog/7Z.jpg'),
  ('7809b0b5-a697-4f30-8808-7475b420603d'::uuid, '9A', array['9A']::text[], 'catalog/9A.jpg'),
  ('4691a637-ea6c-447a-b92f-0a58581f557b'::uuid, '9B', array['9B']::text[], 'catalog/9B.jpg'),
  ('19273c1c-aa7f-4acc-bde7-6d82773c2c34'::uuid, '9C', array['9C']::text[], 'catalog/9C.jpg'),
  ('62316df6-e0ca-4e9c-8f55-73811596b74b'::uuid, '9D', array['9D']::text[], 'catalog/9D.jpg');

do $$
begin
  lock table storage.buckets in share row exclusive mode nowait;
  lock table storage.objects in share mode nowait;
  lock table public.assembly_operations in share mode nowait;
  lock table public.configuration_stock_balances in share mode nowait;
  lock table public.configuration_stock_movements in share mode nowait;
  lock table public.inbound_batch_lines in share mode nowait;
  lock table public.movement_batches in share mode nowait;
  lock table public.outbound_batch_lines in share mode nowait;
  lock table public.stock_balances in share mode nowait;
  lock table public.stock_movements in share mode nowait;

  perform configuration.id
  from public.commercial_configurations as configuration
  order by configuration.id
  for update nowait;

  perform commercial_code.id
  from public.commercial_configuration_codes as commercial_code
  order by commercial_code.id
  for update nowait;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'commercial_configurations'
      and column_name = 'image_path'
  ) or exists (
    select 1
    from pg_constraint
    where conrelid = 'public.commercial_configurations'::regclass
      and conname = 'commercial_configurations_image_path_check'
  ) or to_regclass(
    'public.commercial_configurations_image_path_uidx'
  ) is not null then
    raise exception using
      errcode = '42701',
      message =
        'Commercial catalog image migration aborted: image schema already exists.';
  end if;

  if exists (
    select 1
    from storage.buckets
    where id = 'commercial-catalog-images'
       or name = 'commercial-catalog-images'
  ) or exists (
    select 1
    from storage.objects
    where bucket_id = 'commercial-catalog-images'
  ) then
    raise exception using
      errcode = '23505',
      message =
        'Commercial catalog image migration aborted: target storage state already exists.';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
  ) then
    raise exception using
      errcode = '42710',
      message =
        'Commercial catalog image migration aborted: storage.objects policies diverged from the approved empty baseline.';
  end if;

  if (select count(*) from pg_temp.expected_commercial_catalog_images) <> 77
    or (
      select count(*)
      from pg_temp.expected_commercial_catalog_images
      where image_path is not null
    ) <> 76
    or (
      select count(*)
      from pg_temp.expected_commercial_catalog_images
      where image_path is null
    ) <> 1
    or exists (
      select 1
      from pg_temp.expected_commercial_catalog_images as expected
      where not (expected.primary_code = any(expected.aliases))
        or expected.aliases is null
        or cardinality(expected.aliases) = 0
        or expected.aliases is distinct from (
          select array_agg(
            expected_alias.alias
            order by expected_alias.alias collate "C"
          )
          from unnest(expected.aliases) as expected_alias(alias)
        )
        or (
          expected.image_path is not null
          and expected.image_path
            is distinct from
              'catalog/' || expected.primary_code || '.jpg'
        )
    )
    or exists (
      select expected_alias.alias
      from pg_temp.expected_commercial_catalog_images as expected,
        unnest(expected.aliases) as expected_alias(alias)
      group by expected_alias.alias
      having count(*) <> 1
    )
    or not exists (
      select 1
      from pg_temp.expected_commercial_catalog_images
      where configuration_id =
          '4129d2bc-0a12-43d4-88f1-ef8e0292b635'::uuid
        and primary_code = '11E'
        and aliases = array['11E']::text[]
        and image_path is null
    ) then
    raise exception using
      errcode = '23514',
      message =
        'Commercial catalog image migration aborted: the explicit manifest mapping is inconsistent.';
  end if;

  if (select count(*) from public.commercial_configurations where is_active)
      <> 77
    or (
      select count(*)
      from public.commercial_configuration_codes
      where is_active
    ) <> 80
    or exists (
      select 1
      from public.commercial_configurations as configuration
      where configuration.is_active
        and not exists (
          select 1
          from pg_temp.expected_commercial_catalog_images as expected
          where expected.configuration_id = configuration.id
        )
    )
    or exists (
      select 1
      from pg_temp.expected_commercial_catalog_images as expected
      left join public.commercial_configurations as configuration
        on configuration.id = expected.configuration_id
      left join lateral (
        select
          array_agg(
            commercial_code.code
            order by commercial_code.code collate "C"
          ) as aliases,
          bool_and(commercial_code.is_active) as all_active
        from public.commercial_configuration_codes as commercial_code
        where commercial_code.configuration_id = expected.configuration_id
      ) as actual on true
      where configuration.id is null
        or not configuration.is_active
        or actual.aliases is distinct from expected.aliases
        or actual.all_active is distinct from true
    ) then
    raise exception using
      errcode = '23514',
      message =
        'Commercial catalog image migration aborted: active configurations or aliases diverged from the manifest.';
  end if;

  if exists (select 1 from public.movement_batches)
    or exists (select 1 from public.inbound_batch_lines)
    or exists (select 1 from public.outbound_batch_lines)
    or exists (select 1 from public.stock_movements)
    or exists (select 1 from public.configuration_stock_movements)
    or exists (select 1 from public.assembly_operations)
    or exists (select 1 from public.stock_balances)
    or exists (select 1 from public.configuration_stock_balances) then
    raise exception using
      errcode = '23514',
      message =
        'Commercial catalog image migration aborted: operational data diverged from the approved empty baseline.';
  end if;
end;
$$;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'commercial-catalog-images',
  'commercial-catalog-images',
  false,
  5242880,
  array['image/jpeg']::text[]
);

alter table public.commercial_configurations
add column image_path text;

comment on column public.commercial_configurations.image_path is
  'Object path in the private commercial-catalog-images Storage bucket for this physical commercial configuration.';

alter table public.commercial_configurations
add constraint commercial_configurations_image_path_check
check (
  image_path is null
  or (
    image_path = btrim(image_path)
    and image_path ~* '^catalog/[a-z0-9][a-z0-9._-]*\.(jpg|jpeg)$'
    and position(E'\\' in image_path) = 0
    and image_path !~ '(^|/)\.\.(/|$)'
  )
);

create unique index commercial_configurations_image_path_uidx
  on public.commercial_configurations (image_path)
  where image_path is not null;

create policy commercial_catalog_images_select_active_users
on storage.objects
for select
to authenticated
using (
  bucket_id = 'commercial-catalog-images'
  and (select private.is_active_profile())
);

do $$
declare
  v_affected_rows integer;
begin
  update public.commercial_configurations as configuration
  set image_path = expected.image_path
  from pg_temp.expected_commercial_catalog_images as expected
  where configuration.id = expected.configuration_id
    and expected.image_path is not null;

  get diagnostics v_affected_rows = row_count;

  if v_affected_rows <> 76 then
    raise exception using
      errcode = '23514',
      message =
        'Commercial catalog image migration aborted: exactly 76 configurations were not updated.';
  end if;
end;
$$;

do $$
begin
  if (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'commercial_configurations'
      and column_name = 'image_path'
      and data_type = 'text'
      and is_nullable = 'YES'
  ) <> 1
    or (
      select count(*)
      from pg_constraint
      where conrelid = 'public.commercial_configurations'::regclass
        and conname = 'commercial_configurations_image_path_check'
        and contype = 'c'
        and convalidated
    ) <> 1
    or (
      select count(*)
      from pg_index
      where indexrelid =
          'public.commercial_configurations_image_path_uidx'::regclass
        and indrelid = 'public.commercial_configurations'::regclass
        and indisunique
        and indpred is not null
        and pg_get_expr(
          indpred,
          'public.commercial_configurations'::regclass
        ) = '(image_path IS NOT NULL)'
    ) <> 1
    or col_description(
    'public.commercial_configurations'::regclass,
    (
      select ordinal_position
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'commercial_configurations'
        and column_name = 'image_path'
    )
  ) is distinct from
    'Object path in the private commercial-catalog-images Storage bucket for this physical commercial configuration.' then
    raise exception using
      errcode = '23514',
      message =
        'Commercial catalog image migration aborted: image_path schema failed post-validation.';
  end if;

  if (
    select count(*)
    from storage.buckets
    where id = 'commercial-catalog-images'
      and name = 'commercial-catalog-images'
      and public is false
      and file_size_limit = 5242880
      and allowed_mime_types = array['image/jpeg']::text[]
  ) <> 1
    or (
    select count(*)
    from storage.buckets
    where id = 'commercial-catalog-images'
       or name = 'commercial-catalog-images'
  ) <> 1
    or exists (
      select 1
      from storage.objects
      where bucket_id = 'commercial-catalog-images'
    ) then
    raise exception using
      errcode = '23514',
      message =
        'Commercial catalog image migration aborted: private bucket failed post-validation.';
  end if;

  if (
    select relrowsecurity
    from pg_class
    where oid = 'storage.objects'::regclass
  ) is distinct from true
    or (
    select count(*)
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
  ) <> 1
    or (
      select count(*)
      from pg_policies
      where schemaname = 'storage'
        and tablename = 'objects'
        and policyname =
          'commercial_catalog_images_select_active_users'
        and permissive = 'PERMISSIVE'
        and roles = array['authenticated']::name[]
        and cmd = 'SELECT'
        and with_check is null
        and qual like '%commercial-catalog-images%'
        and qual like '%private.is_active_profile()%'
    ) <> 1
    or exists (
      select 1
      from pg_policies
      where schemaname = 'storage'
        and tablename = 'objects'
        and (
          cmd <> 'SELECT'
          or roles && array['anon', 'public']::name[]
        )
    ) then
    raise exception using
      errcode = '23514',
      message =
        'Commercial catalog image migration aborted: Storage RLS failed post-validation.';
  end if;

  if (
    select count(*)
    from public.commercial_configurations
    where is_active
      and image_path is not null
  ) <> 76
    or (
      select count(*)
      from public.commercial_configurations
      where is_active
        and image_path is null
    ) <> 1
    or exists (
      select 1
      from public.commercial_configurations
      where not is_active
        and image_path is not null
    )
    or not exists (
      select 1
      from public.commercial_configuration_codes as commercial_code
      join public.commercial_configurations as configuration
        on configuration.id = commercial_code.configuration_id
      where commercial_code.code = '11E'
        and commercial_code.is_active
        and configuration.id =
          '4129d2bc-0a12-43d4-88f1-ef8e0292b635'::uuid
        and configuration.is_active
        and configuration.image_path is null
    )
    or exists (
      select 1
      from pg_temp.expected_commercial_catalog_images as expected
      left join public.commercial_configurations as configuration
        on configuration.id = expected.configuration_id
      left join lateral (
        select
          array_agg(
            commercial_code.code
            order by commercial_code.code collate "C"
          ) as aliases,
          bool_and(commercial_code.is_active) as all_active
        from public.commercial_configuration_codes as commercial_code
        where commercial_code.configuration_id = expected.configuration_id
      ) as actual on true
      where configuration.id is null
        or not configuration.is_active
        or configuration.image_path is distinct from expected.image_path
        or actual.aliases is distinct from expected.aliases
        or actual.all_active is distinct from true
    ) then
    raise exception using
      errcode = '23514',
      message =
        'Commercial catalog image migration aborted: manifest mapping failed post-validation.';
  end if;

  if exists (
    select 1
    from (
      values
        (
          '9A',
          '7809b0b5-a697-4f30-8808-7475b420603d'::uuid,
          'catalog/9A.jpg'
        ),
        (
          '9D',
          '62316df6-e0ca-4e9c-8f55-73811596b74b'::uuid,
          'catalog/9D.jpg'
        ),
        (
          '5Z',
          'b6aebf6f-2dd4-4288-ab56-c54e3c96adb2'::uuid,
          'catalog/5Z.jpg'
        ),
        (
          '6P',
          '0837fec5-6a54-4c84-a6e6-e142b34a9e22'::uuid,
          'catalog/6P.jpg'
        ),
        (
          '6R',
          '2a2f5d77-bfe2-42cb-9942-cba87625b28d'::uuid,
          'catalog/6R.jpg'
        ),
        (
          '1B',
          'ffdbc822-37ab-4018-a476-b7e6e1f0e596'::uuid,
          'catalog/1B.jpg'
        ),
        (
          '1D',
          'ffdbc822-37ab-4018-a476-b7e6e1f0e596'::uuid,
          'catalog/1B.jpg'
        ),
        (
          '6C',
          'adbd0b6f-58ab-4996-84d6-59bc998c37d8'::uuid,
          'catalog/6C.jpg'
        ),
        (
          '6I',
          'adbd0b6f-58ab-4996-84d6-59bc998c37d8'::uuid,
          'catalog/6C.jpg'
        ),
        (
          '6E',
          '0464114f-853b-40bc-bbf3-0abbcc03ae1f'::uuid,
          'catalog/6F.jpg'
        ),
        (
          '6F',
          '0464114f-853b-40bc-bbf3-0abbcc03ae1f'::uuid,
          'catalog/6F.jpg'
        )
    ) as expected (code, configuration_id, image_path)
    left join public.commercial_configuration_codes as commercial_code
      on commercial_code.code = expected.code
    left join public.commercial_configurations as configuration
      on configuration.id = commercial_code.configuration_id
    where commercial_code.id is null
      or not commercial_code.is_active
      or commercial_code.configuration_id
        is distinct from expected.configuration_id
      or configuration.id is null
      or not configuration.is_active
      or configuration.image_path is distinct from expected.image_path
  ) then
    raise exception using
      errcode = '23514',
      message =
        'Commercial catalog image migration aborted: corrected or shared-alias image paths failed post-validation.';
  end if;

  if exists (select 1 from public.movement_batches)
    or exists (select 1 from public.inbound_batch_lines)
    or exists (select 1 from public.outbound_batch_lines)
    or exists (select 1 from public.stock_movements)
    or exists (select 1 from public.configuration_stock_movements)
    or exists (select 1 from public.assembly_operations)
    or exists (select 1 from public.stock_balances)
    or exists (select 1 from public.configuration_stock_balances) then
    raise exception using
      errcode = '23514',
      message =
        'Commercial catalog image migration aborted: operational state changed during the migration.';
  end if;
end;
$$;

commit;
