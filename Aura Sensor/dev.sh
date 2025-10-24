#!/usr/bin/env bash
set -e

# Garante ADB no PATH mesmo quando a task do VS Code não carrega o ~/.bashrc
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$HOME/android-sdk}"
export PATH="$ANDROID_SDK_ROOT/platform-tools:$ANDROID_SDK_ROOT/cmdline-tools/latest/bin:$PATH"

# AJUSTE AQUI se seu APK tiver outro caminho:
APK="app/build/outputs/apk/debug/app-debug.apk"

PKG="com.example.sensorlogger"
ACT=".MainActivity"

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

get_prop() {
  local key="$1"
  local file="$2"
  [ -f "$file" ] || return 0
  grep -E "^${key}=" "$file" | tail -n 1 | cut -d'=' -f2-
}

MQTT_HOST="$(get_prop "MQTT_HOST" "$project_dir/local.properties")"
[ -n "$MQTT_HOST" ] || MQTT_HOST="$(get_prop "MQTT_HOST" "$project_dir/local.defaults.properties")"
MQTT_HOST="${MQTT_HOST:-127.0.0.1}"

case "$1" in
  connect)
    adb kill-server >/dev/null 2>&1 || true
    adb start-server
    adb connect "${MQTT_HOST}:5555" || true
    adb devices
    ;;
  build)
    ./gradlew assembleDebug
    ;;
  install)
    [ -f "$APK" ] || { echo "APK não encontrado em $APK"; exit 1; }
    adb install -r "$APK"
    ;;
  start)
    adb shell am start -n "$PKG/$ACT"
    ;;
  run)
    ./gradlew assembleDebug
    [ -f "$APK" ] || { echo "APK não encontrado em $APK"; exit 1; }
    adb install -r "$APK"
    adb shell am start -n "$PKG/$ACT"
    ;;
  log)
    adb logcat
    ;;
  *)
    echo "Uso: ./dev.sh {connect|build|install|start|run|log}"
    exit 1
    ;;
esac
