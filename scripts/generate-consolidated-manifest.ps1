[CmdletBinding()]
param(
  [string]$BaselineManifest,
  [string]$OutputManifest
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if (-not $BaselineManifest) {
  $BaselineManifest = Join-Path $repositoryRoot "INTEGRATION_CANDIDATE_MANIFEST.sha256"
}
if (-not $OutputManifest) {
  $OutputManifest = Join-Path $repositoryRoot "CONSOLIDATED_CANDIDATE_MANIFEST.sha256"
}

$baselinePath = (Resolve-Path -LiteralPath $BaselineManifest).Path
$outputPath = [System.IO.Path]::GetFullPath($OutputManifest)
$paths = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)

foreach ($line in [System.IO.File]::ReadAllLines($baselinePath)) {
  if ($line -notmatch "^([0-9a-fA-F]{64})\s+\*?(.*)$") {
    throw "Baseline manifest contains an invalid entry."
  }

  $relativePath = $Matches[2].Trim().Replace("\", "/")
  $fullPath = Join-Path $repositoryRoot $relativePath.Replace("/", [System.IO.Path]::DirectorySeparatorChar)
  if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
    throw "Baseline manifest references a missing file: $relativePath"
  }
  [void]$paths.Add($relativePath)
}

# These are the only new files outside the original WABA source snapshot that
# belong in the consolidated source/test manifest. Administrative registers
# remain outside the release manifest by design.
$additionalPaths = @(
  "scripts/generate-consolidated-manifest.ps1",
  "tests/bootstrap/request-logging.test.ts",
  "tests/domain/auth/me-route.test.ts",
  "tests/domain/booking/booking-intent-sensitive-logging.test.ts",
  "tests/integrations/crm/gohighlevel/sensitive-errors.test.ts"
)

foreach ($relativePath in $additionalPaths) {
  $fullPath = Join-Path $repositoryRoot $relativePath.Replace("/", [System.IO.Path]::DirectorySeparatorChar)
  if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
    throw "Consolidated manifest input is missing: $relativePath"
  }
  [void]$paths.Add($relativePath)
}

$orderedPaths = [string[]]@($paths)
[System.Array]::Sort($orderedPaths, [System.StringComparer]::Ordinal)
$manifestLines = foreach ($relativePath in $orderedPaths) {
  $fullPath = Join-Path $repositoryRoot $relativePath.Replace("/", [System.IO.Path]::DirectorySeparatorChar)
  $hash = (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash.ToLowerInvariant()
  "$hash  $relativePath"
}

[System.IO.File]::WriteAllLines(
  $outputPath,
  [string[]]$manifestLines,
  [System.Text.UTF8Encoding]::new($false)
)

Write-Output "Consolidated source manifest written: $($orderedPaths.Count) entries."
