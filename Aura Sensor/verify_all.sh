#!/usr/bin/env bash
set -euo pipefail

# ===== cores =====
GREEN='\e[32m'; RED='\e[31m'; YELLOW='\e[33m'; BLUE='\e[34m'; NC='\e[0m'
ok(){ echo -e "${GREEN}[OK]${NC} $*"; }
warn(){ echo -e "${YELLOW}[WARN]${NC} $*"; }
fail(){ echo -e "${RED}[FAIL]${NC} $*"; RES=1; }
step(){ echo -e "\n${BLUE}==> $*${NC}"; }

RES=0

# ===== ambiente mínimo para ADB em shell "seco" =====
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$HOME/android-sdk}"
export PATH="$ANDROID_SDK_ROOT/platform-tools:$ANDROID_SDK_ROOT/cmdline-tools/latest/bin:$PATH"

# ===== helpers =====
latest_build_tools() { ls -1 "$ANDROID_SDK_ROOT/build-tools" 2>/dev/null | sort -V | tail -n1; }
find_debug_apk() {
  local a
  a="$(find . -type f -path '*/outputs/apk/*/debug/*.apk' -print0 2>/dev/null | xargs -0 -r ls -1t | head -n1 || true)"
  if [ -z "${a:-}" ] && [ -f "app/build/outputs/apk/debug/app-debug.apk" ]; then
    a="app/build/outputs/apk/debug/app-debug.apk"
  fi
  echo "$a"
}

# ===== 1) sistema & path =====
step "Sistema & variáveis"
cat /etc/os-release | sed -n '1,4p' || true
echo "JAVA_HOME=${JAVA_HOME:-<unset>}"
echo "ANDROID_SDK_ROOT=${ANDROID_SDK_ROOT:-<unset>}"
echo "PATH (android trechos):"
echo "$PATH" | tr ':' '\n' | grep -E 'android-sdk|platform-tools|cmdline-tools' -n || true

# ===== 2) ferramentas base =====
step "Ferramentas base"
(java -version >/dev/null 2>&1 && ok "Java: $(java -version 2>&1 | head -n1)") || fail "Java ausente"
(javac -version >/dev/null 2>&1 && ok "Javac: $(javac -version 2>&1)") || warn "Javac ausente"
(node -v >/dev/null 2>&1 && ok "Node: $(node -v)") || fail "Node ausente"
(npm -v >/dev/null 2>&1 && ok "npm: $(npm -v)") || warn "npm ausente"
(codex --version >/dev/null 2>&1 && ok "Codex CLI: $(codex --version)") || warn "Codex CLI não encontrado (opcional)"

# ===== 3) sdk/android tools =====
step "Android SDK (adb / sdkmanager / aapt)"
(if which adb >/dev/null 2>&1; then ok "adb: $(adb version | head -n1)"; else fail "adb não encontrado"; fi)
(if which sdkmanager >/dev/null 2>&1; then ok "sdkmanager OK"; else fail "sdkmanager não encontrado"; fi)

BT_VER="$(latest_build_tools || true)"
if [ -n "$BT_VER" ] && [ -x "$ANDROID_SDK_ROOT/build-tools/$BT_VER/aapt" ]; then
  ok "aapt: $BT_VER"
else
  fail "aapt não encontrado em build-tools (instale: sdkmanager 'build-tools;34.0.0' ou 35)"
fi

# ===== 4) device =====
step "Conexão ADB (Wi-Fi)"
adb kill-server >/dev/null 2>&1 || true
adb start-server >/dev/null
adb connect 192.168.0.114:5555 >/dev/null 2>&1 || true
if adb devices | grep -q "192\.168\.0\.114:5555.*device"; then
  ok "Device conectado (192.168.0.114:5555)"
else
  fail "Device não conectado (rode: ./dev.sh connect)"
fi

# ===== 5) projeto =====
step "Projeto Android (gradlew)"
if [ -f "./gradlew" ]; then
  chmod +x ./gradlew || true
  ok "gradlew encontrado"
else
  fail "gradlew não encontrado na raiz do projeto"
fi

# ===== 6) build =====
step "Build assembleDebug"
if ./gradlew assembleDebug >/dev/null 2>&1; then
  ok "assembleDebug OK"
else
  fail "Falha no assembleDebug (veja logs sem redirecionar)"
fi

# ===== 7) localizar APK =====
step "Localizar APK de debug"
APK="$(find_debug_apk)"
if [ -n "$APK" ] && [ -f "$APK" ]; then
  ok "APK: $APK"
else
  fail "APK de debug não encontrado"
fi

# ===== 8) metadados do APK =====
step "Metadados (package/activity)"
if [ -n "${APK:-}" ] && [ -f "$APK" ] && [ -n "$BT_VER" ]; then
  PKG="$("$ANDROID_SDK_ROOT/build-tools/$BT_VER/aapt" dump badging "$APK" | sed -n "s/.*package: name='\([^']*\)'.*/\1/p" | head -n1)"
  ACT="$("$ANDROID_SDK_ROOT/build-tools/$BT_VER/aapt" dump badging "$APK" | sed -n "s/.*launchable-activity: name='\([^']*\)'.*/\1/p" | head -n1)"
  echo "PKG=$PKG"
  echo "ACT=$ACT"
  [ -n "$PKG" ] && [ -n "$ACT" ] && ok "aapt dump OK" || fail "Falha lendo package/activity com aapt"
fi

# ===== 9) instalar & iniciar =====
step "Instalação e start"
if [ -n "${APK:-}" ] && [ -f "$APK" ]; then
  if adb install -r "$APK" >/dev/null 2>&1; then
    ok "Instalação OK"
  else
    warn "Instalação falhou (tentando uninstall + install)"
    if [ -n "${PKG:-}" ]; then adb uninstall "$PKG" >/dev/null 2>&1 || true; fi
    adb install -r "$APK" >/dev/null 2>&1 && ok "Reinstalação OK" || fail "Instalação falhou"
  fi
  if [ -n "${PKG:-}" ] && [ -n "${ACT:-}" ]; then
    adb shell am start -n "$PKG/$ACT" >/dev/null 2>&1 && ok "App iniciado ($PKG/$ACT)" || fail "Falha ao iniciar Activity"
  fi
else
  warn "Pulando instalação/start por falta de APK"
fi

# ===== 10) diagnósticos rápidos =====
step "Diagnósticos rápidos"
adb shell getprop ro.product.model 2>/dev/null | sed 's/^/[model] /' || true
adb shell getprop ro.build.version.release 2>/dev/null | sed 's/^/[android] /' || true
adb logcat -d 2>/dev/null | head -n 5 | sed 's/^/[log] /' || true

# ===== resumo =====
echo -e "\n==== RESUMO ===="
if [ "$RES" -eq 0 ]; then
  echo -e "${GREEN}Todos os checks passaram!${NC}"
else
  echo -e "${RED}Alguns checks falharam. Role acima e procure por [FAIL].${NC}"
fi
exit "$RES"
