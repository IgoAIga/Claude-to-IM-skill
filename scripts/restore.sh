#!/usr/bin/env bash
# restore.sh — 포맷 후 claude-to-im 스킬 복원 스크립트
#
# 사용법:
#   curl -fsSL https://raw.githubusercontent.com/IgoAIga/Claude-to-IM-skill/main/scripts/restore.sh | bash
#   또는:
#   ./restore.sh
#
# 필요 사항:
#   - Node.js 22+
#   - codex CLI 설치됨 (npm i -g @openai/codex)
#   - ~/.codex/skills/claude-to-im/config.env (API 키 등 별도 복원 필요)

set -euo pipefail

REPO="https://github.com/IgoAIga/Claude-to-IM-skill.git"
SKILL_DIR="$HOME/.codex/skills/claude-to-im"
UPSTREAM="https://github.com/op7418/Claude-to-IM-skill.git"

echo "=== claude-to-im 스킬 복원 시작 ==="

# 1. 클론
if [[ -d "$SKILL_DIR/.git" ]]; then
  echo "[1/5] 기존 설치 감지, pull..."
  cd "$SKILL_DIR"
  git pull origin main
else
  echo "[1/5] 클론 중..."
  mkdir -p "$(dirname "$SKILL_DIR")"
  git clone "$REPO" "$SKILL_DIR"
  cd "$SKILL_DIR"
  git remote add upstream "$UPSTREAM" 2>/dev/null || true
fi

# 2. 의존성 설치
echo "[2/5] npm install..."
npm install

# 3. 빌드
echo "[3/5] 빌드..."
npm run build

# 4. codex-tui 심볼릭 링크
echo "[4/6] codex-tui 명령어 등록..."
mkdir -p "$HOME/.local/bin"
ln -sf "$SKILL_DIR/scripts/codex-tui.sh" "$HOME/.local/bin/codex-tui"

# 5. systemd user service 등록
echo "[5/6] systemd 서비스 등록..."
mkdir -p "$HOME/.config/systemd/user"
cp "$SKILL_DIR/scripts/claude-to-im.service" "$HOME/.config/systemd/user/"
if systemctl --user is-system-running &>/dev/null; then
  systemctl --user daemon-reload
  systemctl --user enable claude-to-im
  echo "   systemd 등록 완료. 시작: systemctl --user start claude-to-im"
else
  echo "   systemd 사용 불가. 수동 시작: setsid nohup node dist/daemon.mjs &"
fi

# 6. config.env 확인
if [[ ! -f "$SKILL_DIR/config.env" ]]; then
  echo ""
  echo "⚠  config.env가 없습니다. 아래 파일을 참고해서 생성하세요:"
  echo "   $SKILL_DIR/config.env.example"
  echo ""
  echo "   필수 항목:"
  echo "   - CTI_DISCORD_BOT_TOKEN"
  echo "   - CTI_DISCORD_ALLOWED_CHANNELS"
  echo "   - OPENAI_API_KEY (Codex용)"
  echo ""
fi

echo "=== 복원 완료 ==="
echo ""
echo "데몬 시작:  cd $SKILL_DIR && nohup node dist/daemon.mjs &"
echo "TUI 접속:   codex-tui"
echo "포트 변경:  CTI_CODEX_WS_PORT=9100 (기본값)"
