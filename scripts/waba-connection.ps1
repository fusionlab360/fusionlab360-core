[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][uri]$ApiBaseUrl,
    [Parameter(Mandatory = $true)]
    [ValidateSet('List', 'Provision', 'RegisterPending', 'StartOnboarding', 'CompleteOnboarding', 'Activate', 'Suspend', 'Revoke')]
    [string]$Operation,
    [string]$IntegrationId,
    [string]$WabaId,
    [string]$PhoneNumberId,
    [string]$ConnectionId,
    [string]$GhlLocationId,
    [string]$GhlProviderId,
    [string]$EvidenceReference,
    [string]$Justification,
    [switch]$AllowProduction
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($ApiBaseUrl.Scheme -ne 'https' -or $ApiBaseUrl.Query -or $ApiBaseUrl.UserInfo -or $ApiBaseUrl.AbsolutePath.Trim('/') -ne '') {
    throw 'ApiBaseUrl must be an HTTPS origin without path, query, or embedded credentials.'
}

$mutating = $Operation -ne 'List'
$expectedOrigin = $ApiBaseUrl.GetLeftPart([UriPartial]::Authority)
$confirmedOrigin = Read-Host "Type the exact Core origin to trust: $expectedOrigin"
if ($confirmedOrigin -cne $expectedOrigin) { throw 'API origin confirmation did not match.' }

if ($mutating -and $ApiBaseUrl.Host -eq 'api.fusionlab360.com') {
    if (-not $AllowProduction) { throw 'Production operations require -AllowProduction and an exact interactive confirmation.' }
}

$confirmationTarget = if ($ConnectionId) { $ConnectionId } else { $Operation }
if ($mutating) {
    $expected = if ($ApiBaseUrl.Host -eq 'api.fusionlab360.com') {
        "PRODUCTION $Operation $confirmationTarget"
    } else {
        "CONFIRM $Operation $confirmationTarget"
    }
    $confirmed = Read-Host "Type '$expected' to continue"
    if ($confirmed -cne $expected) { throw 'Operation cancelled.' }
}

$secureApiKey = Read-Host 'FusionLab360 tenant API key' -AsSecureString
$apiKeyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureApiKey)
$apiKey = $null
try {
    $apiKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($apiKeyPointer)
    $headers = @{ Authorization = "Bearer $apiKey" }
    $base = $ApiBaseUrl.AbsoluteUri.TrimEnd('/')
    $path = '/integrations/meta-whatsapp/connections'
    $method = 'GET'
    $body = $null

    switch ($Operation) {
        'List' { }
        'Provision' {
            $path = '/integrations/meta-whatsapp/provision'
            $method = 'POST'
            $body = '{}'
        }
        'RegisterPending' {
            foreach ($value in @($IntegrationId, $WabaId, $PhoneNumberId)) {
                if ([string]::IsNullOrWhiteSpace($value)) { throw 'IntegrationId, WabaId, and PhoneNumberId are required.' }
            }
            $method = 'POST'
            $body = @{ integrationId = $IntegrationId; wabaId = $WabaId; phoneNumberId = $PhoneNumberId } | ConvertTo-Json -Compress
        }
        'StartOnboarding' {
            if ([string]::IsNullOrWhiteSpace($IntegrationId)) { throw 'IntegrationId is required.' }
            $path = '/integrations/meta-whatsapp/onboarding/sessions'
            $method = 'POST'
            $body = @{ integrationId = $IntegrationId } | ConvertTo-Json -Compress
        }
        'CompleteOnboarding' {
            foreach ($value in @($WabaId, $PhoneNumberId)) {
                if ([string]::IsNullOrWhiteSpace($value)) { throw 'WabaId and PhoneNumberId are required.' }
            }
            $stateSecure = Read-Host 'One-time Meta OAuth state' -AsSecureString
            $codeSecure = Read-Host 'One-time Meta authorization code' -AsSecureString
            $statePointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($stateSecure)
            $codePointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($codeSecure)
            try {
                $state = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($statePointer)
                $code = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($codePointer)
                $path = '/integrations/meta-whatsapp/onboarding/complete'
                $method = 'POST'
                $body = @{ state = $state; code = $code; wabaId = $WabaId; phoneNumberId = $PhoneNumberId } | ConvertTo-Json -Compress
            } finally {
                [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($statePointer)
                [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($codePointer)
                $stateSecure.Dispose()
                $codeSecure.Dispose()
                $state = $null; $code = $null
            }
        }
        { $_ -in 'Activate', 'Suspend', 'Revoke' } {
            if ([string]::IsNullOrWhiteSpace($ConnectionId) -or
                [string]::IsNullOrWhiteSpace($EvidenceReference) -or
                [string]::IsNullOrWhiteSpace($Justification)) {
                throw 'ConnectionId, EvidenceReference, and Justification are required.'
            }
            $action = $Operation.ToLowerInvariant()
            $payload = @{ action = $action; evidenceReference = $EvidenceReference; justification = $Justification }
            if ($Operation -eq 'Activate') {
                if ([string]::IsNullOrWhiteSpace($GhlLocationId) -or [string]::IsNullOrWhiteSpace($GhlProviderId)) {
                    throw 'GhlLocationId and GhlProviderId are required for activation.'
                }
                $payload.ghlLocationId = $GhlLocationId
                $payload.ghlProviderId = $GhlProviderId
            }
            $path = "/integrations/meta-whatsapp/connections/$([uri]::EscapeDataString($ConnectionId))/lifecycle"
            $method = 'POST'
            $body = $payload | ConvertTo-Json -Compress
        }
    }

    $request = @{ Uri = "$base$path"; Method = $method; Headers = $headers; TimeoutSec = 30; MaximumRedirection = 0 }
    if ($null -ne $body) {
        $request.ContentType = 'application/json'
        $request.Body = $body
    }
    try {
        $result = Invoke-RestMethod @request
    } catch {
        $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
        throw "Core request failed safely (HTTP $status). No response body or credential was written to output."
    }
    $result | ConvertTo-Json -Depth 8 -Compress
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($apiKeyPointer)
    $secureApiKey.Dispose()
    $apiKey = $null
    $headers = $null
    $body = $null
}
