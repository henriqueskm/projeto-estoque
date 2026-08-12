[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$temporaryRoot = [System.IO.Path]::GetFullPath($env:TEMP)
$testRoot = Join-Path $temporaryRoot (
  "nk-negotiation-identity-cli-" + [guid]::NewGuid().ToString("N")
)
$dockerCommand = (Get-Command docker.exe -ErrorAction Stop).Source
$npmCommand = (Get-Command npm.cmd -ErrorAction Stop).Source
$targetVersion = "20260812133046"
$targetMigration = Join-Path $repositoryRoot (
  "supabase\migrations\${targetVersion}_enforce_supplier_order_negotiation_identity.sql"
)
$baselineDirectory = Join-Path $repositoryRoot "supabase\baseline"
$manifest = Get-Content -Raw -LiteralPath (
  Join-Path $baselineDirectory "baseline_manifest.json"
) | ConvertFrom-Json
$cutoff = [string]$manifest.historical_cutoff_migration
$projectId = "nk_negotiation_identity_cli"
$containerName = "supabase_db_$projectId"
$allOutput = [System.Collections.Generic.List[string]]::new()

$cliCandidates = @(Get-ChildItem -LiteralPath (
  Join-Path $env:LOCALAPPDATA "npm-cache\_npx"
) -Directory -ErrorAction Stop | ForEach-Object {
  $packagePath = Join-Path $_.FullName "node_modules\supabase\package.json"
  $binaryPath = Join-Path $_.FullName (
    "node_modules\@supabase\cli-windows-x64\bin\supabase.exe"
  )
  if ((Test-Path -LiteralPath $packagePath) -and (Test-Path -LiteralPath $binaryPath)) {
    $package = Get-Content -Raw -LiteralPath $packagePath | ConvertFrom-Json
    [pscustomobject]@{
      Version = [version]$package.version
      Binary = $binaryPath
    }
  }
} | Sort-Object Version -Descending)
if ($cliCandidates.Count -eq 0) {
  throw "No Supabase CLI binary resolved by npx --no-install was found."
}
$supabaseCommand = $cliCandidates[0].Binary

function Write-Utf8File {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Content
  )

  [System.IO.File]::WriteAllText(
    $Path,
    $Content,
    [System.Text.UTF8Encoding]::new($false)
  )
}

function Invoke-External {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [switch]$AllowFailure,
    [switch]$SuppressOutput
  )

  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = & $FilePath @Arguments 2>&1
    $exitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousPreference
  }

  $text = ($output | ForEach-Object { [string]$_ }) -join [Environment]::NewLine
  if (-not $SuppressOutput -and $text) {
    $script:allOutput.Add($text)
  }

  if ($exitCode -ne 0 -and -not $AllowFailure) {
    $safeText = ($text -split "`r?`n" | Where-Object {
      $_ -notmatch "(?i)(password|secret|token|jwt|(?:service[_-]?role|anon|publishable)[_-]?key|postgres(?:ql)?://|https?://)"
    }) -join [Environment]::NewLine
    throw "Command failed ($exitCode): $FilePath $($Arguments -join ' ')`n$safeText"
  }

  [pscustomobject]@{
    ExitCode = $exitCode
    Output = $text
  }
}

function Invoke-Supabase {
  param(
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [switch]$AllowFailure,
    [switch]$SuppressOutput
  )

  Invoke-External -FilePath $supabaseCommand `
    -Arguments $Arguments `
    -AllowFailure:$AllowFailure `
    -SuppressOutput:$SuppressOutput
}

function Invoke-Docker {
  param(
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [switch]$AllowFailure,
    [switch]$SuppressOutput
  )

  Invoke-External -FilePath $dockerCommand `
    -Arguments $Arguments `
    -AllowFailure:$AllowFailure `
    -SuppressOutput:$SuppressOutput
}

function Stop-Scenario {
  param([string]$Workspace)

  if ($Workspace -and (Test-Path -LiteralPath (Join-Path $Workspace "supabase\config.toml"))) {
    Invoke-Supabase -Arguments @(
      "stop", "--no-backup", "--workdir", $Workspace
    ) -AllowFailure -SuppressOutput | Out-Null
  }
}

function Invoke-Psql {
  param(
    [Parameter(Mandatory = $true)][string]$Sql,
    [switch]$AllowFailure
  )

  Invoke-Docker -Arguments @(
    "exec", $containerName,
    "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt",
    "-v", "ON_ERROR_STOP=1", "-c", $Sql
  ) -AllowFailure:$AllowFailure
}

function Invoke-PsqlFile {
  param([Parameter(Mandatory = $true)][string]$Path)

  $containerPath = "/tmp/" + [System.IO.Path]::GetFileName($Path)
  Invoke-Docker -Arguments @(
    "cp", $Path, "${containerName}:$containerPath"
  ) -SuppressOutput | Out-Null
  Invoke-Docker -Arguments @(
    "exec", $containerName,
    "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt",
    "-v", "ON_ERROR_STOP=1", "-f", $containerPath
  ) -SuppressOutput | Out-Null
}

function Get-Scalar {
  param([Parameter(Mandatory = $true)][string]$Sql)

  $result = Invoke-Psql -Sql $Sql
  return (($result.Output -split "`r?`n") | Where-Object { $_ -ne "" } | Select-Object -Last 1)
}

function Assert-Equal {
  param(
    [Parameter(Mandatory = $true)]$Actual,
    [Parameter(Mandatory = $true)]$Expected,
    [Parameter(Mandatory = $true)][string]$Message
  )

  if ([string]$Actual -ne [string]$Expected) {
    throw "$Message Expected '$Expected', received '$Actual'."
  }
}

function New-Scenario {
  param([Parameter(Mandatory = $true)][string]$Name)

  $workspace = Join-Path $testRoot $Name
  $workspaceMigrations = Join-Path $workspace "supabase\migrations"
  New-Item -ItemType Directory -Path $workspaceMigrations -Force | Out-Null

  $config = Get-Content -Raw -LiteralPath (
    Join-Path $repositoryRoot "supabase\config.toml"
  )
  $config = $config -replace '(?m)^project_id\s*=\s*"[^"]+"',
    "project_id = `"$projectId`""
  Write-Utf8File -Path (Join-Path $workspace "supabase\config.toml") -Content $config

  $historicalMigrations = @(Get-ChildItem -LiteralPath (
    Join-Path $repositoryRoot "supabase\migrations"
  ) -File | Where-Object {
    $_.BaseName.Substring(0, 14) -le $cutoff
  } | Sort-Object Name)

  Invoke-Supabase -Arguments @(
    "start",
    "-x",
    "gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor",
    "--workdir", $workspace
  ) -SuppressOutput | Out-Null

  Invoke-PsqlFile -Path (Join-Path $baselineDirectory "current_schema.sql")
  Invoke-PsqlFile -Path (Join-Path $baselineDirectory "reference_data.sql")

  foreach ($migration in $historicalMigrations) {
    Copy-Item -LiteralPath $migration.FullName -Destination $workspaceMigrations
  }

  $versions = @($historicalMigrations | ForEach-Object {
    $_.BaseName.Substring(0, 14)
  })
  Invoke-Supabase -Arguments (@(
    "migration", "repair", "--local", "--status", "applied", "--yes",
    "--workdir", $workspace
  ) + $versions) -SuppressOutput | Out-Null

  $futureMigrations = @(Get-ChildItem -LiteralPath (
    Join-Path $repositoryRoot "supabase\migrations"
  ) -File | Where-Object {
    $version = $_.BaseName.Substring(0, 14)
    $version -gt $cutoff -and $version -lt $targetVersion
  } | Sort-Object Name)
  foreach ($migration in $futureMigrations) {
    Copy-Item -LiteralPath $migration.FullName -Destination $workspaceMigrations
  }
  if ($futureMigrations.Count -gt 0) {
    Invoke-Supabase -Arguments @(
      "migration", "up", "--local", "--workdir", $workspace
    ) -SuppressOutput | Out-Null
  }

  Assert-Equal `
    -Actual (Get-Scalar "select count(*) from supabase_migrations.schema_migrations where version = '$targetVersion'") `
    -Expected "0" `
    -Message "$Name did not start immediately before MIG-ORD-008A."

  Copy-Item -LiteralPath $targetMigration -Destination $workspaceMigrations
  return $workspace
}

function Install-LegacyFixture {
  param(
    [Parameter(Mandatory = $true)][string]$ScenarioDirectory,
    [switch]$MismatchFourth
  )

  $fourth = if ($MismatchFourth) { "Unexpected" } else { "Teste 04" }
  $fixturePath = Join-Path $ScenarioDirectory "legacy-fixture.sql"
  $fixture = @"
begin;
truncate table
  public.safisa_portal_events,
  public.safisa_order_authorizations,
  public.safisa_portal_members,
  public.supplier_order_events,
  public.supplier_order_items,
  public.supplier_orders
cascade;
delete from auth.users where id = '20000000-0000-4000-8000-000000000001';
insert into auth.users (id, aud, role, created_at, updated_at)
values ('20000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', now(), now());
insert into public.profiles (id, name, is_active)
values ('20000000-0000-4000-8000-000000000001', 'Internal Local', true)
on conflict (id) do update set name = excluded.name, is_active = excluded.is_active;

insert into public.supplier_orders (
  id, negotiation_number, order_date, notes, created_by,
  created_by_name_snapshot, finalized_at, finalized_by,
  finalized_by_name_snapshot, finalization_note
)
values
  ('26e08e22-a2fb-4e8d-8605-4ccdb57d4773', 'teste 00', date '2026-07-24', 'Legacy fixture', '20000000-0000-4000-8000-000000000001', 'Internal Local', timestamptz '2026-08-01 12:00:00+00', '20000000-0000-4000-8000-000000000001', 'Internal Local', 'Legacy finalized'),
  ('db02621b-b6c1-4e7a-8fef-b63fc3e60d50', 'teste 01', date '2026-07-24', 'Legacy fixture', '20000000-0000-4000-8000-000000000001', 'Internal Local', null, null, null, null),
  ('e92bc06f-5721-4082-b77a-def6954e3300', 'teste 03', date '2026-07-24', 'Legacy fixture', '20000000-0000-4000-8000-000000000001', 'Internal Local', timestamptz '2026-08-01 12:00:00+00', '20000000-0000-4000-8000-000000000001', 'Internal Local', 'Legacy finalized'),
  ('af7a39f6-c4a2-4e92-b183-d8196aa775d1', '$fourth', date '2026-07-24', 'Legacy fixture', '20000000-0000-4000-8000-000000000001', 'Internal Local', null, null, null, null);

insert into public.supplier_order_items (
  id, supplier_order_id, item_id, code_snapshot, description_snapshot,
  model_snapshot, item_type_snapshot, ordered_quantity, ready_quantity,
  picked_quantity, stocked_quantity, cancelled_quantity, position
)
values
  ('21000000-0000-4000-8000-000000000001', '26e08e22-a2fb-4e8d-8605-4ccdb57d4773', 'd9bfc725-87a3-4194-8f51-bdc49d95bd8c', '1', 'SERVO MBF-015', 'MBF-015', 'SERVO', 5, 1, 1, 0, 0, 0),
  ('21000000-0000-4000-8000-000000000002', 'db02621b-b6c1-4e7a-8fef-b63fc3e60d50', 'd9bfc725-87a3-4194-8f51-bdc49d95bd8c', '1', 'SERVO MBF-015', 'MBF-015', 'SERVO', 6, 2, 2, 0, 0, 0),
  ('21000000-0000-4000-8000-000000000003', 'e92bc06f-5721-4082-b77a-def6954e3300', 'd9bfc725-87a3-4194-8f51-bdc49d95bd8c', '1', 'SERVO MBF-015', 'MBF-015', 'SERVO', 7, 3, 3, 0, 0, 0),
  ('21000000-0000-4000-8000-000000000004', 'af7a39f6-c4a2-4e92-b183-d8196aa775d1', 'd9bfc725-87a3-4194-8f51-bdc49d95bd8c', '1', 'SERVO MBF-015', 'MBF-015', 'SERVO', 8, 4, 4, 0, 0, 0);

insert into public.supplier_order_events (
  supplier_order_id, event_type, user_id, user_name_snapshot,
  idempotency_key, details
)
values
  ('26e08e22-a2fb-4e8d-8605-4ccdb57d4773', 'ORDER_CREATED', '20000000-0000-4000-8000-000000000001', 'Internal Local', '22000000-0000-4000-8000-000000000001', '{"request":{"negotiation_number":"teste 00"}}'),
  ('db02621b-b6c1-4e7a-8fef-b63fc3e60d50', 'ORDER_CREATED', '20000000-0000-4000-8000-000000000001', 'Internal Local', '22000000-0000-4000-8000-000000000002', '{"request":{"negotiation_number":"teste 01"}}'),
  ('e92bc06f-5721-4082-b77a-def6954e3300', 'ORDER_CREATED', '20000000-0000-4000-8000-000000000001', 'Internal Local', '22000000-0000-4000-8000-000000000003', '{"request":{"negotiation_number":"teste 03"}}'),
  ('af7a39f6-c4a2-4e92-b183-d8196aa775d1', 'ORDER_CREATED', '20000000-0000-4000-8000-000000000001', 'Internal Local', '22000000-0000-4000-8000-000000000004', jsonb_build_object('request', jsonb_build_object('negotiation_number', '$fourth')));
commit;
"@
  Write-Utf8File -Path $fixturePath -Content $fixture
  Invoke-PsqlFile -Path $fixturePath
}

function Get-PreservationSignature {
  return Get-Scalar @"
select md5(jsonb_build_object(
  'orders', (select jsonb_agg(to_jsonb(o) - 'negotiation_number' - 'updated_at' order by id) from public.supplier_orders o),
  'items', (select jsonb_agg(to_jsonb(i) order by id) from public.supplier_order_items i),
  'safisa', (select jsonb_agg(to_jsonb(a) order by supplier_order_id) from public.safisa_order_authorizations a)
)::text)
"@
}

function Assert-SuccessfulMigration {
  param(
    [Parameter(Mandatory = $true)][string]$Workspace,
    [Parameter(Mandatory = $true)][AllowEmptyString()][string]$ExpectedPreservationSignature,
    [Parameter(Mandatory = $true)][int]$ExpectedTechnicalEvents
  )

  Assert-Equal -Actual (Get-Scalar "select count(*) from supabase_migrations.schema_migrations where version = '$targetVersion'") -Expected "1" -Message "CLI history was not recorded exactly once."
  Assert-Equal -Actual (Get-Scalar "select count(*) from public.supplier_order_events where user_id is null and user_name_snapshot = 'MIG-ORD-008A'") -Expected ([string]$ExpectedTechnicalEvents) -Message "Technical audit count differs."
  Assert-Equal -Actual (Get-Scalar "select data_type from information_schema.columns where table_schema = 'public' and table_name = 'supplier_orders' and column_name = 'negotiation_number'") -Expected "text" -Message "Negotiation stopped being text."
  Assert-Equal -Actual (Get-Scalar "select to_regclass('public.supplier_orders_negotiation_number_key') is not null") -Expected "t" -Message "Global UNIQUE is missing."
  Assert-Equal -Actual (Get-Scalar "select to_regclass('public.supplier_orders_negotiation_number_idx') is null") -Expected "t" -Message "Redundant index remains."

  if ($ExpectedPreservationSignature) {
    Assert-Equal -Actual (Get-PreservationSignature) -Expected $ExpectedPreservationSignature -Message "Legacy order relationships or quantities changed."
    Assert-Equal -Actual (Get-Scalar "select string_agg(negotiation_number, '|' order by id) from public.supplier_orders") -Expected "99990000|99990004|99990001|99990003" -Message "Approved mapping differs."
    Assert-Equal -Actual (Get-Scalar "select count(*) from public.supplier_order_events where details #>> '{request,negotiation_number}' in ('teste 00','teste 01','teste 03','Teste 04')") -Expected "4" -Message "Historical snapshots were rewritten."
  }

  $migrationList = Invoke-Supabase -Arguments @(
    "migration", "list", "--local", "--workdir", $Workspace
  )
  $alignedTable = $migrationList.Output -match "(?m)^\s*$targetVersion\s*\|\s*$targetVersion\s*\|"
  $alignedJson = $migrationList.Output -match ('"local"\s*:\s*"' + $targetVersion + '"\s*,\s*"remote"\s*:\s*"' + $targetVersion + '"')
  if (-not $alignedTable -and -not $alignedJson) {
    throw "Supabase migration list does not show MIG-ORD-008A aligned locally.`n$($migrationList.Output)"
  }

  $dryRun = Invoke-Supabase -Arguments @(
    "db", "push", "--local", "--dry-run", "--workdir", $Workspace
  )
  if ($dryRun.Output -notmatch "(?i)(up to date|no migrations|finished.*push)") {
    throw "Second Supabase CLI dry-run did not confirm zero pending migrations.`n$($dryRun.Output)"
  }
}

function Assert-Contract {
  $contractPath = Join-Path $testRoot "contract.sql"
  $contract = @'
begin;
select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000001', true);
set local role authenticated;

do $contract$
declare
  v_first jsonb;
  v_replay jsonb;
  v_cancelled_id uuid;
  v_finalized_id uuid;
begin
  v_first := public.create_supplier_order(
    '1212', current_date, null,
    '[{"kind":"ITEM","item_id":"d9bfc725-87a3-4194-8f51-bdc49d95bd8c","quantity":1}]',
    '23000000-0000-4000-8000-000000000001'
  );
  v_replay := public.create_supplier_order(
    '1212', current_date, null,
    '[{"kind":"ITEM","item_id":"d9bfc725-87a3-4194-8f51-bdc49d95bd8c","quantity":1}]',
    '23000000-0000-4000-8000-000000000001'
  );
  if v_first ->> 'supplier_order_id' <> v_replay ->> 'supplier_order_id' then
    raise exception 'idempotent replay changed the logical order';
  end if;

  perform public.create_supplier_order(
    '001212', current_date, null,
    '[{"kind":"ITEM","item_id":"d9bfc725-87a3-4194-8f51-bdc49d95bd8c","quantity":1}]',
    '23000000-0000-4000-8000-000000000002'
  );

  begin
    perform public.create_supplier_order('ABC123', current_date, null, '[{"kind":"ITEM","item_id":"d9bfc725-87a3-4194-8f51-bdc49d95bd8c","quantity":1}]', gen_random_uuid());
    raise exception 'ABC123 unexpectedly accepted';
  exception when others then
    if sqlerrm = 'ABC123 unexpectedly accepted' or position('only digits 0-9' in sqlerrm) = 0 then raise; end if;
  end;
  begin
    perform public.create_supplier_order('12 12', current_date, null, '[{"kind":"ITEM","item_id":"d9bfc725-87a3-4194-8f51-bdc49d95bd8c","quantity":1}]', gen_random_uuid());
    raise exception '12 12 unexpectedly accepted';
  exception when others then
    if sqlerrm = '12 12 unexpectedly accepted' or position('only digits 0-9' in sqlerrm) = 0 then raise; end if;
  end;
  begin
    perform public.create_supplier_order('12-12', current_date, null, '[{"kind":"ITEM","item_id":"d9bfc725-87a3-4194-8f51-bdc49d95bd8c","quantity":1}]', gen_random_uuid());
    raise exception '12-12 unexpectedly accepted';
  exception when others then
    if sqlerrm = '12-12 unexpectedly accepted' or position('only digits 0-9' in sqlerrm) = 0 then raise; end if;
  end;
  begin
    perform public.create_supplier_order('12/12', current_date, null, '[{"kind":"ITEM","item_id":"d9bfc725-87a3-4194-8f51-bdc49d95bd8c","quantity":1}]', gen_random_uuid());
    raise exception '12/12 unexpectedly accepted';
  exception when others then
    if sqlerrm = '12/12 unexpectedly accepted' or position('only digits 0-9' in sqlerrm) = 0 then raise; end if;
  end;
  begin
    perform public.create_supplier_order('1212', current_date, null, '[{"kind":"ITEM","item_id":"d9bfc725-87a3-4194-8f51-bdc49d95bd8c","quantity":1}]', gen_random_uuid());
    raise exception 'duplicate unexpectedly accepted';
  exception when others then
    if sqlerrm = 'duplicate unexpectedly accepted' or position('negotiation already exists' in sqlerrm) = 0 then raise; end if;
  end;
  begin
    perform public.create_supplier_order('1212', current_date, null, '[{"kind":"ITEM","item_id":"d9bfc725-87a3-4194-8f51-bdc49d95bd8c","quantity":2}]', '23000000-0000-4000-8000-000000000001');
    raise exception 'different replay unexpectedly accepted';
  exception when others then
    if sqlerrm = 'different replay unexpectedly accepted' or position('idempotency' in lower(sqlerrm)) = 0 then raise; end if;
  end;

  v_cancelled_id := (public.create_supplier_order('777', current_date, null, '[{"kind":"ITEM","item_id":"d9bfc725-87a3-4194-8f51-bdc49d95bd8c","quantity":1}]', '23000000-0000-4000-8000-000000000003') ->> 'supplier_order_id')::uuid;
  reset role;
  update public.supplier_orders set cancelled_at = now(), cancelled_by = '20000000-0000-4000-8000-000000000001', cancelled_by_name_snapshot = 'Internal Local' where id = v_cancelled_id;
  set local role authenticated;
  begin
    perform public.create_supplier_order('777', current_date, null, '[{"kind":"ITEM","item_id":"d9bfc725-87a3-4194-8f51-bdc49d95bd8c","quantity":1}]', gen_random_uuid());
    raise exception 'cancelled duplicate unexpectedly accepted';
  exception when others then
    if sqlerrm = 'cancelled duplicate unexpectedly accepted' or position('negotiation already exists' in sqlerrm) = 0 then raise; end if;
  end;

  v_finalized_id := (public.create_supplier_order('888', current_date, null, '[{"kind":"ITEM","item_id":"d9bfc725-87a3-4194-8f51-bdc49d95bd8c","quantity":1}]', '23000000-0000-4000-8000-000000000004') ->> 'supplier_order_id')::uuid;
  reset role;
  update public.supplier_orders set finalized_at = now(), finalized_by = '20000000-0000-4000-8000-000000000001', finalized_by_name_snapshot = 'Internal Local' where id = v_finalized_id;
  set local role authenticated;
  begin
    perform public.create_supplier_order('888', current_date, null, '[{"kind":"ITEM","item_id":"d9bfc725-87a3-4194-8f51-bdc49d95bd8c","quantity":1}]', gen_random_uuid());
    raise exception 'finalized duplicate unexpectedly accepted';
  exception when others then
    if sqlerrm = 'finalized duplicate unexpectedly accepted' or position('negotiation already exists' in sqlerrm) = 0 then raise; end if;
  end;

  if (select count(*) from public.supplier_orders where negotiation_number in ('1212', '001212')) <> 2 then
    raise exception 'leading zero identity was normalized';
  end if;
end;
$contract$;
rollback;
'@
  Write-Utf8File -Path $contractPath -Content $contract
  Invoke-PsqlFile -Path $contractPath
}

New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
$activeWorkspace = $null

try {
  $version = Invoke-Supabase -Arguments @("--version")
  Write-Host "SUPABASE CLI: $($version.Output.Trim())"

  # A: approved production-shaped legacy set through the real CLI migration runner.
  $activeWorkspace = New-Scenario -Name "scenario-a"
  Install-LegacyFixture -ScenarioDirectory $activeWorkspace
  $preservationSignature = Get-PreservationSignature
  $pushA = Invoke-Supabase -Arguments @(
    "db", "push", "--local", "--yes", "--workdir", $activeWorkspace
  )
  if ($pushA.Output -notmatch $targetVersion) {
    throw "Scenario A CLI output did not name MIG-ORD-008A."
  }
  Assert-SuccessfulMigration -Workspace $activeWorkspace -ExpectedPreservationSignature $preservationSignature -ExpectedTechnicalEvents 4
  Assert-Contract
  Write-Host "PASS: CLI scenario A (four approved legacy orders)"
  Stop-Scenario -Workspace $activeWorkspace
  $activeWorkspace = $null

  # B: a failed precondition must roll back both SQL and migration history.
  $activeWorkspace = New-Scenario -Name "scenario-b"
  Install-LegacyFixture -ScenarioDirectory $activeWorkspace -MismatchFourth
  $wrapperHashBefore = Get-Scalar "select md5(pg_get_functiondef('public.create_supplier_order(text,date,text,jsonb,uuid)'::regprocedure))"
  $pushB = Invoke-Supabase -Arguments @(
    "db", "push", "--local", "--yes", "--workdir", $activeWorkspace
  ) -AllowFailure
  if ($pushB.ExitCode -eq 0 -or $pushB.Output -notmatch "does not have the approved identity") {
    throw "Scenario B did not fail for the guarded legacy mismatch."
  }
  Assert-Equal -Actual (Get-Scalar "select string_agg(negotiation_number, '|' order by id) from public.supplier_orders") -Expected "teste 00|Unexpected|teste 01|teste 03" -Message "Scenario B left a partial legacy conversion."
  Assert-Equal -Actual (Get-Scalar "select count(*) from public.supplier_order_events where user_name_snapshot = 'MIG-ORD-008A'") -Expected "0" -Message "Scenario B left technical events."
  Assert-Equal -Actual (Get-Scalar "select to_regclass('public.supplier_orders_negotiation_number_key') is null") -Expected "t" -Message "Scenario B left the UNIQUE constraint."
  Assert-Equal -Actual (Get-Scalar "select to_regclass('public.supplier_orders_negotiation_number_idx') is not null") -Expected "t" -Message "Scenario B removed the old index."
  Assert-Equal -Actual (Get-Scalar "select pg_get_constraintdef(oid) not like '%[0-9]%' from pg_constraint where conname = 'supplier_orders_negotiation_number_check'") -Expected "t" -Message "Scenario B left the digits-only CHECK."
  Assert-Equal -Actual (Get-Scalar "select md5(pg_get_functiondef('public.create_supplier_order(text,date,text,jsonb,uuid)'::regprocedure))") -Expected $wrapperHashBefore -Message "Scenario B partially replaced the wrapper."
  Assert-Equal -Actual (Get-Scalar "select count(*) from supabase_migrations.schema_migrations where version = '$targetVersion'") -Expected "0" -Message "Scenario B incorrectly registered migration history."
  Write-Host "PASS: CLI scenario B (transactional rollback and no history)"
  Stop-Scenario -Workspace $activeWorkspace
  $activeWorkspace = $null

  # C: zero legacy rows remains valid for clean reproducible rebuilds.
  $activeWorkspace = New-Scenario -Name "scenario-c"
  $pushC = Invoke-Supabase -Arguments @(
    "db", "push", "--local", "--yes", "--workdir", $activeWorkspace
  )
  if ($pushC.Output -notmatch $targetVersion) {
    throw "Scenario C CLI output did not name MIG-ORD-008A."
  }
  Assert-SuccessfulMigration -Workspace $activeWorkspace -ExpectedPreservationSignature "" -ExpectedTechnicalEvents 0
  Assert-Equal -Actual (Get-Scalar "select count(*) from public.supplier_orders") -Expected "0" -Message "Scenario C unexpectedly created orders."
  Write-Host "PASS: CLI scenario C (clean database with zero legacy rows)"
  Stop-Scenario -Workspace $activeWorkspace
  $activeWorkspace = $null

  # D: preserve the existing direct-PostgreSQL regression on an isolated pre-migration schema.
  $activeWorkspace = New-Scenario -Name "scenario-d"
  $previousContainer = $env:NEGOTIATION_IDENTITY_TEST_DB_CONTAINER
  try {
    $env:NEGOTIATION_IDENTITY_TEST_DB_CONTAINER = $containerName
    Invoke-External -FilePath $npmCommand -Arguments @(
      "run", "test:supplier-order-negotiation-identity:local"
    ) -SuppressOutput | Out-Null
  }
  finally {
    $env:NEGOTIATION_IDENTITY_TEST_DB_CONTAINER = $previousContainer
  }
  Write-Host "PASS: existing local PostgreSQL negotiation regression"

  $transactionWarnings = ($allOutput -join [Environment]::NewLine) | Select-String -Pattern "(?i)(no transaction in progress|transaction.*warning|warning.*(?:begin|commit|pipeline|migration history))"
  if ($transactionWarnings) {
    throw "Supabase CLI emitted a transaction/history warning: $($transactionWarnings.Line)"
  }

  Write-Host "SUPABASE_CLI_MIGRATION_PATH_VERIFIED"
}
finally {
  if ($activeWorkspace) {
    Stop-Scenario -Workspace $activeWorkspace
  }
  if (Test-Path -LiteralPath $testRoot) {
    $resolvedRoot = [System.IO.Path]::GetFullPath($testRoot)
    $tempWithSeparator = $temporaryRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
    if (-not $resolvedRoot.StartsWith($tempWithSeparator, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to remove test data outside the OS temporary directory."
    }
    Remove-Item -LiteralPath $resolvedRoot -Recurse -Force
  }
}
