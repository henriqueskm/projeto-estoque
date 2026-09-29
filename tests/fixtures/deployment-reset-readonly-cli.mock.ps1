$global:LASTEXITCODE = 0
if ($args -contains "--version") {
  if ($env:NK_RESET_MOCK_VERSION) { $env:NK_RESET_MOCK_VERSION } else { "2.112.0" }
  return
}
if ($args[0] -eq "projects") {
  if ($env:NK_RESET_MOCK_WRONG_PROJECT) { '[{"id":"differentprojectref00","name":"Other"}]' }
  else { '[{"id":"isdjboconmwaqipjrjvp","name":"EstoqueNK"}]' }
  return
}
if ($args[0] -ne "db" -or $args[1] -ne "query") { throw "Unexpected mock invocation" }
if ($env:SUPABASE_DB_PASSWORD -ne "NK_MANAGEMENT_API_ONLY_NO_DB_CONNECT") { throw "Local sentinel missing" }
$sql = ($input | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine
if ($sql -notmatch '^\s*begin transaction isolation level repeatable read read only;' -or $sql -match '(?i)\b(insert|update|truncate|alter|drop|create)\b') { throw "Non-read-only template reached mock" }
if ($env:NK_RESET_MOCK_PARSE_ERROR) { "invalid-json"; return }
$report = @{
  reportType="RESET_OPERACIONAL_DRY_RUN"; project=@{name="EstoqueNK";ref="isdjboconmwaqipjrjvp"};
  guards=@{allPassed=$true}; preserve=@{catalog=@{items=101;configurations=80;commercial_codes=80;compatibilities=22};authUsers=3;profiles=3;safisaMemberships=1;referencedImages=76};
  reset=@{tables=@{};balances=@{item_total=0;configuration_total=0};movementTypes=@{};safisaEventTypes=@{}};
  reinitialize=@{itemsWithMinimum=0;configurationsWithMinimum=0}; mutationsExecuted=$false
} | ConvertTo-Json -Depth 10 -Compress
@{rows=@(@{report=$report})} | ConvertTo-Json -Depth 10 -Compress
