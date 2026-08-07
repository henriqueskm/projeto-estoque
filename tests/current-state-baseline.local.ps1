[CmdletBinding()]
param([switch]$IncludeRebuilds)

$ErrorActionPreference = "Stop"
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$sourceBaseline = Join-Path $repositoryRoot "supabase\baseline"
$resetScript = Join-Path $repositoryRoot "scripts\reset-local-from-baseline.ps1"
$temporaryRoot = [System.IO.Path]::GetFullPath($env:TEMP)
$testRoot = Join-Path $temporaryRoot (
  "negocios-k-baseline-tests-" + [guid]::NewGuid().ToString("N")
)
$workspace = Join-Path $temporaryRoot "negocios-k-current-state-baseline"
$passed = 0
$dockerBin = Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\resources\bin"
if (Test-Path -LiteralPath $dockerBin) {
  $env:Path = "$dockerBin;$env:Path"
}

function Test-PathIsDescendant {
  param(
    [Parameter(Mandatory = $true)][string]$Root,
    [Parameter(Mandatory = $true)][string]$Candidate
  )

  $normalizedRoot = [System.IO.Path]::GetFullPath($Root).TrimEnd([char[]]@(
    [System.IO.Path]::DirectorySeparatorChar,
    [System.IO.Path]::AltDirectorySeparatorChar
  ))
  $normalizedCandidate = [System.IO.Path]::GetFullPath($Candidate)
  $rootWithSeparator = $normalizedRoot + [System.IO.Path]::DirectorySeparatorChar
  $comparison = if ($env:OS -eq "Windows_NT") {
    [System.StringComparison]::OrdinalIgnoreCase
  }
  else {
    [System.StringComparison]::Ordinal
  }

  return $normalizedCandidate.StartsWith($rootWithSeparator, $comparison)
}

function New-TestBaseline {
  param([Parameter(Mandatory = $true)][string]$Name)

  $destination = Join-Path $testRoot $Name
  Copy-Item -LiteralPath $sourceBaseline -Destination $destination -Recurse
  return $destination
}

function Update-ManifestHash {
  param(
    [Parameter(Mandatory = $true)][string]$Baseline,
    [Parameter(Mandatory = $true)][string]$Filename
  )

  $manifestPath = Join-Path $Baseline "baseline_manifest.json"
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  $hash = (Get-FileHash -LiteralPath (Join-Path $Baseline $Filename) -Algorithm SHA256).Hash.ToLowerInvariant()
  $manifest.files.$Filename.sha256 = $hash
  [System.IO.File]::WriteAllText(
    $manifestPath,
    ($manifest | ConvertTo-Json -Depth 20) + [Environment]::NewLine,
    [System.Text.UTF8Encoding]::new($false)
  )
}

function Invoke-ExpectedFailure {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$ExpectedMessage
  )

  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass `
      -File $resetScript @Arguments 2>&1
    $exitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousPreference
  }

  $safeOutput = ($output | Where-Object {
    $_ -notmatch "(?i)(password|secret|token|jwt|key|postgresql://)"
  }) -join [Environment]::NewLine

  if ($exitCode -eq 0) {
    throw "$Name unexpectedly succeeded."
  }
  if ($safeOutput -notmatch [regex]::Escape($ExpectedMessage)) {
    throw "$Name failed for an unexpected reason.`n$safeOutput"
  }

  $script:passed += 1
  Write-Host "PASS: $Name"
}

try {
  New-Item -ItemType Directory -Path $testRoot -Force | Out-Null

  Invoke-ExpectedFailure -Name "remote host refused" `
    -Arguments @("-DatabaseHost", "db.example.invalid", "-StopAfterValidation") `
    -ExpectedMessage "Remote database hosts are refused"

  $siblingWorkspace = $temporaryRoot + "-malicious-" + [guid]::NewGuid().ToString("N")
  Invoke-ExpectedFailure -Name "textual-prefix sibling path refused" `
    -Arguments @("-WorkspacePath", $siblingWorkspace, "-StopAfterValidation") `
    -ExpectedMessage "workspace must be located under the operating-system temporary directory"
  if (Test-Path -LiteralPath $siblingWorkspace) {
    throw "The rejected sibling workspace was created or modified."
  }

  $badChecksum = New-TestBaseline -Name "bad-checksum"
  [System.IO.File]::AppendAllText(
    (Join-Path $badChecksum "reference_data.sql"),
    "-- changed`n",
    [System.Text.UTF8Encoding]::new($false)
  )
  Invoke-ExpectedFailure -Name "incorrect checksum" `
    -Arguments @("-BaselineDirectory", $badChecksum, "-StopAfterValidation") `
    -ExpectedMessage "reference_data.sql checksum differs"

  $operational = New-TestBaseline -Name "operational-data"
  [System.IO.File]::AppendAllText(
    (Join-Path $operational "reference_data.sql"),
    '-- INSERT INTO "public"."movement_batches" is forbidden.' + "`n",
    [System.Text.UTF8Encoding]::new($false)
  )
  Update-ManifestHash -Baseline $operational -Filename "reference_data.sql"
  Invoke-ExpectedFailure -Name "operational table rejected" `
    -Arguments @("-BaselineDirectory", $operational, "-StopAfterValidation") `
    -ExpectedMessage "Reference data contains forbidden content"

  $personal = New-TestBaseline -Name "personal-data"
  [System.IO.File]::AppendAllText(
    (Join-Path $personal "reference_data.sql"),
    "-- " + (@("forbidden.person", "example.com") -join "@") + "`n",
    [System.Text.UTF8Encoding]::new($false)
  )
  Update-ManifestHash -Baseline $personal -Filename "reference_data.sql"
  Invoke-ExpectedFailure -Name "personal data rejected" `
    -Arguments @("-BaselineDirectory", $personal, "-StopAfterValidation") `
    -ExpectedMessage "Reference data contains forbidden content"

  $brokenSchema = New-TestBaseline -Name "broken-schema"
  [System.IO.File]::AppendAllText(
    (Join-Path $brokenSchema "current_schema.sql"),
    "`nTHIS IS NOT VALID SQL;`n",
    [System.Text.UTF8Encoding]::new($false)
  )
  Update-ManifestHash -Baseline $brokenSchema -Filename "current_schema.sql"
  Invoke-ExpectedFailure -Name "schema failure is contained" `
    -Arguments @(
      "-BaselineDirectory", $brokenSchema,
      "-WorkspacePath", $workspace,
      "-StopAfterValidation"
    ) `
    -ExpectedMessage "Applying current_schema.sql failed"

  $brokenData = New-TestBaseline -Name "broken-data"
  [System.IO.File]::AppendAllText(
    (Join-Path $brokenData "reference_data.sql"),
    "`nTHIS IS NOT VALID SQL;`n",
    [System.Text.UTF8Encoding]::new($false)
  )
  Update-ManifestHash -Baseline $brokenData -Filename "reference_data.sql"
  Invoke-ExpectedFailure -Name "data failure is contained" `
    -Arguments @(
      "-BaselineDirectory", $brokenData,
      "-WorkspacePath", $workspace,
      "-StopAfterValidation"
    ) `
    -ExpectedMessage "Applying reference_data.sql failed"

  $remainingContainers = docker ps -a `
    --filter "name=supabase_.*nk_current_state_baseline" `
    --format "{{.Names}}"
  if ($remainingContainers) {
    throw "A disposable Supabase container remained after failure cleanup."
  }
  $passed += 1
  Write-Host "PASS: failure cleanup removed all baseline containers"

  if ($IncludeRebuilds) {
    & $resetScript -StopAfterValidation
    & $resetScript -StopAfterValidation
    $passed += 2
    Write-Host "PASS: two repeated independent reconstructions"
  }

  Write-Host "Local baseline negative tests passed: $passed"
}
finally {
  if (Test-Path -LiteralPath $testRoot) {
    $resolvedTestRoot = [System.IO.Path]::GetFullPath($testRoot)
    if (-not (Test-PathIsDescendant -Root $temporaryRoot -Candidate $resolvedTestRoot)) {
      throw "Refusing to remove a test directory outside the temporary root."
    }
    Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
  }
}
