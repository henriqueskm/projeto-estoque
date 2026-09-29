[CmdletBinding()]
param(
  [string]$ContainerName = "supabase_db_nk_pr_68_reset",
  [string]$CloneOfProjectRef = "isdjboconmwaqipjrjvp"
)
$ErrorActionPreference = "Stop"
$OutputEncoding = [Text.UTF8Encoding]::new($false)
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$runner = Join-Path $root "scripts\deployment-operational-reset.ps1"
$fixture = Join-Path $PSScriptRoot "fixtures\deployment-operational-reset.sql"
$confirmation = "CONFIRMAR RESET DE IMPLANTACAO ESTOQUENK"
if ($ContainerName -notmatch '^supabase_db_nk_pr_68_reset[a-z0-9_]*$') { throw "Exclusive PR-68 disposable container required." }
$labels = (& docker inspect -f '{{json .Config.Labels}}' $ContainerName) | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $labels.'nk.disposable' -ne "deployment-reset-pr-68") { throw "Disposable ownership label is required; existing baseline containers are refused." }
$running = & docker inspect -f '{{.State.Running}}' $ContainerName
if ($LASTEXITCODE -ne 0 -or $running -ne "true") { throw "Disposable DB is not running." }

function Sql {
  param([string]$Statement)
  $previous = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    $output = $Statement | docker exec -i $ContainerName psql -U postgres -d postgres -X -qAt -v ON_ERROR_STOP=1 -f - 2>&1
    $status = $LASTEXITCODE
  }
  finally { $ErrorActionPreference = $previous }
  if ($status -ne 0) { throw "Disposable query failed: $($output | Select-Object -Last 3)" }
  return (($output | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine).Trim()
}
function Quote { param([string]$Value) return "'" + $Value.Replace("'", "''") + "'" }
$default = Get-Content -Encoding UTF8 -Raw (Join-Path $root "scripts\deployment-reset\contract.json") | ConvertFrom-Json
$drySql = Get-Content -Encoding UTF8 -Raw (Join-Path $root "scripts\deployment-reset\dry-run.sql")
$prefix = $drySql.Substring(0, $drySql.IndexOf("guard_state as (")).TrimEnd().TrimEnd(',')
$relations = (Sql "select string_agg(n.nspname||'.'||c.relname,',' order by n.nspname,c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind='r';") -split ','
$approved = ConvertTo-Json -InputObject @($default.approvedLooseParts) -Depth 10 -Compress
$prefix = $prefix.Replace(":'approved_loose_parts'", (Quote $approved)).Replace(":'expected_bucket_id'", (Quote $default.bucketId)).Replace(":'required_relations'", (Quote ($relations -join ',')))
$auditSql = $prefix + @'
select jsonb_build_object('schema',schema_state.fingerprint,
 'pre',catalog_state.fingerprint,'post',catalog_post.fingerprint,
 'fk',foreign_key_state.fingerprint,'counts',to_jsonb(catalog_counts),
 'operational',operational_counts.counts,'minimums',to_jsonb(minimum_state))::text
from schema_state,catalog_state,catalog_post,foreign_key_state,catalog_counts,
 operational_counts,minimum_state;
commit;
'@
function Audit { return (Sql $auditSql | ConvertFrom-Json) }
function Contract {
  $copy = $default | ConvertTo-Json -Depth 20 | ConvertFrom-Json
  $audit = Audit
  $copy.schemaFingerprint=$audit.schema; $copy.catalogFingerprint=$audit.pre
  $copy.expectedPostCatalogFingerprint=$audit.post; $copy.foreignKeyFingerprint=$audit.fk
  return $copy
}
$expressions = @($relations + @("auth.users","storage.buckets","storage.objects","supabase_migrations.schema_migrations") | ForEach-Object {
  "'" + $_ + "',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from " + $_ + " t)"
})
$signatureSql = "select md5(jsonb_build_object(" + ($expressions -join ",") + ")::text);"
function Signature { return (Sql $signatureSql) + "|" + (Audit).schema }
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ("nk-pr-68-reset-tests-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $testRoot | Out-Null
$testContractPath = Join-Path $testRoot "local-contract.json"
function Save { param($Value) $Value | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $testContractPath -Encoding UTF8 }
$script:passed=0
function Pass { param([string]$Name) $script:passed++; Write-Host "PASS $script:passed $Name" }
function Reject {
  param([string]$Name,$Contract,[string]$Expected,
    [switch]$NoConfirmation,[switch]$NoBackup,[switch]$NoPaused,[switch]$ForceFailure)
  Save $Contract
  $before=Signature
  $arguments=@{Mode="Execute";ContainerName=$ContainerName;CloneOfProjectRef=$CloneOfProjectRef;PushSubscriptions="PRESERVE";ContractPath=$testContractPath;LocalTest=$true}
  if (-not $NoConfirmation) { $arguments.Confirmation=$confirmation }
  if (-not $NoBackup) { $arguments.BackupValidated=$true }
  if (-not $NoPaused) { $arguments.OperationsPaused=$true }
  if ($ForceFailure) { $arguments.ForceValidationFailure=$true }
  $rejected=$false
  try { & $runner @arguments | Out-Null }
  catch { if ($_.Exception.Message -notmatch $Expected) { throw }; $rejected=$true }
  if (-not $rejected -or (Signature) -ne $before) { throw "$Name failed atomic rejection." }
  Pass $Name
}

Sql (Get-Content -Encoding UTF8 -Raw $fixture) | Out-Null
$contract=Contract
Save $contract
$before=Signature
$dry = & $runner -Mode DryRun -ContainerName $ContainerName -CloneOfProjectRef $CloneOfProjectRef -ContractPath $testContractPath
if (-not $dry.guards.allPassed -or (Signature) -ne $before) { throw "DryRun mutation/guard failure." }
Pass "DryRun preserves every operational/catalog/Auth/profile/Storage row"
Reject "exact confirmation" $contract 'exact deployment-reset confirmation phrase' -NoConfirmation
Reject "backup acknowledgement" $contract 'validated backup acknowledgement' -NoBackup
Reject "maintenance acknowledgement" $contract 'maintenance acknowledgement' -NoPaused

$cases=@(
 @("schemaFingerprint","00000000000000000000000000000000","Schema fingerprint guard"),
 @("catalogFingerprint","00000000000000000000000000000000","Catalog fingerprint guard"),
 @("expectedPostCatalogFingerprint","00000000000000000000000000000000","Expected catalog delta"),
 @("foreignKeyFingerprint","00000000000000000000000000000000","Expected catalog delta"),
 @("authUsers",4,"Auth/profile/membership guard"),
 @("profiles",4,"Auth/profile/membership guard"),
 @("safisaMemberships",2,"Auth/profile/membership guard"),
 @("storageObjects",77,"Storage preservation guard")
)
foreach($case in $cases) {
 $changed=$contract | ConvertTo-Json -Depth 20 | ConvertFrom-Json
 $changed.($case[0])=$case[1]
 Reject ("contract guard "+$case[0]) $changed $case[2]
}
$changed=$contract | ConvertTo-Json -Depth 20 | ConvertFrom-Json
$changed.catalogCounts.items=105
Reject "exact catalog counts" $changed 'Catalog count guard'
$changed=$contract | ConvertTo-Json -Depth 20 | ConvertFrom-Json
$changed.approvedLooseParts[0].code="067 CHANGED"
Reject "exact approved identity" $changed 'Exact approved loose-part identity guard'

Sql "create table public.reset_unexpected_reference(item_id uuid references public.items(id)); insert into public.reset_unexpected_reference values ('313a920b-5b6c-4132-b342-3fdd69fc4aa1');" | Out-Null
Reject "unclassified table/FK blocks reset" $contract 'Schema fingerprint guard'
Sql "drop table public.reset_unexpected_reference;" | Out-Null

$app=Sql "select jsonb_build_object('id',id,'label',source_servo_label)::text from public.vehicle_applications where source_servo_label is not null order by id limit 1;" | ConvertFrom-Json
Sql "update public.vehicle_applications set source_servo_label='110' where id='$($app.id)';" | Out-Null
Reject "protected application reference" (Contract) 'protected structural references'
Sql ("update public.vehicle_applications set source_servo_label="+(Quote $app.label)+" where id='$($app.id)';") | Out-Null

# Verify the actual JSON/literal/UTF-8 transport with an apostrophe and accent.
$accentedDescription = "Pe$([char]0xE7)a d'ensaio"
Sql ("update public.items set description="+(Quote $accentedDescription)+" where code='067';") | Out-Null
$accentedContract = Contract
$accentedContract.approvedLooseParts[0].description = $accentedDescription
Save $accentedContract
$accentedBefore = Signature
$accentedDry = & $runner -Mode DryRun -ContainerName $ContainerName -CloneOfProjectRef $CloneOfProjectRef -ContractPath $testContractPath
if (-not $accentedDry.guards.allPassed -or (Signature) -ne $accentedBefore) { throw "UTF-8/quote DryRun guard failed." }
Pass "actual DB DryRun handles quoted/accented identity without writes"
Sql ("update public.items set description="+(Quote $default.approvedLooseParts[0].description)+" where code='067';") | Out-Null

Sql "alter table public.safisa_portal_events disable trigger safisa_portal_events_reject_mutation;" | Out-Null
Reject "Safisa immutable trigger must be active" (Contract) 'immutable-event trigger guard'
Sql "alter table public.safisa_portal_events enable trigger safisa_portal_events_reject_mutation;" | Out-Null

Sql @'
create function private.reset_test_skip_delete() returns trigger language plpgsql as $$ begin return null; end; $$;
create trigger reset_test_skip_delete before delete on public.stock_movements for each row execute function private.reset_test_skip_delete();
'@ | Out-Null
Reject "exact DELETE ROW_COUNT rolls back preceding deletions" (Contract) 'Exact ROW_COUNT validation failed'
Sql "drop trigger reset_test_skip_delete on public.stock_movements; drop function private.reset_test_skip_delete();" | Out-Null

Sql @'
create function private.reset_test_corrupt_catalog() returns trigger language plpgsql as $$ begin update public.items set description=description||' changed' where code='1'; return old; end; $$;
create trigger reset_test_corrupt_catalog after delete on public.stock_movements for each row execute function private.reset_test_corrupt_catalog();
'@ | Out-Null
Reject "unexpected POST catalog mutation rolls back" (Contract) 'Catalog/schema/migration preservation validation failed'
Sql "drop trigger reset_test_corrupt_catalog on public.stock_movements; drop function private.reset_test_corrupt_catalog();" | Out-Null
Reject "late forced failure rolls back all deletes/minimums" $contract 'Intentional local rollback validation failure' -ForceFailure

$preservedSql=@'
select md5(jsonb_build_object(
 'items',(select jsonb_agg(to_jsonb(t)-'minimum_stock' order by id) from public.items t where item_type<>'LOOSE_PART'),
 'servos',(select jsonb_agg(to_jsonb(t) order by item_id) from public.servo_models t),
 'kits',(select jsonb_agg(to_jsonb(t) order by item_id) from public.installation_kits t),
 'repairs',(select jsonb_agg(to_jsonb(t) order by item_id) from public.repair_kits t),
 'configurations',(select jsonb_agg(to_jsonb(t)-'minimum_stock' order by id) from public.commercial_configurations t),
 'codes',(select jsonb_agg(to_jsonb(t) order by id) from public.commercial_configuration_codes t),
 'compatibilities',(select jsonb_agg(to_jsonb(t) order by servo_id,repair_kit_id) from public.servo_repair_compatibility t),
 'brands',(select jsonb_agg(to_jsonb(t) order by id) from public.vehicle_application_brands t),
 'applications',(select jsonb_agg(to_jsonb(t) order by id) from public.vehicle_applications t),
 'auth',(select jsonb_agg(to_jsonb(t) order by id) from auth.users t),
 'profiles',(select jsonb_agg(to_jsonb(t) order by id) from public.profiles t),
 'memberships',(select jsonb_agg(to_jsonb(t) order by user_id) from public.safisa_portal_members t),
 'objects',(select jsonb_agg(to_jsonb(t) order by id) from storage.objects t),
 'buckets',(select jsonb_agg(to_jsonb(t) order by id) from storage.buckets t)
)::text);
'@
$preservedBefore=Sql $preservedSql
$pushBefore=Sql "select md5(jsonb_agg(to_jsonb(t) order by id)::text) from public.push_subscriptions t;"
$partsBefore=Sql "select jsonb_agg(to_jsonb(t) order by id)::text from public.items t where item_type='LOOSE_PART';"
$subtypesBefore=Sql "select jsonb_agg(to_jsonb(t) order by item_id)::text from public.loose_parts t;"
Save $contract
& $runner -Mode Execute -ContainerName $ContainerName -CloneOfProjectRef $CloneOfProjectRef -PushSubscriptions PRESERVE -ContractPath $testContractPath -Confirmation $confirmation -BackupValidated -OperationsPaused -LocalTest | Out-Null
$post=Audit
if($post.pre -ne $contract.expectedPostCatalogFingerprint -or $post.counts.items -ne 101 -or $post.counts.loose_parts -ne 0 -or
 ($post.operational.PSObject.Properties.Value | Measure-Object -Sum).Sum -ne 0 -or
 $post.minimums.items_nonzero -ne 0 -or $post.minimums.configurations_nonzero -ne 0 -or
 (Sql $preservedSql) -ne $preservedBefore -or (Sql "select md5(jsonb_agg(to_jsonb(t) order by id)::text) from public.push_subscriptions t;") -ne $pushBefore -or $post.schema -ne $contract.schemaFingerprint) {
 throw "Independent post-reset catalog-delta/zero/preservation validation failed."
}
Pass "exactly 5 subtypes/parents removed; every other full catalog/application/Auth/profile/image row preserved"
Pass "20 operational/balance tables empty; minimums zero; schema/migrations unchanged; push fully preserved"

foreach($policy in @("DISABLE","DELETE")) {
 Sql ("insert into public.items select * from jsonb_populate_recordset(null::public.items,"+(Quote $partsBefore)+"::jsonb); insert into public.loose_parts select * from jsonb_populate_recordset(null::public.loose_parts,"+(Quote $subtypesBefore)+"::jsonb);") | Out-Null
 Sql (Get-Content -Encoding UTF8 -Raw $fixture) | Out-Null
 Save (Contract)
 & $runner -Mode Execute -ContainerName $ContainerName -CloneOfProjectRef $CloneOfProjectRef -PushSubscriptions $policy -ContractPath $testContractPath -Confirmation $confirmation -BackupValidated -OperationsPaused -LocalTest | Out-Null
 $push=Sql "select count(*)||'|'||count(*) filter (where enabled) from public.push_subscriptions;"
 if(($policy -eq "DISABLE" -and $push -ne "2|0") -or ($policy -eq "DELETE" -and $push -ne "0|0")) { throw "Push policy mismatch." }
 Pass ("explicit local push policy "+$policy)
}
Write-Host "Deployment reset integration passed: $script:passed behavioral checks. No remote Execute. Local evidence: $testRoot"
