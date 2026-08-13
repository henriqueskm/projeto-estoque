[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$temporaryRoot = [System.IO.Path]::GetFullPath($env:TEMP)
$testRoot = Join-Path $temporaryRoot ("nk-catalog-only-cli-" + [guid]::NewGuid().ToString("N"))
$dockerCommand = (Get-Command docker.exe -ErrorAction Stop).Source
$targetVersion = "20260812223114"
$targetMigration = Join-Path $repositoryRoot "supabase\migrations\${targetVersion}_add_catalog_only_loose_part_creation.sql"
$baselineDirectory = Join-Path $repositoryRoot "supabase\baseline"
$manifest = Get-Content -Raw -LiteralPath (Join-Path $baselineDirectory "baseline_manifest.json") | ConvertFrom-Json
$cutoff = [string]$manifest.historical_cutoff_migration
$projectId = "nk_catalog_only_cli"
$containerName = "supabase_db_$projectId"

$cliCandidates = @(Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA "npm-cache\_npx") -Directory -ErrorAction Stop | ForEach-Object {
  $packagePath = Join-Path $_.FullName "node_modules\supabase\package.json"
  $binaryPath = Join-Path $_.FullName "node_modules\@supabase\cli-windows-x64\bin\supabase.exe"
  if ((Test-Path -LiteralPath $packagePath) -and (Test-Path -LiteralPath $binaryPath)) {
    $package = Get-Content -Raw -LiteralPath $packagePath | ConvertFrom-Json
    [pscustomobject]@{ Version = [version]$package.version; Binary = $binaryPath }
  }
} | Sort-Object Version -Descending)
if ($cliCandidates.Count -eq 0) { throw "No cached Supabase CLI binary was found." }
$supabaseCommand = $cliCandidates[0].Binary
if ([string]$cliCandidates[0].Version -ne "2.112.0") {
  throw "Supabase CLI 2.112.0 is required; found $($cliCandidates[0].Version)."
}

function Write-Utf8File {
  param([string]$Path, [string]$Content)
  [System.IO.File]::WriteAllText($Path, $Content, [System.Text.UTF8Encoding]::new($false))
}

function Invoke-External {
  param([string]$FilePath, [string[]]$Arguments, [switch]$AllowFailure, [switch]$Quiet)
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = & $FilePath @Arguments 2>&1
    $exitCode = $LASTEXITCODE
  }
  finally { $ErrorActionPreference = $previousPreference }
  $text = ($output | ForEach-Object { [string]$_ }) -join [Environment]::NewLine
  if (-not $Quiet -and $text) { Write-Host $text }
  if ($exitCode -ne 0 -and -not $AllowFailure) {
    throw "Command failed ($exitCode): $FilePath $($Arguments -join ' ')`n$text"
  }
  [pscustomobject]@{ ExitCode = $exitCode; Output = $text }
}

function Invoke-Supabase {
  param([string[]]$Arguments, [switch]$AllowFailure, [switch]$Quiet)
  Invoke-External -FilePath $supabaseCommand -Arguments $Arguments -AllowFailure:$AllowFailure -Quiet:$Quiet
}

function Invoke-Docker {
  param([string[]]$Arguments, [switch]$AllowFailure, [switch]$Quiet)
  Invoke-External -FilePath $dockerCommand -Arguments $Arguments -AllowFailure:$AllowFailure -Quiet:$Quiet
}

function Invoke-Psql {
  param([string]$Sql, [switch]$AllowFailure)
  Invoke-Docker -Arguments @(
    "exec", $containerName, "psql", "-U", "postgres", "-d", "postgres",
    "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", $Sql
  ) -AllowFailure:$AllowFailure -Quiet
}

function Invoke-PsqlFile {
  param([string]$Path)
  $containerPath = "/tmp/" + [System.IO.Path]::GetFileName($Path)
  Invoke-Docker -Arguments @("cp", $Path, "${containerName}:$containerPath") -Quiet | Out-Null
  Invoke-Docker -Arguments @(
    "exec", $containerName, "psql", "-U", "postgres", "-d", "postgres",
    "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-f", $containerPath
  ) -Quiet | Out-Null
}

function Get-Scalar {
  param([string]$Sql)
  $result = Invoke-Psql -Sql $Sql
  (($result.Output -split "`r?`n") | Where-Object { $_ -ne "" } | Select-Object -Last 1)
}

function Assert-Equal {
  param($Actual, $Expected, [string]$Message)
  if ([string]$Actual -ne [string]$Expected) {
    throw "$Message Expected '$Expected', received '$Actual'."
  }
}

function Stop-Scenario {
  param([string]$Workspace)
  if ($Workspace -and (Test-Path -LiteralPath (Join-Path $Workspace "supabase\config.toml"))) {
    Invoke-Supabase -Arguments @("stop", "--no-backup", "--workdir", $Workspace) -AllowFailure -Quiet | Out-Null
  }
}

function New-Scenario {
  param([string]$Name)
  $workspace = Join-Path $testRoot $Name
  $workspaceMigrations = Join-Path $workspace "supabase\migrations"
  New-Item -ItemType Directory -Path $workspaceMigrations -Force | Out-Null

  $config = Get-Content -Raw -LiteralPath (Join-Path $repositoryRoot "supabase\config.toml")
  $config = $config -replace '(?m)^project_id\s*=\s*"[^"]+"', "project_id = `"$projectId`""
  Write-Utf8File -Path (Join-Path $workspace "supabase\config.toml") -Content $config

  Invoke-Supabase -Arguments @(
    "start", "-x",
    "gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor",
    "--workdir", $workspace
  ) -Quiet | Out-Null
  Invoke-PsqlFile -Path (Join-Path $baselineDirectory "current_schema.sql")
  Invoke-PsqlFile -Path (Join-Path $baselineDirectory "reference_data.sql")

  $historicalMigrations = @(Get-ChildItem -LiteralPath (Join-Path $repositoryRoot "supabase\migrations") -File | Where-Object {
    $_.BaseName -match '^\d{14}_' -and $_.BaseName.Substring(0, 14) -le $cutoff
  } | Sort-Object Name)
  foreach ($migration in $historicalMigrations) {
    Copy-Item -LiteralPath $migration.FullName -Destination $workspaceMigrations
  }
  $versions = @($historicalMigrations | ForEach-Object { $_.BaseName.Substring(0, 14) })
  Invoke-Supabase -Arguments (@(
    "migration", "repair", "--local", "--status", "applied", "--yes", "--workdir", $workspace
  ) + $versions) -Quiet | Out-Null

  $futureMigrations = @(Get-ChildItem -LiteralPath (Join-Path $repositoryRoot "supabase\migrations") -File | Where-Object {
    $_.BaseName -match '^\d{14}_' -and
      $_.BaseName.Substring(0, 14) -gt $cutoff -and
      $_.BaseName.Substring(0, 14) -lt $targetVersion
  } | Sort-Object Name)
  foreach ($migration in $futureMigrations) {
    Copy-Item -LiteralPath $migration.FullName -Destination $workspaceMigrations
  }
  if ($futureMigrations.Count -gt 0) {
    Invoke-Supabase -Arguments @("migration", "up", "--local", "--workdir", $workspace) -Quiet | Out-Null
  }

  Assert-Equal (Get-Scalar "select count(*) from supabase_migrations.schema_migrations where version = '$targetVersion'") "0" "$Name must start before the target migration."
  Copy-Item -LiteralPath $targetMigration -Destination $workspaceMigrations
  $workspace
}

function Assert-NoTargetArtifacts {
  Assert-Equal (Get-Scalar "select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'items' and column_name in ('created_by', 'created_by_name_snapshot')") "0" "Target columns must roll back."
  Assert-Equal (Get-Scalar "select count(*) from pg_indexes where schemaname = 'public' and indexname = 'items_created_by_idx'") "0" "Target index must roll back."
  Assert-Equal (Get-Scalar "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname = 'enforce_catalog_code_namespace'") "0" "Target function must roll back."
  Assert-Equal (Get-Scalar "select count(*) from pg_trigger where not tgisinternal and tgname like '%enforce_catalog_code_namespace'") "0" "Target triggers must roll back."
  Assert-Equal (Get-Scalar "select count(*) from supabase_migrations.schema_migrations where version = '$targetVersion'") "0" "Failed target migration must not enter history."
}

$cleanWorkspace = $null
$collisionWorkspace = $null
try {
  New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
  Write-Host "ALVO CONFIRMADO: SUPABASE LOCAL DESCARTAVEL / CLI 2.112.0"

  Invoke-Supabase -Arguments @("stop", "--no-backup", "--workdir", $repositoryRoot) -AllowFailure -Quiet | Out-Null

  $cleanWorkspace = New-Scenario -Name "clean"
  $push = Invoke-Supabase -Arguments @("db", "push", "--local", "--yes", "--workdir", $cleanWorkspace)
  if ($push.Output -notmatch $targetVersion) { throw "Clean db push did not report the target migration." }
  Assert-Equal (Get-Scalar "select count(*) from supabase_migrations.schema_migrations where version = '$targetVersion'") "1" "Target history must contain one row."
  Assert-Equal (Get-Scalar "select count(*) from pg_indexes where schemaname = 'public' and indexname = 'items_created_by_idx'") "1" "Authorship FK index must exist."
  Assert-Equal (Get-Scalar "select count(*) from pg_trigger where not tgisinternal and tgname like '%enforce_catalog_code_namespace'") "2" "Both namespace triggers must exist."
  $dryRun = Invoke-Supabase -Arguments @("db", "push", "--local", "--dry-run", "--workdir", $cleanWorkspace)
  if ($dryRun.Output -notmatch "up to date") { throw "Post-push dry-run did not report an up-to-date database." }
  Invoke-Supabase -Arguments @("migration", "list", "--local", "--workdir", $cleanWorkspace) | Out-Null
  Write-Host "CLI_CLEAN_APPLY_AND_EMPTY_DRY_RUN_VERIFIED"
  Stop-Scenario -Workspace $cleanWorkspace
  $cleanWorkspace = $null

  $collisionWorkspace = New-Scenario -Name "collision"
  $configurationId = Get-Scalar "select id from public.commercial_configurations order by id limit 1"
  Invoke-Psql -Sql @"
insert into public.items (code, description, item_type, minimum_stock, is_active)
values ('C3A-CLI-COLLISION', 'CLI COLLISION ITEM', 'LOOSE_PART', 0, true);
insert into public.loose_parts (item_id)
select id from public.items where code = 'C3A-CLI-COLLISION';
insert into public.commercial_configuration_codes (configuration_id, code)
values ('$configurationId', 'C3A-CLI-COLLISION');
"@ | Out-Null
  $failedPush = Invoke-Supabase -Arguments @("db", "push", "--local", "--yes", "--workdir", $collisionWorkspace) -AllowFailure
  if ($failedPush.ExitCode -eq 0) { throw "Incompatible namespace collision unexpectedly applied." }
  if ($failedPush.Output -notmatch "exact code already exists in both") { throw "Collision failure was not explicit." }
  Assert-NoTargetArtifacts
  Write-Host "CLI_INCOMPATIBLE_PREFLIGHT_ROLLBACK_VERIFIED"
}
finally {
  Stop-Scenario -Workspace $cleanWorkspace
  Stop-Scenario -Workspace $collisionWorkspace
  if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
}

Write-Host "CATALOG_ONLY_CLI_LOCAL_TESTS_PASSED"
