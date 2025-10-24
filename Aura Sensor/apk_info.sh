#!/usr/bin/env bash
set -euo pipefail

# Sempre rodar a partir da raiz do projeto
cd "/mnt/c/Users/gabriel.sapucaia/Desktop/SensorLogger"

# 1) Garantir que existe um APK de debug
DEFAULT_APK="app/build/outputs/apk/debug/app-debug.apk"

if [ ! -f "$DEFAULT_APK" ]; then
  echo "[info] Nenhum APK padrão; gerando assembleDebug..."
  ./gradlew assembleDebug
fi

# 2) Tentar primeiro o caminho padrão; se não existir, procurar
APK="$DEFAULT_APK"
if [ ! -f "$APK" ]; then
  APK="$(find . -type f -path '*/outputs/apk/*/debug/*.apk' -print -quit || true)"
fi

# 3) Validar
if [ -z "${APK:-}" ] || [ ! -f "$APK" ]; then
  echo "[erro] APK de debug não encontrado depois do build"
  exit 2
fi
echo "[ok] APK encontrado: $APK"

# 4) Pegar o aapt da build-tools mais nova
AAPT_VER="$(ls -1 "$ANDROID_SDK_ROOT/build-tools" | sort -V | tail -n1)"
AAPT="$ANDROID_SDK_ROOT/build-tools/$AAPT_VER/aapt"
echo "[info] aapt: $AAPT_VER"
"$AAPT" v >/dev/null

# 5) Mostrar package e activity lançável
"$AAPT" dump badging "$APK" | grep -E "package: name=|launchable-activity:"
