$ErrorActionPreference = 'Stop'
$root = Join-Path ([IO.Path]::GetTempPath()) ('fl360-waba-release-fixture-' + [guid]::NewGuid().ToString('N'))
$script = Join-Path $PSScriptRoot 'waba-p04-release-verify.ps1'
$candidate = 'b33a1a35-9dad-46f0-9e3f-7469ed108ae4'
$active = 'e79c96c1-ef9a-4907-a469-27725058a8d0'
$secretNames = @(
    'FL360_API_KEY','GEMINI_API_KEY','GHL_API_KEY','GHL_CUSTOM_PROVIDER_ENABLED',
    'GHL_CUSTOM_PROVIDER_LOCATION_ALLOWLIST','GHL_LOCATION_ID','GHL_OAUTH_CLIENT_ID',
    'GHL_OAUTH_CLIENT_SECRET','JWT_AUDIENCE','JWT_ISSUER','JWT_SECRET',
    'META_WHATSAPP_APP_SECRET','META_WHATSAPP_CREDENTIAL_ENCRYPTION_KEYS','META_WHATSAPP_VERIFY_TOKEN',
    'GHL_APP_SHARED_SECRET'
)
$version = @(
    "Version ID: $candidate", 'Compatibility Date: 2025-07-01',
    'env.GHL_INBOUND_QUEUE (fusionlab360-ghl-inbound)',
    'env.DB (e80f1a85-3b37-4fc7-aa68-e4aab4fd7ec4)',
    'env.VECTORIZE (fusionlab360-knowledge)', 'env.VECTORIZE_V2 (fusionlab360-knowledge-v2)',
    'env.AI', 'env.CF_VERSION_METADATA',
    'env.GHL_META_WHATSAPP_OUTBOUND_ENABLED ("false")',
    'env.META_WHATSAPP_OPERATOR_DIAGNOSTIC_ENABLED ("false")',
    'env.NEW_QUEUE_ENVELOPES_ENABLED ("false")',
    'env.WABA_GHL_READONLY_ENABLED ("false")',
    'env.META_WHATSAPP_GHL_INBOUND_ENABLED ("true")',
    'env.META_WHATSAPP_GHL_INBOUND_TENANT_ALLOWLIST ("gmmetro")'
) + ($secretNames | ForEach-Object { "Secret Name: $_" }) + 'Secret Value: fake-token-value'
function Check-Case([string]$Name, [string]$VersionText, [string]$DeploymentVersion, [int]$Health, [bool]$Expected) {
    Set-Content -LiteralPath (Join-Path $root 'version.txt') -Value $VersionText
    @{ versions = @(@{ version_id = $DeploymentVersion; percentage = 100 }) } |
      ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $root 'deployment.json')
    @{ status = $Health } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root 'health.json')
    $env:FL360_WABA_RELEASE_FIXTURE_MODE = '1'
    try {
        # The verifier intentionally writes errors for rejected fixtures. Keep
        # native stderr captured as data so expected nonzero exit codes do not
        # abort this test before its assertions run.
        $previousErrorActionPreference = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            $result = & pwsh -NoProfile -File $script -CandidateVersion $candidate -ExpectedActiveVersion $active -RequireSharedSecret -FixtureDirectory $root 2>&1 | Out-String
            $exitCode = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $previousErrorActionPreference
        }
        $passed = ($exitCode -eq 0)
        if ($passed -ne $Expected) { throw "Fixture $Name produced an unexpected exit code." }
        if ($result -match 'fake-token-value|sensitive message') { throw "Fixture $Name leaked sensitive content." }
    } finally { Remove-Item Env:FL360_WABA_RELEASE_FIXTURE_MODE -ErrorAction SilentlyContinue }
}
New-Item -ItemType Directory -Path $root | Out-Null
try {
    $valid = $version -join "`n"
    Check-Case 'valid' $valid $active 200 $true
    Check-Case 'wrong-active-version' $valid $candidate 200 $false
    Check-Case 'wrong-candidate-version' ($valid.Replace($candidate, $active)) $active 200 $false
    Check-Case 'missing-secret' ($valid.Replace('Secret Name: META_WHATSAPP_VERIFY_TOKEN', '')) $active 200 $false
    Check-Case 'missing-ghl-shared-secret' ($valid.Replace('Secret Name: GHL_APP_SHARED_SECRET', '')) $active 200 $false
    Check-Case 'missing-binding' ($valid.Replace('env.VECTORIZE_V2', 'env.OTHER')) $active 200 $false
    Check-Case 'inbound-disabled' ($valid.Replace('env.META_WHATSAPP_GHL_INBOUND_ENABLED ("true")', 'env.META_WHATSAPP_GHL_INBOUND_ENABLED ("false")')) $active 200 $false
    Check-Case 'outbound-enabled' ($valid.Replace('env.GHL_META_WHATSAPP_OUTBOUND_ENABLED ("false")', 'env.GHL_META_WHATSAPP_OUTBOUND_ENABLED ("true")')) $active 200 $false
    Check-Case 'health-failed' $valid $active 503 $false
    Write-Output 'Release verifier fixtures: 9/9 passed'
} finally {
    $resolved = [IO.Path]::GetFullPath($root)
    if ($resolved.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()), [StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
