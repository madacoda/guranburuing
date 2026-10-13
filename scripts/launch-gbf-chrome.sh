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

FORCE_RESTART=false

# Parse CLI arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --force|--restart|-Force|-Restart)
      FORCE_RESTART=true
      shift
      ;;
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
  "/usr/bin/google-chrome-stable"
  "/usr/bin/google-chrome"
  "/opt/google/chrome/google-chrome"
  "/opt/google/chrome/chrome"
  "chromium-browser"
  "chromium"
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

# 2. Check if port is already listening AND responsive to CDP
PORT_ACTIVE=false
VERSION_RESP=$(curl -s -m 2 "http://127.0.0.1:$PORT/json/version" 2>/dev/null || true)

if [[ -n "$VERSION_RESP" && "$VERSION_RESP" == *"webSocketDebuggerUrl"* ]]; then
  PORT_ACTIVE=true
fi

if [[ "$PORT_ACTIVE" == "true" && "$FORCE_RESTART" != "true" ]]; then
  echo "✅ [Launcher] Chrome is ALREADY running and responsive on port $PORT. Reusing session."
  exit 0
else
  # If port was bound by something else or a dead/frozen Chrome zombie or force-restart requested, clean it up!
  echo "🧹 [Launcher] Resetting port $PORT sockets and processes (Force: $FORCE_RESTART)..."
  if command -v fuser &> /dev/null; then
    fuser -k -n tcp "$PORT" 2>/dev/null || true
  fi
  if command -v lsof &> /dev/null; then
    lsof -ti :"$PORT" | xargs -r kill -9 2>/dev/null || true
  fi
  pkill -9 -f "remote-debugging-port=$PORT" 2>/dev/null || true
  sleep 0.5
fi

# 3. Clean up stale lock and socket files from ungraceful shutdowns / OOMs
rm -f "$USER_DATA_DIR"/Singleton* "$USER_DATA_DIR"/*/Singleton* "$USER_DATA_DIR"/lockfile "$USER_DATA_DIR"/*/lockfile 2>/dev/null || true

# 4. Hardware-aware dynamic resource allocation (Optimized for 2 vCPU / 2GB RAM Production VPS)
TOTAL_RAM_MB=$(free -m 2>/dev/null | awk '/^Mem:/{print $2}' || echo 1024)
CPU_CORES=$(nproc 2>/dev/null || echo 1)

if [[ "$TOTAL_RAM_MB" -ge 1800 ]]; then
  # 2GB+ RAM VPS (Production Profile)
  V8_HEAP_MB=${V8_MAX_OLD_SPACE:-1024}
  DISK_CACHE_BYTES=${DISK_CACHE_SIZE:-536870912} # 512MB persistent game asset cache
  RENDERER_PROC_LIMIT=${RENDERER_LIMIT:-2}
else
  # 1GB RAM Low-Spec Fallback
  V8_HEAP_MB=${V8_MAX_OLD_SPACE:-384}
  DISK_CACHE_BYTES=${DISK_CACHE_SIZE:-104857600} # 100MB
  RENDERER_PROC_LIMIT=${RENDERER_LIMIT:-1}
fi

# Viewport: 360x720 cuts software rasterization pixels by ~44% vs 480x960
TARGET_WINDOW_SIZE=${WINDOW_SIZE:-"360,720"}

# Shared memory check: If /dev/shm >= 256MB, use lightning-fast RAM IPC instead of disk /tmp
SHM_ARGS=()
SHM_AVAILABLE_MB=$(df -m /dev/shm 2>/dev/null | awk 'NR==2 {print $2}' || echo 0)
if [[ "$SHM_AVAILABLE_MB" -lt 256 ]]; then
  SHM_ARGS+=("--disable-dev-shm-usage")
fi

CHROME_ARGS=(
  "--remote-debugging-port=$PORT"
  "--remote-allow-origins=*"
  "--user-data-dir=$USER_DATA_DIR"
  "--no-first-run"
  "--no-default-browser-check"
  "--disable-gpu"
  "--no-sandbox"
  "--password-store=basic"
  "--use-mock-keychain"
  "--js-flags=--max-old-space-size=$V8_HEAP_MB"
  "--renderer-process-limit=$RENDERER_PROC_LIMIT"
  "--disable-background-timer-throttling"
  "--disable-backgrounding-occluded-windows"
  "--disable-renderer-backgrounding"
  "--autoplay-policy=no-user-gesture-required"
  "--mute-audio"
  "--test-third-party-cookie-phaseout=disabled"
  "--disable-extensions"
  "--disable-component-update"
  "--disable-sync"
  "--disable-translate"
  "--disable-default-apps"
  "--disable-speech-api"
  "--disable-breakpad"
  "--disable-features=Translate,OptimizationHints,MediaRouter,ForceThirdPartyCookieBlockingEnabled,ThirdPartyCookieDeprecationTrial,BlockThirdPartyCookies,ThirdPartyStoragePartitioning,TrackingProtection3pcd,PartitionedCookies,CalculateNativeWinOcclusion,InterestFeedContentSuggestions"
  "--enable-features=NetworkService,NetworkServiceInProcess"
  "--disable-gpu-vsync"
  "--run-all-compositor-stages-before-draw=false"
  "--metrics-recording-only"
  "--window-size=$TARGET_WINDOW_SIZE"
  "--disk-cache-size=$DISK_CACHE_BYTES"
  "${SHM_ARGS[@]}"
)

WRAPPER_CMD=()
if [[ "$HEADLESS" == "true" ]]; then
  CHROME_ARGS+=(
    "--headless=new"
    "--disable-blink-features=AutomationControlled"
    "--enable-unsafe-swiftshader"
    "--use-gl=angle"
    "--use-angle=swiftshader"
  )
else
  # Windowed mode requested on Linux
  if [[ -z "$DISPLAY" ]]; then
    if command -v xvfb-run &> /dev/null; then
      echo "💡 [Launcher] No physical display ($DISPLAY) detected on VPS. Wrapping with xvfb-run virtual display..."
      WRAPPER_CMD=("xvfb-run" "-a" "-s" "-screen 0 1280x1024x24")
    else
      echo "⚠️ [Launcher] Windowed mode requested on headless VPS, but no DISPLAY or xvfb-run found."
      echo "👉 Gracefully falling back to --headless=new to prevent crash."
      echo "👉 Tip: Install Xvfb for virtual display: sudo apt-get install -y xvfb"
      CHROME_ARGS+=(
        "--headless=new"
        "--disable-blink-features=AutomationControlled"
        "--enable-unsafe-swiftshader"
        "--use-gl=angle"
        "--use-angle=swiftshader"
      )
    fi
  fi
fi

if [[ -n "$PROXY" ]]; then
  CHROME_ARGS+=("--proxy-server=$PROXY")
fi

CHROME_ARGS+=("$TARGET_URL")

echo "🚀 [Launcher] Starting $CHROME_BIN on port $PORT (Headless: $HEADLESS)..."
echo "📁 [Launcher] Profile directory: $USER_DATA_DIR"

# Launch in background detached (with optional xvfb wrapper)
if [[ ${#WRAPPER_CMD[@]} -gt 0 ]]; then
  nohup "${WRAPPER_CMD[@]}" "$CHROME_BIN" "${CHROME_ARGS[@]}" > /dev/null 2>&1 &
else
  nohup "$CHROME_BIN" "${CHROME_ARGS[@]}" > /dev/null 2>&1 &
fi

# Wait up to 10 seconds for the debugging port to open
READY=false
for i in {1..20}; do
  sleep 0.5
  if curl -s -m 1 "http://127.0.0.1:$PORT/json/version" &> /dev/null; then
    READY=true
    break
  elif command -v ss &> /dev/null && ss -tln | grep -qE "[:.]$PORT\b"; then
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
