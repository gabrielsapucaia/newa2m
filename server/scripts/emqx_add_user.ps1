param(
    [Parameter(Mandatory=$true)][string]$User,
    [Parameter(Mandatory=$true)][string]$Password,
    [string]$ApiKey = $env:EMQX_API_KEY,
    [string]$ApiSecret = $env:EMQX_API_SECRET,
    [string]$Endpoint = "http://localhost:18083"
)

if (-not $ApiKey -or -not $ApiSecret) {
    Write-Error "API key/secret não informados. Use -ApiKey/-ApiSecret ou defina EMQX_API_KEY/EMQX_API_SECRET."
    exit 1
}

$base = "$Endpoint/api/v5"
$token = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes(("{0}:{1}" -f $ApiKey, $ApiSecret)))
$headers = @{ Authorization = "Basic $token"; "Content-Type" = "application/json" }

try {
    $authResp = Invoke-RestMethod -Method Get -Uri "$base/authentication" -Headers $headers -ErrorAction Stop
    $builtin = $authResp.data | Where-Object { $_.id -eq 'password_based:built_in_database' }
    if (-not $builtin) {
        $body = @{ mechanism = "password_based"; backend = "built_in_database"; password_hash_algorithm = @{ name = "plain" } } | ConvertTo-Json -Compress
        Invoke-RestMethod -Method Post -Uri "$base/authentication" -Headers $headers -Body $body -ErrorAction Stop | Out-Null
        Write-Host "[emqx] Autenticador password_based:built_in_database criado."
    }
} catch {
    Write-Warning "Não foi possível verificar/criar autenticador: $($_.Exception.Message)"
}

$checkUri = "$base/authentication/password_based:built_in_database/users/$User"
try {
    Invoke-RestMethod -Method Get -Uri $checkUri -Headers $headers -ErrorAction Stop | Out-Null
    Write-Host "[emqx] Usuário '$User' já existe." -ForegroundColor Yellow
    exit 0
} catch {
    if ($_.Exception.Response.StatusCode.value__ -ne 404) {
        Write-Error "Falha ao consultar usuário '$User': $($_.Exception.Message)"
        exit 1
    }
}

$payload = @{ user_id = $User; password = $Password; is_superuser = $false } | ConvertTo-Json -Compress
try {
    Invoke-RestMethod -Method Post -Uri "$base/authentication/password_based:built_in_database/users" -Headers $headers -Body $payload -ErrorAction Stop | Out-Null
    Write-Host "[emqx] Usuário '$User' criado com sucesso."
} catch {
    Write-Error "Falha ao criar usuário '$User': $($_.Exception.Message)"
    exit 1
}
