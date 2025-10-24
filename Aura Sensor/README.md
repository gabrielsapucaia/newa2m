# Aura Sensor

Aplicativo Android que coleta telemetria 1 Hz (GNSS, IMU, barômetro) e publica mensagens MQTT redundantes enquanto grava cópias locais (CSV e fila JSONL). Pensado para tablets industriais rodando em modo serviço em primeiro plano.

## Requisitos de ambiente

- Android Studio Giraffe+ ou Gradle CLI (`./gradlew`)
- Android SDK 34 / Build Tools 35.0.0
- Dispositivo Android com Android 8.0 (API 26) ou superior

## Configuração de credenciais

1. Copie `local.defaults.properties` para `local.properties` na raiz do projeto (não versionado):

   ```bash
   cp local.defaults.properties local.properties
   ```

2. Edite `local.properties` preenchendo os valores reais (URLs, usuários, senhas, keepalive, limpeza de sessão). Os campos são mapeados para `BuildConfig` pelo Gradle e ficam acessíveis em tempo de execução sem expor segredos no VCS.
   - `MQTT_DISCOVERY_PREFIX` e `MQTT_DISCOVERY_RANGE` (ex.: prefixo `192.168.0` e intervalo `100-150`) habilitam um scanner interno que tenta localizar automaticamente o broker na rede caso os hosts configurados não respondam. O tempo limite por host pode ser ajustado com `MQTT_DISCOVERY_TIMEOUT_MS` (padrão 300 ms).

3. Ajuste `ENABLE_LOCAL_BROKER` / `ENABLE_CLOUD_BROKER` para ativar cada destino MQTT.

## Execução

```bash
./gradlew installDebug
```

No primeiro uso, o aplicativo solicitará permissões (localização, sensores, reconhecimento de atividade) e pedirá para ser removido das otimizações de bateria.

## Estrutura principal

- `MainActivity`: UI de login de operador, start/stop, status.
- `service/TelemetryService`: Foreground service com ciclo 1 Hz.
- `sensors/ImuAggregator`, `gnss/GnssManager`: coleta e agregação dos sensores.
- `mqtt/MqttPublisher`: publicação redundante com fila offline (`storage/OfflineQueue`) e CSV (`storage/CsvWriter`).
- `model/TelemetryPayload`: payload JSON serializado com kotlinx-serialization.
- `boot/BootReceiver`: inicialização automática após boot.

Logs adicionais ficam em `aurasensor.log` dentro da pasta de arquivos externos (`Android/data/com.example.sensorlogger/files/telemetry`). CSV (`telemetry.csv`) e fila (`pending_mqtt.jsonl`) residem na mesma pasta.

## Ferramentas úteis

- `tools/find-broker.ps1`: script PowerShell que varre uma sub-rede (padrão `192.168.0.x`) em busca de brokers MQTT na porta 1883 e atualiza automaticamente `local.properties` (`MQTT_HOST` e `MQTT_ADDITIONAL_HOSTS`). Execute assim que o IP do servidor mudar:

  ```powershell
  powershell -ExecutionPolicy Bypass -File .\tools\find-broker.ps1
  ```

  Ajuste parâmetros (`-Subnet`, `-FromHost`, `-ToHost`, `-Port`) se sua rede usar outro intervalo.
