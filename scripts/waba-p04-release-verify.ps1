param(
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-f-]{36}$')][string]$CandidateVersion,
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-f-]{36}$')][string]$ExpectedActiveVersion,
    [switch]$RequireSharedSecret,
    [string]$FixtureDirectory
)

$ErrorActionPreference = 'Stop'
function Invoke-WranglerReadOnly([string[]]$Arguments) {
    if ($FixtureDirectory) {
        if ($env:FL360_WABA_RELEASE_FIXTURE_MODE -ne '1') { throw 'Fixture mode is restricted to local tests.' }
        $file = if ($Arguments[0] -eq 'deployments') { 'deployment.json' } else { 'version.txt' }
        return Get-Content -LiteralPath (Join-Path $FixtureDirectory $file) -Raw
    }
    $output = & npx.cmd wrangler @Arguments 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw 'Wrangler read-only verification failed.' }
    return $output
}
function Require-Match([string]$Text, [string]$Pattern, [string]$Check) {
    if ($Text -notmatch $Pattern) { throw "Release check failed: $Check" }
}

$deployment = Invoke-WranglerReadOnly @('deployments', 'status', '--name', 'fusionlab360-core', '--json')
$deploymentJson = $deployment | ConvertFrom-Json
if ($deploymentJson.versions.Count -ne 1 -or
    $deploymentJson.versions[0].version_id -ne $ExpectedActiveVersion -or
    $deploymentJson.versions[0].percentage -ne 100) {
    throw 'Release check failed: active traffic allocation.'
}
$version = Invoke-WranglerReadOnly @('versions', 'view', $CandidateVersion, '--name', 'fusionlab360-core')
Require-Match $version ([regex]::Escape($CandidateVersion)) 'candidate version identity'
Require-Match $version 'Compatibility Date:\s+2025-07-01' 'compatibility date'
foreach ($binding in @('GHL_INBOUND_QUEUE', 'DB', 'VECTORIZE', 'VECTORIZE_V2', 'AI', 'CF_VERSION_METADATA')) {
    Require-Match $version ("env\." + [regex]::Escape($binding) + '\b') "binding $binding"
}
Require-Match $version 'e80f1a85-3b37-4fc7-aa68-e4aab4fd7ec4' 'production D1 identity'
Require-Match $version 'fusionlab360-ghl-inbound' 'inbound Queue identity'
foreach ($flag in @(
    'GHL_META_WHATSAPP_OUTBOUND_ENABLED',
    'META_WHATSAPP_OPERATOR_DIAGNOSTIC_ENABLED',
    'NEW_QUEUE_ENVELOPES_ENABLED',
    'WABA_GHL_READONLY_ENABLED'
)) {
    Require-Match $version ("env\." + $flag + '\s+\("false"\)') "disabled flag $flag"
}
Require-Match $version 'env\.META_WHATSAPP_GHL_INBOUND_ENABLED\s+\("true"\)' 'inbound enabled'
Require-Match $version 'env\.META_WHATSAPP_GHL_INBOUND_TENANT_ALLOWLIST\s+\("gmmetro"\)' 'inbound tenant'
$secrets = @(
    'FL360_API_KEY', 'GEMINI_API_KEY', 'GHL_API_KEY', 'GHL_CUSTOM_PROVIDER_ENABLED',
    'GHL_CUSTOM_PROVIDER_LOCATION_ALLOWLIST', 'GHL_LOCATION_ID', 'GHL_OAUTH_CLIENT_ID',
    'GHL_OAUTH_CLIENT_SECRET', 'JWT_AUDIENCE', 'JWT_ISSUER', 'JWT_SECRET',
    'META_WHATSAPP_APP_SECRET', 'META_WHATSAPP_CREDENTIAL_ENCRYPTION_KEYS',
    'META_WHATSAPP_VERIFY_TOKEN'
)
if ($RequireSharedSecret) { $secrets += 'GHL_APP_SHARED_SECRET' }
foreach ($secret in $secrets) {
    Require-Match $version ("Secret Name:\s+" + [regex]::Escape($secret) + '\b') "secret name $secret"
}
$healthStatus = if ($FixtureDirectory) {
    [int](Get-Content -LiteralPath (Join-Path $FixtureDirectory 'health.json') -Raw | ConvertFrom-Json).status
} else {
    [int](Invoke-WebRequest -Uri 'https://api.fusionlab360.com/health' -Method Get -TimeoutSec 20).StatusCode
}
if ($healthStatus -ne 200) { throw 'Release check failed: health HTTP status.' }
[pscustomobject]@{
    candidateVersion = $CandidateVersion
    activeVersion = $ExpectedActiveVersion
    activePercentage = 100
    bindingCount = 6
    secretNameCount = $secrets.Count
    healthStatus = 200
    messagingFlagsVerified = $true
} | ConvertTo-Json -Compress
