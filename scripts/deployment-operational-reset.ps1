[CmdletBinding(DefaultParameterSetName = "LocalContainer")]
param(
  [ValidateSet("DryRun", "Execute")]
  [string]$Mode = "DryRun",

  [Parameter(Mandatory = $true, ParameterSetName = "LocalContainer")]
  [string]$ContainerName,

  [Parameter(Mandatory = $true, ParameterSetName = "LocalContainer")]
  [string]$CloneOfProjectRef,

  [Parameter(Mandatory = $true, ParameterSetName = "DatabaseUrl")]
  [string]$DatabaseUrlEnvironmentVariable,

  [ValidateSet("PRESERVE", "DISABLE", "DELETE")]
  [string]$PushSubscriptions = "PRESERVE",

  [string]$Confirmation,
  [switch]$BackupValidated,
  [switch]$OperationsPaused,
  [switch]$AllowRemoteExecution,
  [switch]$LocalTest,
  [switch]$ForceValidationFailure,
  [string]$ContractPath
)

$ErrorActionPreference = "Stop"
$confirmationPhrase = "CONFIRMAR RESET DE IMPLANTACAO ESTOQUENK"
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$defaultContractPath = Join-Path $PSScriptRoot "deployment-reset\contract.json"
$dryRunSqlPath = Join-Path $PSScriptRoot "deployment-reset\dry-run.sql"
$executeSqlPath = Join-Path $PSScriptRoot "deployment-reset\execute.sql"
$requiredRelations = @(
  "private.configuration_operation_requests",
  "private.stock_adjustment_requests",
  "public.assembly_operations",
  "public.commercial_configuration_codes",
  "public.commercial_configurations",
  "public.configuration_minimum_stock_changes",
  "public.configuration_stock_balances",
  "public.configuration_stock_movements",
  "public.inbound_batch_lines",
  "public.installation_kits",
  "public.items",
  "public.loose_parts",
  "public.minimum_stock_changes",
  "public.movement_batches",
  "public.outbound_batch_lines",
  "public.profiles",
  "public.push_notification_events",
  "public.push_subscriptions",
  "public.repair_kits",
  "public.safisa_order_authorizations",
  "public.safisa_portal_events",
  "public.safisa_portal_members",
  "public.servo_models",
  "public.servo_repair_compatibility",
  "public.stock_balances",
  "public.stock_movements",
  "public.supplier_order_events",
  "public.supplier_order_items",
  "public.supplier_order_stock_entries",
  "public.supplier_order_stock_entry_lines",
  "public.supplier_orders"
)

function Get-Md5 {
  param([Parameter(Mandatory = $true)][string]$Value)
  $algorithm = [System.Security.Cryptography.MD5]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value)
    return ([System.BitConverter]::ToString($algorithm.ComputeHash($bytes))).Replace("-", "").ToLowerInvariant()
  }
  finally {
    $algorithm.Dispose()
  }
}

function Invoke-CheckedGit {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)
  $result = & git -C $repositoryRoot @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Git guard failed."
  }
  if ($null -eq $result) {
    return ""
  }
  return (($result | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine).Trim()
}

function Add-PsqlVariable {
  param(
    [Parameter(Mandatory = $true)][System.Collections.Generic.List[string]]$Arguments,
    [Parameter(Mandatory = $true)][string]$Name,
    [AllowEmptyString()][string]$Value
  )
  $Arguments.Add("-v")
  $Arguments.Add("$Name=$Value")
}

if (-not $ContractPath) {
  $ContractPath = $defaultContractPath
}
$resolvedContractPath = [System.IO.Path]::GetFullPath($ContractPath)
$resolvedDefaultContractPath = [System.IO.Path]::GetFullPath($defaultContractPath)
if (-not (Test-Path -LiteralPath $resolvedContractPath)) {
  throw "Reset contract not found."
}
$contract = Get-Content -LiteralPath $resolvedContractPath -Raw | ConvertFrom-Json

if (
  $contract.projectRef -notmatch '^[a-z0-9]{20}$' -or
  $contract.sourceMainSha -notmatch '^[0-9a-f]{40}$' -or
  $contract.schemaFingerprint -notmatch '^[0-9a-f]{32}$' -or
  $contract.catalogFingerprint -notmatch '^[0-9a-f]{32}$' -or
  $contract.migrationFingerprint -notmatch '^[0-9a-f]{32}$'
) {
  throw "Reset contract is incomplete or malformed."
}

$null = Invoke-CheckedGit -Arguments @("cat-file", "-e", "$($contract.sourceMainSha)^{commit}")
& git -C $repositoryRoot merge-base --is-ancestor $contract.sourceMainSha HEAD
if ($LASTEXITCODE -ne 0) {
  throw "The registered main SHA is not an ancestor of the current checkout."
}

$migrationFiles = @(Get-ChildItem -LiteralPath (Join-Path $repositoryRoot "supabase\migrations") -File | Sort-Object Name)
$localMigrationRows = $migrationFiles | ForEach-Object {
  "$($_.BaseName.Substring(0, 14))|$($_.BaseName.Substring(15))"
}
$localMigrationFingerprint = Get-Md5 -Value ($localMigrationRows -join "`n")
if (
  $migrationFiles.Count -ne [int]$contract.migrationCount -or
  $migrationFiles[-1].BaseName.Substring(0, 14) -ne [string]$contract.latestMigration -or
  $localMigrationFingerprint -ne [string]$contract.migrationFingerprint
) {
  throw "Local migration files do not match the registered reset contract."
}

$identifiedProjectRef = $null
$targetIsRemote = $PSCmdlet.ParameterSetName -eq "DatabaseUrl"
$databaseUri = $null
if ($targetIsRemote) {
  if ([string]::IsNullOrWhiteSpace($DatabaseUrlEnvironmentVariable)) {
    throw "A database URL environment-variable name is required."
  }
  $databaseUrl = [Environment]::GetEnvironmentVariable($DatabaseUrlEnvironmentVariable)
  if ([string]::IsNullOrWhiteSpace($databaseUrl)) {
    throw "The database URL environment variable is empty."
  }
  try {
    $databaseUri = [System.Uri]$databaseUrl
  }
  catch {
    throw "The database URL is invalid."
  }
  $databaseUser = [System.Uri]::UnescapeDataString(($databaseUri.UserInfo -split ':', 2)[0])
  if ($databaseUri.Host -match '^db\.([a-z0-9]+)\.supabase\.co$') {
    $identifiedProjectRef = $Matches[1]
  }
  elseif ($databaseUser -match '^postgres\.([a-z0-9]+)$') {
    $identifiedProjectRef = $Matches[1]
  }
  else {
    throw "Could not derive a Supabase project ref from the actual database target."
  }
  if ($identifiedProjectRef -ne [string]$contract.projectRef) {
    throw "The actual database target does not match the contracted project ref."
  }
  if ($Mode -eq "Execute" -and -not $AllowRemoteExecution) {
    throw "Remote execution is blocked unless -AllowRemoteExecution is explicitly supplied."
  }
  if ($Mode -eq "Execute" -and $resolvedContractPath -ne $resolvedDefaultContractPath) {
    throw "Remote execution only accepts the versioned default contract."
  }
}
else {
  if ($ContainerName -notmatch '^supabase_db_[a-z0-9_-]+$') {
    throw "Local execution requires a disposable Supabase database container."
  }
  if ($CloneOfProjectRef -ne [string]$contract.projectRef) {
    throw "The local clone declaration does not match the contracted project ref."
  }
  $runningContainer = (& docker inspect -f '{{.State.Running}}' $ContainerName 2>$null | Select-Object -Last 1).Trim()
  if ($LASTEXITCODE -ne 0 -or $runningContainer -ne "true") {
    throw "The disposable local database container is unavailable."
  }
  $identifiedProjectRef = "local-clone:$CloneOfProjectRef"
  if ($AllowRemoteExecution) {
    throw "-AllowRemoteExecution is invalid for a local target."
  }
}

if ($ForceValidationFailure -and (-not $LocalTest -or $targetIsRemote)) {
  throw "Intentional validation failure is restricted to explicit local tests."
}

if ($Mode -eq "Execute") {
  if ($Confirmation -ne $confirmationPhrase) {
    throw "The exact deployment-reset confirmation phrase is required."
  }
  if (-not $BackupValidated) {
    throw "A validated backup acknowledgement is required."
  }
  if (-not $OperationsPaused) {
    throw "An application/worker maintenance acknowledgement is required."
  }
  if (-not $LocalTest) {
    $trackedStatus = & git -C $repositoryRoot status --porcelain=v1 --untracked-files=no
    if ($LASTEXITCODE -ne 0 -or $trackedStatus) {
      throw "A real execution requires a clean tracked worktree."
    }
  }
}

$sqlPath = if ($Mode -eq "DryRun") { $dryRunSqlPath } else { $executeSqlPath }
$sql = Get-Content -LiteralPath $sqlPath -Raw
$psqlArguments = [System.Collections.Generic.List[string]]::new()
foreach ($argument in @("-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-f", "-")) {
  $psqlArguments.Add($argument)
}

$dynamicIds = ($contract.dynamicItems | ForEach-Object { $_.id }) -join ","
$variables = [ordered]@{
  execution_mode = $Mode.ToUpperInvariant()
  confirm_phrase = $(if ($Mode -eq "Execute") { $Confirmation } else { "" })
  backup_ack = $(if ($BackupValidated) { "BACKUP_VALIDATED" } else { "NOT_ACKNOWLEDGED" })
  operations_paused_ack = $(if ($OperationsPaused) { "OPERATIONS_PAUSED" } else { "NOT_ACKNOWLEDGED" })
  force_validation_failure = $ForceValidationFailure.ToString().ToLowerInvariant()
  procedure_version = [string]$contract.procedureVersion
  identified_project_ref = $identifiedProjectRef
  expected_project_name = [string]$contract.projectName
  expected_database_name = [string]$contract.databaseName
  expected_source_main_sha = [string]$contract.sourceMainSha
  expected_migration_count = [string]$contract.migrationCount
  expected_latest_migration = [string]$contract.latestMigration
  expected_migration_fingerprint = [string]$contract.migrationFingerprint
  expected_schema_fingerprint = [string]$contract.schemaFingerprint
  expected_catalog_fingerprint = [string]$contract.catalogFingerprint
  expected_items = [string]$contract.catalogCounts.items
  expected_servo_models = [string]$contract.catalogCounts.servoModels
  expected_installation_kits = [string]$contract.catalogCounts.installationKits
  expected_repair_kits = [string]$contract.catalogCounts.repairKits
  expected_loose_parts = [string]$contract.catalogCounts.looseParts
  expected_configurations = [string]$contract.catalogCounts.configurations
  expected_commercial_codes = [string]$contract.catalogCounts.commercialCodes
  expected_compatibilities = [string]$contract.catalogCounts.compatibilities
  expected_auth_users = [string]$contract.authUsers
  expected_profiles = [string]$contract.profiles
  expected_memberships = [string]$contract.safisaMemberships
  expected_bucket_id = [string]$contract.bucketId
  expected_referenced_images = [string]$contract.referencedImages
  expected_storage_objects = [string]$contract.storageObjects
  expected_dynamic_item_ids = $dynamicIds
  required_relations = $requiredRelations -join ","
  push_subscription_action = $PushSubscriptions
}
foreach ($entry in $variables.GetEnumerator()) {
  Add-PsqlVariable -Arguments $psqlArguments -Name $entry.Key -Value $entry.Value
}

if ($targetIsRemote) {
  $oldPgValues = @{}
  foreach ($name in @("PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE", "PGSSLMODE")) {
    $oldPgValues[$name] = [Environment]::GetEnvironmentVariable($name)
  }
  try {
    $userInfo = $databaseUri.UserInfo -split ':', 2
    $env:PGHOST = $databaseUri.Host
    $env:PGPORT = if ($databaseUri.Port -gt 0) { [string]$databaseUri.Port } else { "5432" }
    $env:PGUSER = [System.Uri]::UnescapeDataString($userInfo[0])
    $env:PGPASSWORD = if ($userInfo.Count -gt 1) { [System.Uri]::UnescapeDataString($userInfo[1]) } else { "" }
    $env:PGDATABASE = $databaseUri.AbsolutePath.TrimStart('/')
    $env:PGSSLMODE = "require"
    $dockerArguments = @("run", "--rm", "-i", "-e", "PGHOST", "-e", "PGPORT", "-e", "PGUSER", "-e", "PGPASSWORD", "-e", "PGDATABASE", "-e", "PGSSLMODE", "postgres:17-alpine", "psql") + $psqlArguments
    $output = $sql | & docker @dockerArguments 2>&1
    $psqlExitCode = $LASTEXITCODE
  }
  finally {
    foreach ($name in $oldPgValues.Keys) {
      [Environment]::SetEnvironmentVariable($name, $oldPgValues[$name])
    }
  }
}
else {
  $dockerArguments = @("exec", "-i", $ContainerName, "psql", "-U", "postgres", "-d", $contract.databaseName) + $psqlArguments
  $output = $sql | & docker @dockerArguments 2>&1
  $psqlExitCode = $LASTEXITCODE
}

if ($psqlExitCode -ne 0) {
  $safeOutput = $output | Where-Object {
    $_ -notmatch '(?i)(password|secret|token|jwt|service[_-]?role|postgres(?:ql)?://|authorization|cookie)'
  }
  throw "Reset procedure aborted. PostgreSQL rolled back the transaction when applicable.`n$($safeOutput -join [Environment]::NewLine)"
}

$jsonLine = $output | Where-Object { $_ -is [string] -and $_.TrimStart().StartsWith("{") } | Select-Object -Last 1
if (-not $jsonLine) {
  throw "The reset procedure did not return a machine-readable report."
}
$report = $jsonLine | ConvertFrom-Json

if ($Mode -eq "DryRun") {
  Write-Host "RESET OPERACIONAL - DRY RUN"
  Write-Host "Projeto: $($report.project.name) [$($report.project.ref)]"
  Write-Host ""
  Write-Host "PRESERVAR"
  Write-Host "Catalogo: $($report.preserve.catalog.items) items"
  Write-Host "Configuracoes: $($report.preserve.catalog.configurations)"
  Write-Host "Codigos comerciais: $($report.preserve.catalog.commercial_codes)"
  Write-Host "Compatibilidades: $($report.preserve.catalog.compatibilities)"
  Write-Host "Usuarios: $($report.preserve.authUsers)"
  Write-Host "Perfis: $($report.preserve.profiles)"
  Write-Host "Memberships Safisa: $($report.preserve.safisaMemberships)"
  Write-Host "Imagens: $($report.preserve.referencedImages)"
  Write-Host ""
  Write-Host "RESETAR"
  foreach ($property in $report.reset.tables.PSObject.Properties) {
    Write-Host "$($property.Name): $($property.Value)"
  }
  Write-Host "Saldo itens: $($report.reset.balances.item_total)"
  Write-Host "Saldo configuracoes: $($report.reset.balances.configuration_total)"
  if ($report.reset.movementTypes.PSObject.Properties.Count -gt 0) {
    Write-Host "Movimentos por tipo:"
    foreach ($property in $report.reset.movementTypes.PSObject.Properties) {
      Write-Host "  $($property.Name): $($property.Value)"
    }
  }
  if ($report.reset.safisaEventTypes.PSObject.Properties.Count -gt 0) {
    Write-Host "Eventos Safisa por tipo:"
    foreach ($property in $report.reset.safisaEventTypes.PSObject.Properties) {
      Write-Host "  $($property.Name): $($property.Value)"
    }
  }
  Write-Host ""
  Write-Host "REINICIALIZAR"
  Write-Host "Itens com minimo > 0: $($report.reinitialize.itemsWithMinimum)"
  Write-Host "Configuracoes com minimo > 0: $($report.reinitialize.configurationsWithMinimum)"
  Write-Host "Push subscriptions: $PushSubscriptions"
  Write-Host ""
  Write-Host "NENHUMA ALTERACAO FOI EXECUTADA."
  if (-not $report.guards.allPassed) {
    throw "Dry-run completed without mutations, but one or more execution guards failed."
  }
}
else {
  Write-Host "RESET OPERACIONAL CONCLUIDO"
  Write-Host "Projeto: $($report.project.name) [$($report.project.ref)]"
  Write-Host "Push subscriptions: $($report.pushSubscriptionAction)"
  Write-Host "Linhas operacionais restantes: $($report.operationalRowsRemaining)"
  Write-Host "Transacao validada e confirmada pelo PostgreSQL."
}

$report
