param(
  [string]$Username = "sensor",
  [string]$Password = "devpass",
  [string]$ApiKey = "",
  [string]$ApiSecret = ""
)

$ErrorActionPreference = "Stop"

if (-not $ApiKey -or -not $ApiSecret) {
  Write-Host "EMQX v5 exige API Key/Secret para chamadas REST de administração."
  Write-Host "Crie a chave no Dashboard: http://localhost:18083  (System -> API Keys -> Create)"
  Write-Host "Depois rode:  powershell -ExecutionPolicy Bypass -File .\scripts\emqx_add_user.ps1 -Username sensor -Password devpass -ApiKey <KEY> -ApiSecret <SECRET>"
  exit 1
}

$token = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("{0}:{1}" -f $ApiKey, $ApiSecret))
$hdr = @{ Authorization = "Basic $token"; "Content-Type"="application/json" }
$apiUsers = "http://localhost:18083/api/v5/authentication/password_based:built_in_database/users"

# Tenta criar; se já existir, ignora erro 409
try {
  Invoke-RestMethod -Method Post -Uri $apiUsers -Headers $hdr -Body (@{username=$Username; password=$Password} | ConvertTo-Json) | Out-Null
  Write-Host "Usuário '$Username' criado."
} catch {
  $msg = $_.Exception.Response.GetResponseStream()
  if ($msg) {
    $reader = New-Object System.IO.StreamReader($msg)
    $body = $reader.ReadToEnd()
    if ($body -like '*already_exist*' -or $body -like '*exists*' -or $body -like '*409*') {
      Write-Host "Usuário '$Username' já existia; senha pode ter sido mantida."
    } else {
      Write-Host "Falha ao criar usuário: $body"
      exit 1
    }
  } else {
    throw
  }
}

# Lista para confirmar
try {
  $list = Invoke-RestMethod -Method Get -Uri $apiUsers -Headers $hdr
  $found = $false
  foreach ($u in $list.data) { if ($u.username -eq $Username) { $found = $true; break } }
  if ($found) { Write-Host "OK: usuário '$Username' presente no EMQX." } else { Write-Host "Atenção: usuário '$Username' não encontrado na lista." }
} catch {
  Write-Host "Aviso: não consegui listar usuários. Verifique a API Key/Secret e permissões."
}
