[CmdletBinding()]
param(
  [string]$ContainerName = "supabase_db_nk_pr_68_reset",
  [Parameter(Mandatory = $true)][string]$StorageSchemaSourceContainer
)

$ErrorActionPreference = "Stop"
$OutputEncoding = [Text.UTF8Encoding]::new($false)
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
if ($ContainerName -notmatch '^supabase_db_nk_pr_68_reset[a-z0-9_]*$' -or
    $StorageSchemaSourceContainer -notmatch '^supabase_db_[a-z0-9_-]+$' -or
    $StorageSchemaSourceContainer -eq $ContainerName) {
  throw "Only an exclusive disposable local target and separate local schema source are accepted."
}
$labels = (& docker inspect -f '{{json .Config.Labels}}' $ContainerName) | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $labels.'nk.disposable' -ne "deployment-reset-pr-68") {
  throw "The local target must carry the deployment-reset-pr-68 disposable label."
}
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  # The image's temporary init server accepts socket connections before its
  # init scripts finish. TCP readiness identifies the final server instead.
  & docker exec $ContainerName pg_isready -h 127.0.0.1 -U postgres -q 2>$null
  if ($LASTEXITCODE -eq 0) { break }
  Start-Sleep -Milliseconds 500
}
if ($LASTEXITCODE -ne 0) { throw "The disposable database did not become ready." }

function Invoke-LocalBootstrapSql {
  param([string]$Sql, [string]$User = "postgres")
  $result = $Sql | docker exec -i $ContainerName psql -U $User -d postgres -X -qAt -v ON_ERROR_STOP=1 -f - 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Local bootstrap failed: $($result | Select-Object -Last 3)" }
}

$empty = & docker exec $ContainerName psql -U postgres -d postgres -X -qAt -c "select to_regclass('public.items') is null;"
if ($LASTEXITCODE -ne 0 -or $empty -ne "t") { throw "Bootstrap requires a new, empty disposable database." }

# Standard Supabase Storage schema only, from another local container; no rows,
# credentials or Auth exports. The project baseline is the repository's approved
# bootstrap, then every migration after its cutoff is applied unchanged locally.
$storageSchema = & docker exec $StorageSchemaSourceContainer pg_dump -U postgres -d postgres --schema-only --schema=storage --section=pre-data --no-owner 2>&1
if ($LASTEXITCODE -ne 0) { throw "Local Supabase Storage schema source unavailable." }
$storageSql = (($storageSchema | ForEach-Object { $_.ToString() }) -join "`n") -replace '(?m)^CREATE SCHEMA storage;', ''
Invoke-LocalBootstrapSql -Sql $storageSql -User "supabase_admin"
Invoke-LocalBootstrapSql -Sql (Get-Content -Encoding UTF8 -Raw (Join-Path $root "supabase\baseline\current_schema.sql")) -User "supabase_admin"
Invoke-LocalBootstrapSql -Sql (Get-Content -Encoding UTF8 -Raw (Join-Path $root "supabase\baseline\reference_data.sql")) -User "supabase_admin"
$storagePost = & docker exec $StorageSchemaSourceContainer pg_dump -U postgres -d postgres --schema-only --schema=storage --section=post-data --no-owner 2>&1
if ($LASTEXITCODE -ne 0) { throw "Local Storage constraint fixture source unavailable." }
$postSql = ($storagePost | ForEach-Object { $_.ToString() }) -join "`n"
# These two application policies are already in the approved project baseline.
$postSql = $postSql -replace '(?ms)^CREATE POLICY commercial_catalog_images_[^;]+;',''
Invoke-LocalBootstrapSql -Sql $postSql -User "supabase_admin"

$manifest = Get-Content -Encoding UTF8 -Raw (Join-Path $root "supabase\baseline\baseline_manifest.json") | ConvertFrom-Json
$migrations = @(Get-ChildItem (Join-Path $root "supabase\migrations") -File | Sort-Object Name)
foreach ($migration in $migrations) {
  if ($migration.BaseName.Substring(0, 14) -gt $manifest.historical_cutoff_migration) {
    Invoke-LocalBootstrapSql -Sql (Get-Content -Encoding UTF8 -Raw $migration.FullName)
  }
}
Invoke-LocalBootstrapSql -Sql "create schema supabase_migrations; create table supabase_migrations.schema_migrations (version text primary key, statements text[], name text);"
foreach ($migration in $migrations) {
  $version = $migration.BaseName.Substring(0, 14)
  $name = $migration.BaseName.Substring(15)
  Invoke-LocalBootstrapSql -Sql "insert into supabase_migrations.schema_migrations(version,name) values ('$version','$name');"
}

Invoke-LocalBootstrapSql -Sql @'
insert into auth.users (id,email,raw_user_meta_data) values
 ('10000000-0000-0000-0000-000000000001','reset-internal@example.invalid','{"name":"Reset Test Internal"}'),
 ('10000000-0000-0000-0000-000000000002','reset-safisa@example.invalid','{"name":"Reset Test Safisa"}'),
 ('10000000-0000-0000-0000-000000000003','reset-observer@example.invalid','{"name":"Reset Test Observer"}') on conflict(id) do nothing;
-- Auth triggers are deliberately outside the approved application baseline.
-- Provision only these synthetic profiles explicitly for this disposable test.
insert into public.profiles(id,name,is_active) values
 ('10000000-0000-0000-0000-000000000001','Reset Test Internal',true),
 ('10000000-0000-0000-0000-000000000002','Reset Test Safisa',false),
 ('10000000-0000-0000-0000-000000000003','Reset Test Observer',true);
update public.profiles set is_active = (id <> '10000000-0000-0000-0000-000000000002');
insert into public.safisa_portal_members (user_id,is_active,created_by,created_by_name_snapshot,activated_at,activated_by,activated_by_name_snapshot)
 values ('10000000-0000-0000-0000-000000000002',true,'10000000-0000-0000-0000-000000000001','Reset Test Internal',now(),'10000000-0000-0000-0000-000000000001','Reset Test Internal');
insert into public.items(id,code,description,item_type) values
 ('313a920b-5b6c-4132-b342-3fdd69fc4aa1','067','MANCAL DO MOTOR DE PARTIDA','LOOSE_PART'),
 ('523fe146-cde0-4db8-a609-33002c15a3aa','091','TAMPA INTERMEDIARIA 025 - 028','LOOSE_PART'),
 ('815db224-67b7-41a5-9fbb-f3fb38514972','091/VF','TAMPA INTERMEDIARIA VF - 024,5','LOOSE_PART'),
 ('e0c7fc9e-56bb-45cd-a60a-fc424b8c6127','SUB071','EMPURRADOR C/ ADAPTADOR','LOOSE_PART');
insert into public.loose_parts(item_id) select id from public.items where item_type='LOOSE_PART' and code <> '110';
'@

Invoke-LocalBootstrapSql -Sql @'
insert into storage.objects(id,bucket_id,name)
 select gen_random_uuid(),'commercial-catalog-images',image_path
 from public.commercial_configurations where image_path is not null;
'@ -User "supabase_admin"
Write-Host "Disposable current-schema fixture ready: 38 migrations, 106 items, 5 loose parts, 295 applications; synthetic Auth/Storage rows only."
