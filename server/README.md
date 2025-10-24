# Aura Sensor Backend

Backend de ingest�o e consulta de telemetria para o projeto **Aura Sensor**. Implementado em Python (FastAPI) com suporte a PostgreSQL, mas operando em modo padr�o com SQLite para desenvolvimento local e testes.

## Estrutura inicial

`
server/
  ├── requirements.txt          # Depend�ncias de execu��o
  ├── requirements-dev.txt      # Depend�ncias adicionais de desenvolvimento/testes
  ├── src/aura_server/          # C�digo-fonte da aplica��o
  └── tests/                    # Testes automatizados (pytest)
`

## Ambiente recomendado

1. Criar ambiente virtual:
   `powershell
   cd D:\newcode\newa2m\server
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   `
2. Instalar depend�ncias de desenvolvimento:
   `powershell
   python -m pip install --upgrade pip
   python -m pip install -r requirements-dev.txt
   `
3. Executar testes:
   `powershell
   python -m pytest
   `
4. Executar a aplica��o em modo desenvolvimento (SQLite local):
   `powershell
   uvicorn aura_server.main:app --reload --host 0.0.0.0 --port 8000
   `

## Configura��o via vari�veis de ambiente

O arquivo ura_server/config.py usa pydantic-settings para ler vari�veis de ambiente ou .env. Principais ajustes:

- DATABASE_URL: URL completa SQLAlchemy (padr�o: sqlite+aiosqlite:///./data/aura.db).
- API_V1_PREFIX: prefixo das rotas de API (padr�o: /api/v1).
- AUTH_USERNAME / AUTH_PASSWORD: credenciais que ser�o usadas pelos dispositivos (padr��o: device-test / devpass).

## Pr�ximos passos planejados

- Modelagem das entidades de telemetria e camadas de reposit�rio.
- Middleware de autentica��o b�sica para os dispositivos.
- Integra��o com PostgreSQL via Docker Compose e migrations com Alembic.
- Painel/endpoint de health check detalhado.

## Recursos futuros

Este backend ir� consumir dados MQTT consolidados (via worker) ou requisi��es HTTP diretas do aplicativo. A arquitetura final ser� definida nas pr�ximas bateladas.
