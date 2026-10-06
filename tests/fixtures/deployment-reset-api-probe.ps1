param([string]$Runner,[string]$MockCli,[string]$LinkedWorkspace,[string]$Mode="DryRun",[string]$TestContract)
$ErrorActionPreference="Stop"
$env:SUPABASE_DB_PASSWORD="local-test-decoy-credential"
try {
  & $Runner -Mode $Mode -SupabaseCliPath $MockCli -LinkedWorkspacePath $LinkedWorkspace -ContractPath $TestContract | Out-Null
  if ($env:SUPABASE_DB_PASSWORD -ne "local-test-decoy-credential") { throw "Original local setting was not restored" }
  Write-Host "PASS API wrapper: read-only, sentinel restored"
}
catch {
  if ($env:SUPABASE_DB_PASSWORD -ne "local-test-decoy-credential") { throw "Failure did not restore local setting" }
  throw
}
