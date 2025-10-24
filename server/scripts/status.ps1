param()
$ErrorActionPreference = "SilentlyContinue"
Set-Location "D:\newcode\newa2m\server"
Write-Host "== Containers =="
docker compose ps
Write-Host "`n== MQTT Clients =="
docker compose exec emqx emqx ctl clients list
Write-Host "`n== Ingest (últimos 5 minutos) =="
docker compose logs ingest --since 5m
Write-Host "`n== DB count =="
docker compose exec timescale psql -U aura_user -d aura -c "SELECT COUNT(*) FROM telemetry_flat;"
Write-Host "`n== Latest per device =="
docker compose exec timescale psql -U aura_user -d aura -c "SELECT device_id, MAX(ts) AS last_ts FROM telemetry_flat GROUP BY device_id ORDER BY last_ts DESC LIMIT 10;"
Write-Host "`n== API health =="
Invoke-WebRequest -UseBasicParsing "http://localhost:8080/health" | Select-Object StatusCode, Content
Write-Host "`n== API stats =="
Invoke-WebRequest -UseBasicParsing "http://localhost:8080/stats" | Select-Object -Expand Content
