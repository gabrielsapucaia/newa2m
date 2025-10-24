param(
  [string]$User = $env:DEVICE_USER,
  [string]$Pass = $env:DEVICE_PASS
)
$ErrorActionPreference = "Stop"
if (-not $User) { $User = "device-test" }
if (-not $Pass) { $Pass = "devpass" }
$base = "http://localhost:18083/api/v5"
$dashUser = if ($env:EMQX_DASH_USER) { $env:EMQX_DASH_USER } else { "admin" }
$dashPass = if ($env:EMQX_DASH_PASS) { $env:EMQX_DASH_PASS } else { "public" }
$loginBody = @{username=$dashUser; password=$dashPass} | ConvertTo-Json -Compress
$login = Invoke-RestMethod -Method Post -Uri "$base/login" -Headers @{"Content-Type"="application/json"} -Body $loginBody
$token = $login.token
$headers = @{Authorization="Bearer $token"; "Content-Type"="application/json"}
$userBody = @{username=$User; password=$Pass} | ConvertTo-Json -Compress
try {
    Invoke-RestMethod -Method Post -Uri "$base/authentication/password_based:built_in_database/users" -Headers $headers -Body $userBody | Out-Null
    Write-Host "Usuário $User criado no EMQX."
} catch {
    $resp = $_.Exception.Response
    if ($resp -and $resp.StatusCode.value__ -in 400,409) {
        Write-Host "Usuário $User já existe ou já está configurado." -ForegroundColor Yellow
    } else {
        throw
    }
}
