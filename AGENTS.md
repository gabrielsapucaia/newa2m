# Repository Guidelines

## Project Structure & Module Organization
The Android app lives under `app/`. Kotlin sources sit in `app/src/main/java/com/example/sensorlogger`, grouped by feature packages such as `service`, `mqtt`, and `storage`. XML layouts, drawables, and configuration live in `app/src/main/res`. JVM unit tests reside in `app/src/test`, while instrumentation tests target `app/src/androidTest`. Shell helpers (`dev.sh`, `verify_all.sh`) stay at the root, and PowerShell utilities live in `tools/`. Secrets and environment overrides belong in `local.properties`; keep only sanitized defaults in VCS.

## Build, Test, and Development Commands
- `./gradlew assembleDebug` builds the debug APK (`./dev.sh build` wraps it). No Windows: use `cmd /c gradlew.bat` para evitar loops do PowerShell.
- `./dev.sh run` builds, installs, and launches against the device configured in `local.properties`.
- `./gradlew lint` executes Android/Kotlin lint; watch for warnings even though `abortOnError=false`.
- `./gradlew testDebugUnitTest` runs JVM tests; `./gradlew connectedAndroidTest` exercises instrumentation cases (device/emulator required).
- `./verify_all.sh` performs the full pre-flight: environment probes, assemble, install, and smoke start.

## Coding Style & Naming Conventions
Follow Kotlin official style: 4-space indents, trailing commas in multiline builders, and prefer `val` plus expression bodies for concise functions. Keep package names aligned with the existing domain folders. Use PascalCase for classes, camelCase for members, and snake_case for XML resources. Favor coroutines/Flows over manual threads. When introducing new Gradle config keys, mirror the existing `buildConfigField` pattern so values flow into `BuildConfig` consistently.

## Testing Guidelines
-Place JVM logic tests in `app/src/test/java` and service/UI flows in `app/src/androidTest/java`. Name methods using `subject_shouldExpectation` to match current style. Provide fakes for sensor inputs and MQTT brokers instead of touching hardware. Extend telemetry fixtures alongside the tests that consume them. Run `./gradlew testDebugUnitTest connectedAndroidTest` before pushing and capture emulator or device logs when investigating flaky behavior. Em Android 14+, garanta que `ACCESS_FINE_LOCATION`/`ACCESS_BACKGROUND_LOCATION` estejam concedidas antes de iniciar o servico (`TelemetryService` aborta sem elas).

## Commit & Pull Request Guidelines
Use Conventional Commits in imperative mood: `feat(service): add MQTT backoff`. Keep scopes aligned with feature folders (`mqtt`, `storage`, `ui`). Limit a commit to a single concern and reference tracker IDs with `Refs #123` when relevant. Pull requests should summarize the change set, list the build/test commands executed, call out configuration impacts (e.g., new `local.properties` keys), and attach screenshots or log extracts for UI or background behavior changes. Request review from the maintainer owning the affected area and wait for CI to pass before merge.

## Security & Configuration Tips
Do not commit `local.properties`; rely on `local.defaults.properties` for non-sensitive defaults. Rotate MQTT credentials in your untracked copy only. Run `tools/find-broker.ps1` whenever the broker subnet changes and verify the generated hosts before documenting them. Remove captured telemetry or logs from the workspace prior to committing.
