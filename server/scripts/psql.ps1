param([string] = "SELECT now();")
docker compose exec timescale psql -U aura_user -d aura -c 
