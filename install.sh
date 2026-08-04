#!/bin/bash
# yts 셀프호스팅 설치 — macOS 전용. 서버를 launchd에 등록해 로그인 시 자동 시작.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
fail() { echo "❌ $1"; exit 1; }

# 1) 필수 도구 확인
NODE_BIN="$(command -v node || true)"
[ -n "$NODE_BIN" ] || fail "node가 필요합니다 → https://nodejs.org (18 이상)"

CLAUDE_BIN="$(command -v claude || true)"
[ -n "$CLAUDE_BIN" ] || fail "Claude Code CLI가 필요합니다 → npm install -g @anthropic-ai/claude-code 후 터미널에서 'claude' 실행해 구독 계정으로 로그인"

# 2) yt-dlp — 없으면 자동 다운로드
YTDLP_BIN="$(command -v yt-dlp || true)"
[ -z "$YTDLP_BIN" ] && [ -x "$HOME/.local/bin/yt-dlp" ] && YTDLP_BIN="$HOME/.local/bin/yt-dlp"
if [ -z "$YTDLP_BIN" ]; then
  echo "yt-dlp 다운로드 중..."
  mkdir -p "$HOME/.local/bin"
  curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos -o "$HOME/.local/bin/yt-dlp"
  chmod +x "$HOME/.local/bin/yt-dlp"
  YTDLP_BIN="$HOME/.local/bin/yt-dlp"
fi

# 3) launchd 등록 (로그인 시 자동 시작 + 죽으면 재시작)
PLIST="$HOME/Library/LaunchAgents/com.yts.server.plist"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.yts.server</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${DIR}/server.mjs</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$(dirname "$NODE_BIN"):$(dirname "$CLAUDE_BIN"):$(dirname "$YTDLP_BIN"):/usr/local/bin:/usr/bin:/bin</string>
    <key>YTS_CLAUDE</key><string>${CLAUDE_BIN}</string>
    <key>YTS_YTDLP</key><string>${YTDLP_BIN}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/yts-server.log</string>
  <key>StandardErrorPath</key><string>/tmp/yts-server.log</string>
</dict>
</plist>
EOF
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

# 4) 확인
sleep 1
curl -sf -m 3 http://127.0.0.1:8790/ -o /dev/null -w "" 2>/dev/null || true
if curl -s -m 3 http://127.0.0.1:8790/ | grep -q "not found"; then
  echo "✅ 서버 실행 중 — http://127.0.0.1:8790"
  echo ""
  echo "다음 단계: Chrome → chrome://extensions → 개발자 모드 켜기 →"
  echo "'압축해제된 확장 프로그램을 로드합니다' → ${DIR}/extension 폴더 선택"
else
  fail "서버가 응답하지 않습니다. 로그 확인: /tmp/yts-server.log"
fi
