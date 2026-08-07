[CmdletBinding()]
param(
  [string]$DatabaseHost = "127.0.0.1",
  [string]$BaselineDirectory,
  [string]$WorkspacePath,
  [switch]$StopAfterValidation
)

$ErrorActionPreference = "Stop"
$env:npm_config_loglevel = "silent"

function Invoke-CheckedCommand {
  param(
    [Parameter(Mandatory = $true)]
    [scriptblock]$Command,
    [Parameter(Mandatory = $true)]
    [string]$FailureMessage,
    [switch]$SuppressOutput
  )

  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $commandOutput = & $Command 2>&1
    $commandExitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }

  if ($commandExitCode -ne 0) {
    $safeOutput = $commandOutput | Where-Object {
      $_ -notmatch "(?i)(password|secret|token|jwt|key|postgresql://)"
    }
    throw "$FailureMessage`n$($safeOutput -join [Environment]::NewLine)"
  }

  if (-not $SuppressOutput) {
    $commandOutput
  }
}

function Stop-DisposableStack {
  param([Parameter(Mandatory = $true)][string]$Workdir)

  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & npx --no-install supabase stop --no-backup --workdir $Workdir 2>&1 |
      Where-Object { $_ -notmatch "(?i)(password|secret|token|jwt|key|url)" } |
      Out-Null
  }
  finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
}

$repositoryRoot = [System.IO.Path]::GetFullPath(
  (Join-Path $PSScriptRoot "..")
)
$temporaryRoot = [System.IO.Path]::GetFullPath($env:TEMP)

if (-not $BaselineDirectory) {
  $BaselineDirectory = Join-Path $repositoryRoot "supabase\baseline"
}
$BaselineDirectory = [System.IO.Path]::GetFullPath($BaselineDirectory)

if (-not $WorkspacePath) {
  $WorkspacePath = Join-Path $temporaryRoot "negocios-k-current-state-baseline"
}
$WorkspacePath = [System.IO.Path]::GetFullPath($WorkspacePath)

if (-not $WorkspacePath.StartsWith(
  $temporaryRoot,
  [System.StringComparison]::OrdinalIgnoreCase
)) {
  throw "The disposable workspace must be located under the operating-system temporary directory."
}

if ($DatabaseHost -notin @("127.0.0.1", "localhost", "::1")) {
  throw "Remote database hosts are refused. Baseline restoration is local-only."
}

$requiredFiles = @(
  "current_schema.sql",
  "reference_data.sql",
  "baseline_manifest.json"
)
foreach ($filename in $requiredFiles) {
  if (-not (Test-Path -LiteralPath (Join-Path $BaselineDirectory $filename))) {
    throw "Required baseline file is missing: $filename"
  }
}

$manifestPath = Join-Path $BaselineDirectory "baseline_manifest.json"
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$schemaPath = Join-Path $BaselineDirectory "current_schema.sql"
$referenceDataPath = Join-Path $BaselineDirectory "reference_data.sql"

$schemaHash = (Get-FileHash -LiteralPath $schemaPath -Algorithm SHA256).Hash.ToLowerInvariant()
$referenceDataHash = (Get-FileHash -LiteralPath $referenceDataPath -Algorithm SHA256).Hash.ToLowerInvariant()

if ($schemaHash -ne $manifest.files.'current_schema.sql'.sha256) {
  throw "current_schema.sql checksum differs from the manifest."
}
if ($referenceDataHash -ne $manifest.files.'reference_data.sql'.sha256) {
  throw "reference_data.sql checksum differs from the manifest."
}

$referenceData = Get-Content -LiteralPath $referenceDataPath -Raw
$forbiddenReferencePatterns = @(
  "(?i)session_replication_role",
  "(?i)auth\.users",
  "(?i)storage\.objects",
  "(?i)public\.profiles",
  "(?i)supplier_order",
  "(?i)movement_batches",
  "(?i)stock_movements",
  "(?i)stock_balances",
  "(?i)postgres(?:ql)?://",
  "(?i)@[a-z0-9.-]+\.[a-z]{2,}"
)
foreach ($pattern in $forbiddenReferencePatterns) {
  if ($referenceData -match $pattern) {
    throw "Reference data contains forbidden content matching: $pattern"
  }
}

Write-Host "ALVO CONFIRMADO: SUPABASE LOCAL"

$dockerBin = Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\resources\bin"
if (Test-Path -LiteralPath $dockerBin) {
  $env:Path = "$dockerBin;$env:Path"
}

Invoke-CheckedCommand -SuppressOutput `
  -FailureMessage "Docker Engine is not available." `
  -Command { docker version --format "{{.Server.Version}}" }

$projectId = "nk_current_state_baseline"
$containerName = "supabase_db_$projectId"
$workspaceConfig = Join-Path $WorkspacePath "supabase\config.toml"
$workspaceMigrations = Join-Path $WorkspacePath "supabase\migrations"
$started = $false

try {
  if (Test-Path -LiteralPath $workspaceConfig) {
    Stop-DisposableStack -Workdir $WorkspacePath
  }

  if (Test-Path -LiteralPath $WorkspacePath) {
    $resolvedWorkspace = [System.IO.Path]::GetFullPath($WorkspacePath)
    if (-not $resolvedWorkspace.StartsWith(
      $temporaryRoot,
      [System.StringComparison]::OrdinalIgnoreCase
    )) {
      throw "Refusing to remove a workspace outside the temporary directory."
    }
    Remove-Item -LiteralPath $resolvedWorkspace -Recurse -Force
  }

  New-Item -ItemType Directory -Path $workspaceMigrations -Force | Out-Null
  $sourceConfig = Get-Content -LiteralPath (
    Join-Path $repositoryRoot "supabase\config.toml"
  ) -Raw
  $localConfig = $sourceConfig -replace '(?m)^project_id\s*=\s*"[^"]+"',
    "project_id = `"$projectId`""
  [System.IO.File]::WriteAllText(
    $workspaceConfig,
    $localConfig,
    [System.Text.UTF8Encoding]::new($false)
  )

  Invoke-CheckedCommand -SuppressOutput `
    -FailureMessage "Could not start the disposable Supabase Local stack." `
    -Command {
      npx --no-install supabase start `
        -x studio,imgproxy,edge-runtime,logflare,vector,supavisor `
        --workdir $WorkspacePath
    }
  $started = $true

  Invoke-CheckedCommand -SuppressOutput `
    -FailureMessage "Could not copy current_schema.sql into the local database container." `
    -Command { docker cp $schemaPath "${containerName}:/tmp/current_schema.sql" }
  Invoke-CheckedCommand -SuppressOutput `
    -FailureMessage "Applying current_schema.sql failed." `
    -Command {
      docker exec $containerName psql -X -v ON_ERROR_STOP=1 `
        -U postgres -d postgres -f /tmp/current_schema.sql
    }

  Invoke-CheckedCommand -SuppressOutput `
    -FailureMessage "Could not copy reference_data.sql into the local database container." `
    -Command { docker cp $referenceDataPath "${containerName}:/tmp/reference_data.sql" }
  Invoke-CheckedCommand -SuppressOutput `
    -FailureMessage "Applying reference_data.sql failed." `
    -Command {
      docker exec $containerName psql -X -v ON_ERROR_STOP=1 `
        -U postgres -d postgres -f /tmp/reference_data.sql
    }

  $cutoff = [string]$manifest.historical_cutoff_migration
  $historicalMigrations = Get-ChildItem -LiteralPath (
    Join-Path $repositoryRoot "supabase\migrations"
  ) -File | Where-Object {
    $_.BaseName.Substring(0, 14) -le $cutoff
  } | Sort-Object Name

  foreach ($migration in $historicalMigrations) {
    Copy-Item -LiteralPath $migration.FullName -Destination $workspaceMigrations
  }

  $versions = @($historicalMigrations | ForEach-Object {
    $_.BaseName.Substring(0, 14)
  })
  if ($versions.Count -eq 0) {
    throw "No historical migrations were found at or before the manifest cutoff."
  }

  $repairArguments = @(
    "--no-install", "supabase", "migration", "repair",
    "--local", "--status", "applied", "--workdir", $WorkspacePath
  ) + $versions
  Invoke-CheckedCommand -SuppressOutput `
    -FailureMessage "Could not register the local historical migration cutoff." `
    -Command { & npx @repairArguments }

  $migrationHistory = Invoke-CheckedCommand `
    -FailureMessage "Could not validate the local migration history." `
    -Command {
      docker exec $containerName psql -X -Atq -U postgres -d postgres `
        -c "select count(*)::text || '|' || max(version) from supabase_migrations.schema_migrations;"
    }
  $expectedMigrationHistory = "$($versions.Count)|$cutoff"
  if ([string]($migrationHistory | Select-Object -Last 1) -ne $expectedMigrationHistory) {
    throw "Local migration history does not match the manifest cutoff."
  }

  $futureMigrations = @(Get-ChildItem -LiteralPath (
    Join-Path $repositoryRoot "supabase\migrations"
  ) -File | Where-Object {
    $_.BaseName.Substring(0, 14) -gt $cutoff
  })
  foreach ($migration in $futureMigrations) {
    Copy-Item -LiteralPath $migration.FullName -Destination $workspaceMigrations
  }
  if ($futureMigrations.Count -gt 0) {
    Invoke-CheckedCommand -SuppressOutput `
      -FailureMessage "A future local migration failed after the baseline." `
      -Command {
        npx --no-install supabase migration up --local --workdir $WorkspacePath
      }
  }

  foreach ($entry in $manifest.reference_tables) {
    if ($entry.table -notmatch '^public\.[a-z_]+$') {
      continue
    }
    $actualCount = Invoke-CheckedCommand `
      -FailureMessage "Could not validate $($entry.table)." `
      -Command {
        docker exec $containerName psql -X -Atq -U postgres -d postgres `
          -c "select count(*) from $($entry.table);"
      }
    if ([int64]($actualCount | Select-Object -Last 1) -ne [int64]$entry.row_count) {
      throw "Reference count differs for $($entry.table)."
    }
  }

  $validationSql = @"
do `$baseline_validation`$
begin
  if exists (select 1 from public.profiles)
    or exists (select 1 from public.supplier_orders)
    or exists (select 1 from public.supplier_order_items)
    or exists (select 1 from public.supplier_order_events)
    or exists (select 1 from public.supplier_order_stock_entries)
    or exists (select 1 from public.supplier_order_stock_entry_lines)
    or exists (select 1 from public.movement_batches)
    or exists (select 1 from public.stock_balances)
    or exists (select 1 from public.configuration_stock_balances)
    or exists (select 1 from public.stock_movements)
    or exists (select 1 from public.configuration_stock_movements)
    or exists (select 1 from public.assembly_operations)
    or exists (select 1 from auth.users)
    or exists (select 1 from storage.objects) then
    raise exception 'Baseline contains excluded personal or operational data.';
  end if;

  if (select count(*) from storage.buckets where id = 'commercial-catalog-images') <> 1 then
    raise exception 'Baseline bucket metadata diverged.';
  end if;

  if exists (
      select 1 from pg_catalog.pg_constraint
      where connamespace in ('public'::regnamespace, 'private'::regnamespace)
        and not convalidated
    ) then
    raise exception 'Baseline contains an unvalidated constraint.';
  end if;

  if not exists (
      select 1 from pg_catalog.pg_policies
      where schemaname = 'storage'
        and tablename = 'objects'
        and policyname = 'commercial_catalog_images_select_active_users'
    ) then
    raise exception 'Baseline Storage policy is missing.';
  end if;

  if exists (
      select 1
      from pg_catalog.pg_class as relation
      join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
        and relation.relkind = 'r'
        and not relation.relrowsecurity
    ) then
    raise exception 'A public application table does not have RLS enabled.';
  end if;

  if to_regprocedure('public.stock_inbound_lines(jsonb,uuid,text)') is null
    or to_regprocedure('public.stock_outbound_items(jsonb,uuid,text)') is null
    or to_regprocedure('public.create_supplier_order_stock_entry(uuid,jsonb,text,timestamptz,uuid)') is null then
    raise exception 'A required public RPC is missing.';
  end if;
end;
`$baseline_validation`$;
"@
  Invoke-CheckedCommand -SuppressOutput `
    -FailureMessage "Baseline post-validation failed." `
    -Command {
      docker exec $containerName psql -X -v ON_ERROR_STOP=1 `
        -U postgres -d postgres -c $validationSql
    }

  $schemaSignature = Invoke-CheckedCommand `
    -FailureMessage "Could not calculate the local schema signature." `
    -Command {
      docker exec $containerName psql -X -Atq -U postgres -d postgres -c @"
select md5(string_agg(definition, E'\n' order by definition))
from (
  select 'C|' || pg_get_constraintdef(oid, true) as definition
  from pg_constraint
  where connamespace in ('public'::regnamespace, 'private'::regnamespace)
  union all
  select 'F|' || n.nspname || '.' || p.proname || '|' || pg_get_function_identity_arguments(p.oid) || '|' || pg_get_functiondef(p.oid)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private')
  union all
  select 'P|' || schemaname || '.' || tablename || '|' || policyname || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '')
  from pg_policies
  where schemaname in ('public', 'storage')
) contracts;
"@
    }

  $catalogSignature = Invoke-CheckedCommand `
    -FailureMessage "Could not calculate the local catalog signature." `
    -Command {
      docker exec $containerName psql -X -Atq -U postgres -d postgres -c @"
select md5(string_agg(row_value, E'\n' order by row_value))
from (
  select 'I|' || row_to_json(i)::text as row_value from public.items i
  union all select 'S|' || row_to_json(s)::text from public.servo_models s
  union all select 'K|' || row_to_json(k)::text from public.installation_kits k
  union all select 'R|' || row_to_json(r)::text from public.repair_kits r
  union all select 'L|' || row_to_json(l)::text from public.loose_parts l
  union all select 'C|' || row_to_json(c)::text from public.commercial_configurations c
  union all select 'A|' || row_to_json(a)::text from public.commercial_configuration_codes a
  union all select 'X|' || row_to_json(x)::text from public.servo_repair_compatibility x
) catalog;
"@
    }

  [pscustomobject]@{
    Target = "SUPABASE LOCAL"
    Workspace = $WorkspacePath
    Container = $containerName
    SchemaSignature = [string]($schemaSignature | Select-Object -Last 1)
    CatalogSignature = [string]($catalogSignature | Select-Object -Last 1)
    Cutoff = $cutoff
  }
}
catch {
  if ($started) {
    Stop-DisposableStack -Workdir $WorkspacePath
  }
  throw
}
finally {
  if ($StopAfterValidation -and $started) {
    Stop-DisposableStack -Workdir $WorkspacePath
  }
}
