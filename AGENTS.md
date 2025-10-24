# Repository Guidelines

## Project Structure & Module Organization
The Android client (“Aura Sensor”) permanece em `Aura Sensor/` com código Kotlin em `app/src/main/java` organizado por áreas (`service`, `mqtt`, `storage`). Recursos Android ficam em `app/src/main/res`, enquanto testes estão em `app/src/test` (unit) e `app/src/androidTest` (instrumentados). Toda a infraestrutura de backend mora em `server/`: `docker-compose.yml` orquestra EMQX, TimescaleDB, MinIO, e os serviços Python (`services/ingest` e `services/api`). Scripts operacionais residem em `server/scripts` (status, psql, criação de usuários EMQX), e o esquema SQL inicial em `server/sql/init`. Backups ficam versionados em `server/backups/<data>/`.

## Build, Test, and Development Commands
- Android: `./gradlew assembleDebug` ou `cmd /c gradlew.bat assembleDebug` (Windows). `./gradlew lint`, `./gradlew testDebugUnitTest` e `./gradlew connectedAndroidTest` cobrem lint, unitários e instrumentação. `./dev.sh run` encapsula build + deploy.
- Backend: `cd server` e use `docker compose up -d --build` para subir toda a stack; `docker compose logs <service>` acompanha ingest/API. Testes rápidos: `Invoke-WebRequest http://localhost:8080/health`, `.../stats`, e `python scripts/simulate_publish.py` para gerar telemetria sintética. `scripts/status.ps1` consolida containers, MQTT, banco e API.

## Coding Style & Naming Conventions
- Kotlin segue guia oficial (4 espaços, `val` preferencial, nomes PascalCase/camelCase). Gradle: mantenha chaves em `buildConfigField` alinhadas aos padrões existentes.
- Python (ingest/API): PEP 8 com 4 espaços; mensagens de log devem indicar origem (`[ingest]`, `[api]`). Dê preferência a funções puras reutilizáveis e fechamentos explícitos de conexões psycopg (usamos context manager).
- SQL: views e índices nomeados descritivamente (`v_telemetry_enriched`, `idx_payload_gin`). Evite DDL fora dos scripts versionados.

## Testing & Observability
Valide o ingest com `python scripts/simulate_publish.py` e confira `docker compose exec timescale psql -U aura_user -d aura -c "SELECT COUNT(*) FROM telemetry_flat;"`. Para diagnósticos de MQTT use `docker compose exec emqx emqx ctl clients list`. A API opera sobre a view `v_telemetry_enriched`; use `Invoke-WebRequest` ou `curl` nos endpoints `/devices/<id>/last`, `/series`, `/stats` garantindo que `lat/lon/speed/cn0_avg/sats_used` nunca retornem nulos. Backfills históricos podem ser refeitos executando os updates documentados em `scripts/psql.ps1`.

## Commit & Pull Request Guidelines
Adote Conventional Commits (`feat(api): ...`, `chore(backups): ...`). Cada batelada encerra com `git add -A && git commit -m "Checkpoint: ..."`; tags relevantes (ex.: `snapshot_prod_<data>`, `api_use_v_telemetry_enriched`) facilitam rollbacks. PRs devem descrever escopo, comandos executados, impacto em infra (novos índices, views, scripts) e incluir capturas de API ou logs MQTT quando úteis. Aguarde CI/manual checks e peça review do guardião da área (Android ou Backend) antes de merge.

## Operations & Security Notes
Armazene credenciais reais apenas em `.env` locais (não commitados); `server/.env` traz valores de desenvolvimento. Credenciais EMQX são gerenciadas por `scripts/emqx_add_user.ps1`. Faça mirror do bucket MinIO conforme documentação na Batelada 5 (`mc alias` + `mc mirror`). Antes de gerar snapshots, garanta que simuladores estejam desligados (`taskkill /IM python.exe /F`) para capturar somente tablets reais. Limpe logs sensíveis e dados PII antes de versionar backups.
