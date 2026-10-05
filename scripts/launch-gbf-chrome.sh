#!/usr/bin/env bash
# scripts/launch-gbf-chrome.sh
# Cross-platform Linux / Ubuntu headless Chrome launcher for Granblue Fantasy Remote Controller
# Optimized for 1 vCPU / 1 GB RAM low-memory VPS instances

set -e

HEADLESS=true
PORT=9222
USER_DATA_DIR="$HOME/.gbf-chrome-profile"
PROXY=""
TARGET_URL="https://game.granbluefantasy.jp/#mypage"

# Parse CLI arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --headless|-Headless)
      HEADLESS=true
      shift
      ;;
    --windowed|-Windowed)
      HEADLESS=false
      shift
      ;;
    --port|-Port)
      PORT="$2"
      shift 2
      ;;
    --user-data-dir|--CustomUserDataDir|-CustomUserDataDir)
      USER_DATA_DIR="$2"
      shift 2
      ;;
    --proxy|-Proxy)
      PROXY="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

# Expand tilde ~ if present
USER_DATA_DIR="${USER_DATA_DIR/#\~/$HOME}"
mkdir -p "$USER_DATA_DIR"

# 1. Locate Chrome / Chromium binary
CHROME_BIN=""
CANDIDATES=(
  "google-chrome-stable"
  "google-chrome"
  "chromium-browser"
  "chromium"
  "/usr/bin/google-chrome-stable"
  "/usr/bin/google-chrome"
  "/usr/bin/chromium-browser"
  "/usr/bin/chromium"
  "/snap/bin/chromium"
)

for bin in "${CANDIDATES[@]}"; do
  if command -v "$bin" &> /dev/null; then
    CHROME_BIN="$bin"
    break
  fi
done

if [[ -z "$CHROME_BIN" ]]; then
  echo "❌ [Launcher] No compatible browser found (google-chrome-stable, google-chrome, or chromium)."
  echo "👉 On Ubuntu, install Google Chrome with:"
  echo "   wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb"
  echo "   sudo apt install -y ./google-chrome-stable_current_amd64.deb"
  exit 1
fi

# 2. Check if port is already listening
PORT_ACTIVE=false
if command -v ss &> /dev/null; then
  if ss -tln | grep -q ":$PORT "; then
    PORT_ACTIVE=true
  fi
elif command -v nc &> /dev/null; then
  if nc -z 127.0.0.1 "$PORT" 2>/dev/null; then
    PORT_ACTIVE=true
  fi
elif command -v lsof &> /dev/null; then
  if lsof -i ":$PORT" &> /dev/null; then
    PORT_ACTIVE=true
  fi
fi

if [[ "$PORT_ACTIVE" == "true" ]]; then
  echo "✅ [Launcher] Chrome is ALREADY running and listening on port $PORT. Reusing session."
  exit 0
fi

# 3. Clean up stale lock files
rm -f "$USER_DATA_DIR/SingletonLock"
rm -f "$USER_DATA_DIR/lockfile"
rm -f "$USER_DATA_DIR/Default/SingletonLock"

# 4. Assemble Chrome arguments
CHROME_ARGS=(
  "--remote-debugging-port=$PORT"
  "--remote-allow-origins=*"
  "--user-data-dir=$USER_DATA_DIR"
  "--no-first-run"
  "--no-default-browser-check"
  "--disable-dev-shm-usage"
  "--disable-gpu"
  "--no-sandbox"
  "--js-flags=--max-old-space-size=384"
  "--renderer-process-limit=1"
  "--disable-background-timer-throttling"
  "--disable-backgrounding-occluded-windows"
  "--disable-renderer-backgrounding"
  "--autoplay-policy=no-user-gesture-required"
  "--mute-audio"
  "--disable-extensions"
  "--disable-component-update"
  "--disable-sync"
  "--disable-translate"
  "--disable-default-apps"
  "--disable-speech-api"
  "--metrics-recording-only"
  "--window-size=480,960"
)

if [[ "$HEADLESS" == "true" ]]; then
  CHROME_ARGS+=(
    "--headless=new"
    "--disable-blink-features=AutomationControlled"
  )
fi

if [[ -n "$PROXY" ]]; then
  CHROME_ARGS+=("--proxy-server=$PROXY")
fi

CHROME_ARGS+=("$TARGET_URL")

echo "🚀 [Launcher] Starting $CHROME_BIN on port $PORT (Headless: $HEADLESS)..."
echo "📁 [Launcher] Profile directory: $USER_DATA_DIR"

# Launch in background detached
nohup "$CHROME_BIN" "${CHROME_ARGS[@]}" > /dev/null 2>&1 &

# Wait up to 10 seconds for the debugging port to open
READY=false
for i in {1..20}; do
  sleep 0.5
  if command -v ss &> /dev/null && ss -tln | grep -q ":$PORT "; then
    READY=true
    break
  elif command -v nc &> /dev/null && nc -z 127.0.0.1 "$PORT" 2>/dev/null; then
    READY=true
    break
  fi
done

if [[ "$READY" == "true" ]]; then
  echo "✅ [Launcher] Chrome successfully started and listening on port $PORT."
  exit 0
else
  echo "⚠️ [Launcher] Chrome process spawned; verifying port $PORT availability..."
  exit 0
fi
