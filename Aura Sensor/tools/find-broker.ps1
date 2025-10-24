param(
    [string]$Subnet = "192.168.0",
    [int]$Port = 1883,
    [int]$FromHost = 1,
    [int]$ToHost = 254,
    [switch]$NoUpdate
)

function Test-Port {
    param(
        [string]$Address,
        [int]$Port,
        [int]$TimeoutMs = 300
    )

    try {
        $client = [System.Net.Sockets.TcpClient]::new()
        $iar = $client.BeginConnect($Address, $Port, $null, $null)
        if (-not $iar.AsyncWaitHandle.WaitOne($TimeoutMs, $false)) {
            $client.Close()
            return $false
        }
        $client.EndConnect($iar)
        $client.Close()
        return $true
    } catch {
        return $false
    }
}

Write-Host "Scanning $Subnet.$FromHost-$ToHost for MQTT brokers on port $Port..." -ForegroundColor Cyan
$reachable = @()
$total = $ToHost - $FromHost + 1
$current = 0

foreach ($i in $FromHost..$ToHost) {
    $current++
    $address = "$Subnet.$i"
    Write-Progress -Activity "Probing $address" -Status "$current / $total" -PercentComplete (($current / $total) * 100)
    if (Test-Port -Address $address -Port $Port) {
        Write-Host "Found MQTT broker at $address:$Port" -ForegroundColor Green
        $reachable += $address
    }
}

Write-Progress -Activity "Scan complete" -Completed

if ($reachable.Count -eq 0) {
    Write-Host "No MQTT brokers detected in the specified range." -ForegroundColor Yellow
    exit 1
}

if ($NoUpdate.IsPresent) {
    Write-Host "Reachable brokers:" -ForegroundColor Green
    $reachable | ForEach-Object { Write-Host " - $_" }
    exit 0
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$localProps = Join-Path $repoRoot "local.properties"
if (-not (Test-Path $localProps)) {
    Write-Host "local.properties not found at $localProps. Skipping update." -ForegroundColor Yellow
    exit 0
}

$primary = $reachable[0]
$additional = $reachable | Select-Object -Skip 1

$content = Get-Content $localProps

if ($content -match "^MQTT_HOST=") {
    $content = $content -replace "^MQTT_HOST=.*", "MQTT_HOST=$primary"
} else {
    $content += "MQTT_HOST=$primary"
}

$additionalLine = "MQTT_ADDITIONAL_HOSTS=" + ($additional -join ",")
if ($content -match "^MQTT_ADDITIONAL_HOSTS=") {
    $content = $content -replace "^MQTT_ADDITIONAL_HOSTS=.*", $additionalLine
} elseif ($additional.Count -gt 0) {
    $content += $additionalLine
}

$content | Set-Content -Path $localProps -Encoding UTF8

Write-Host "Updated local.properties with primary host $primary." -ForegroundColor Green
if ($additional.Count -gt 0) {
    Write-Host "Additional reachable hosts: $($additional -join ", ")" -ForegroundColor Green
}
