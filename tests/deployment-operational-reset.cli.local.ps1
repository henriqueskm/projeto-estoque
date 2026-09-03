[CmdletBinding()]
param(
  [string]$ContainerName = "supabase_db_nk_current_state_baseline",
  [string]$CloneOfProjectRef = "isdjboconmwaqipjrjvp"
)

$ErrorActionPreference = "Stop"
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$runner = Join-Path $root "scripts\deployment-operational-reset.ps1"
$fixture = Join-Path $PSScriptRoot "fixtures\deployment-operational-reset.sql"
$confirmation = "CONFIRMAR RESET DE IMPLANTACAO ESTOQUENK"

if ($ContainerName -notmatch '^supabase_db_[a-z0-9_-]+$') {
  throw "This integration test only accepts an explicitly named disposable Supabase DB container."
}

$running = (& docker inspect -f '{{.State.Running}}' $ContainerName 2>$null | Select-Object -Last 1)
if ($LASTEXITCODE -ne 0 -or $running.Trim() -ne "true") {
  throw "Disposable local Supabase DB container is not running."
}

function Invoke-LocalPsql {
  param([Parameter(Mandatory = $true)][string]$Sql)
  $output = $Sql | docker exec -i $ContainerName psql -U postgres -d postgres -X -qAt -v ON_ERROR_STOP=1 -f - 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Local disposable database command failed.`n$($output -join [Environment]::NewLine)"
  }
  return (($output | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine).Trim()
}

function Get-StateSignature {
  $sql = @'
select md5(jsonb_build_object(
  'movement_batches', (select coalesce(jsonb_agg(to_jsonb(t) order by id), '[]'::jsonb) from public.movement_batches t),
  'stock_movements', (select coalesce(jsonb_agg(to_jsonb(t) order by id), '[]'::jsonb) from public.stock_movements t),
  'configuration_stock_movements', (select coalesce(jsonb_agg(to_jsonb(t) order by id), '[]'::jsonb) from public.configuration_stock_movements t),
  'supplier_orders', (select coalesce(jsonb_agg(to_jsonb(t) order by id), '[]'::jsonb) from public.supplier_orders t),
  'supplier_order_items', (select coalesce(jsonb_agg(to_jsonb(t) order by id), '[]'::jsonb) from public.supplier_order_items t),
  'safisa_events', (select coalesce(jsonb_agg(to_jsonb(t) order by id), '[]'::jsonb) from public.safisa_portal_events t),
  'push_events', (select coalesce(jsonb_agg(to_jsonb(t) order by id), '[]'::jsonb) from public.push_notification_events t),
  'push_subscriptions', (select coalesce(jsonb_agg(to_jsonb(t) order by id), '[]'::jsonb) from public.push_subscriptions t),
  'item_minimums', (select jsonb_agg(jsonb_build_array(id, minimum_stock) order by id) from public.items),
  'configuration_minimums', (select jsonb_agg(jsonb_build_array(id, minimum_stock) order by id) from public.commercial_configurations),
  'item_balances', (select coalesce(jsonb_agg(to_jsonb(t) order by item_id), '[]'::jsonb) from public.stock_balances t),
  'configuration_balances', (select coalesce(jsonb_agg(to_jsonb(t) order by configuration_id), '[]'::jsonb) from public.configuration_stock_balances t)
)::text);
'@
  return Invoke-LocalPsql -Sql $sql
}

$fixtureSql = Get-Content -LiteralPath $fixture -Raw
Invoke-LocalPsql -Sql $fixtureSql | Out-Null

$beforeDryRun = Get-StateSignature

$missingConfirmationBlocked = $false
try {
  & $runner -Mode Execute -ContainerName $ContainerName -CloneOfProjectRef $CloneOfProjectRef `
    -PushSubscriptions PRESERVE -BackupValidated -OperationsPaused -LocalTest | Out-Null
}
catch {
  $missingConfirmationBlocked = $_.Exception.Message -match 'exact deployment-reset confirmation phrase'
}
if (-not $missingConfirmationBlocked -or (Get-StateSignature) -ne $beforeDryRun) {
  throw "Execute was not safely blocked when the confirmation phrase was absent."
}

$missingBackupBlocked = $false
try {
  & $runner -Mode Execute -ContainerName $ContainerName -CloneOfProjectRef $CloneOfProjectRef `
    -PushSubscriptions PRESERVE -Confirmation $confirmation -OperationsPaused -LocalTest | Out-Null
}
catch {
  $missingBackupBlocked = $_.Exception.Message -match 'validated backup acknowledgement'
}
if (-not $missingBackupBlocked -or (Get-StateSignature) -ne $beforeDryRun) {
  throw "Execute was not safely blocked when the backup acknowledgement was absent."
}

& $runner -Mode DryRun -ContainerName $ContainerName -CloneOfProjectRef $CloneOfProjectRef -PushSubscriptions PRESERVE | Out-Null
$afterDryRun = Get-StateSignature
if ($beforeDryRun -ne $afterDryRun) {
  throw "Dry-run changed the disposable database."
}

$rollbackObserved = $false
try {
  & $runner -Mode Execute -ContainerName $ContainerName -CloneOfProjectRef $CloneOfProjectRef `
    -PushSubscriptions PRESERVE -Confirmation $confirmation -BackupValidated `
    -OperationsPaused -LocalTest -ForceValidationFailure | Out-Null
}
catch {
  if ($_.Exception.Message -match 'Intentional local rollback validation failure') {
    $rollbackObserved = $true
  }
  else {
    throw
  }
}

if (-not $rollbackObserved) {
  throw "The intentional final-validation failure did not abort execution."
}
if ((Get-StateSignature) -ne $beforeDryRun) {
  throw "The intentional failure did not roll the whole transaction back."
}

& $runner -Mode Execute -ContainerName $ContainerName -CloneOfProjectRef $CloneOfProjectRef `
  -PushSubscriptions PRESERVE -Confirmation $confirmation -BackupValidated `
  -OperationsPaused -LocalTest | Out-Null

$postReset = Invoke-LocalPsql -Sql @'
select concat_ws('|',
  (select count(*) from public.movement_batches),
  (select count(*) from public.stock_movements),
  (select count(*) from public.configuration_stock_movements),
  (select count(*) from public.assembly_operations),
  (select count(*) from public.supplier_orders),
  (select count(*) from public.safisa_portal_events),
  (select count(*) from public.push_notification_events),
  (select count(*) from private.stock_adjustment_requests),
  (select count(*) from private.configuration_operation_requests),
  (select count(*) from public.stock_balances),
  (select count(*) from public.configuration_stock_balances),
  (select count(*) from public.items where minimum_stock <> 0),
  (select count(*) from public.commercial_configurations where minimum_stock <> 0),
  (select count(*) from public.items),
  (select count(*) from public.commercial_configurations),
  (select count(*) from auth.users),
  (select count(*) from public.profiles),
  (select count(*) from public.safisa_portal_members),
  (select count(*) from storage.objects where bucket_id = 'commercial-catalog-images'),
  (select count(*) from public.push_subscriptions),
  (select tgenabled from pg_trigger where tgrelid = 'public.safisa_portal_events'::regclass and tgname = 'safisa_portal_events_reject_mutation')
);
'@

$expected = '0|0|0|0|0|0|0|0|0|0|0|0|0|107|80|3|3|1|76|2|O'
if ($postReset -ne $expected) {
  throw "Post-reset local state was unexpected: $postReset"
}

Invoke-LocalPsql -Sql $fixtureSql | Out-Null
& $runner -Mode Execute -ContainerName $ContainerName -CloneOfProjectRef $CloneOfProjectRef `
  -PushSubscriptions DISABLE -Confirmation $confirmation -BackupValidated `
  -OperationsPaused -LocalTest | Out-Null
$disabledSubscriptions = Invoke-LocalPsql -Sql "select count(*) || '|' || count(*) filter (where enabled) from public.push_subscriptions;"
if ($disabledSubscriptions -ne '2|0') {
  throw "Push subscription DISABLE policy was not enforced: $disabledSubscriptions"
}

Invoke-LocalPsql -Sql $fixtureSql | Out-Null
& $runner -Mode Execute -ContainerName $ContainerName -CloneOfProjectRef $CloneOfProjectRef `
  -PushSubscriptions DELETE -Confirmation $confirmation -BackupValidated `
  -OperationsPaused -LocalTest | Out-Null
$deletedSubscriptions = Invoke-LocalPsql -Sql "select count(*) from public.push_subscriptions;"
if ($deletedSubscriptions -ne '0') {
  throw "Push subscription DELETE policy was not enforced: $deletedSubscriptions"
}

Write-Host "Deployment reset local integration passed: dry-run immutable, rollback atomic, reset complete, preservation intact, all push policies verified."
