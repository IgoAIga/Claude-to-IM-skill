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
#   - ~/.claude-to-im/config.env (API 키 등 별도 복원 필요)

set -euo pipefail

REPO="https://github.com/IgoAIga/Claude-to-IM-skill.git"
SKILL_DIR="$HOME/.codex/skills/claude-to-im"
UPSTREAM="https://github.com/op7418/Claude-to-IM-skill.git"
CORE_REPO="https://github.com/op7418/Claude-to-IM.git"
CORE_DIR="$HOME/.codex/skills/Claude-to-IM"
PATCH_FILE="$SKILL_DIR/patches/claude-to-im-custom.patch"

echo "=== claude-to-im 스킬 복원 시작 ==="

apply_core_patch() {
  if [[ ! -f "$PATCH_FILE" ]]; then
    echo "   커스텀 패치 파일이 없습니다: $PATCH_FILE"
    exit 1
  fi

  if git -C "$CORE_DIR" apply --reverse --check "$PATCH_FILE" >/dev/null 2>&1; then
    echo "   코어 패치 이미 적용됨"
    return
  fi

  echo "   코어 패치 적용..."
  git -C "$CORE_DIR" apply --3way "$PATCH_FILE"
}

# 1. 클론
if [[ -d "$SKILL_DIR/.git" ]]; then
  echo "[1/7] 기존 설치 감지, pull..."
  cd "$SKILL_DIR"
  git pull origin main
else
  echo "[1/7] 클론 중..."
  mkdir -p "$(dirname "$SKILL_DIR")"
  git clone "$REPO" "$SKILL_DIR"
  cd "$SKILL_DIR"
  git remote add upstream "$UPSTREAM" 2>/dev/null || true
fi

# 2. 코어 라이브러리 확보 + 패치
if [[ -d "$CORE_DIR/.git" ]]; then
  echo "[2/7] 코어 라이브러리 기존 설치 감지"
else
  echo "[2/7] 코어 라이브러리 클론..."
  git clone "$CORE_REPO" "$CORE_DIR"
fi
apply_core_patch

# 3. 코어 빌드
echo "[3/7] 코어 npm install + build..."
cd "$CORE_DIR"
npm install
npm run build

# 4. 스킬 의존성 설치
echo "[4/7] 스킬 npm install..."
cd "$SKILL_DIR"
npm install

# 5. 스킬 빌드
echo "[5/7] 스킬 빌드..."
npm run build

# 6. codex-tui 심볼릭 링크
echo "[6/7] codex-tui 명령어 등록..."
mkdir -p "$HOME/.local/bin"
ln -sf "$SKILL_DIR/scripts/codex-tui.sh" "$HOME/.local/bin/codex-tui"

# 7. systemd user service 등록
echo "[7/7] systemd 서비스 등록..."
mkdir -p "$HOME/.config/systemd/user"
cp "$SKILL_DIR/scripts/claude-to-im.service" "$HOME/.config/systemd/user/"
if systemctl --user is-system-running &>/dev/null; then
  systemctl --user daemon-reload
  systemctl --user enable claude-to-im
  if systemctl --user is-active claude-to-im >/dev/null 2>&1; then
    systemctl --user restart claude-to-im
    echo "   systemd 등록 완료. 기존 서비스 재시작 완료"
  else
    echo "   systemd 등록 완료. 시작: systemctl --user start claude-to-im"
  fi
else
  echo "   systemd 사용 불가. 수동 시작: setsid nohup node dist/daemon.mjs &"
fi

# 8. config.env 확인
if [[ ! -f "$HOME/.claude-to-im/config.env" ]]; then
  echo ""
  echo "⚠  ~/.claude-to-im/config.env 가 없습니다. 아래 파일을 참고해서 생성하세요:"
  echo "   $SKILL_DIR/config.env.example"
  echo ""
  echo "   필수 항목:"
  echo "   - CTI_DISCORD_BOT_TOKEN"
  echo "   - CTI_DISCORD_ALLOWED_CHANNELS"
  echo "   - OPENAI_API_KEY (Codex용)"
  echo "   - CTI_RUNTIME=codex"
  echo "   - CTI_DISCORD_STREAM_ENABLED=false"
  echo "   - CTI_DISCORD_FORWARD_PREFIX=[DC]"
  echo "   - CTI_DISCORD_START_MESSAGE=false"
  echo ""
fi

echo "=== 복원 완료 ==="
echo ""
echo "데몬 시작:  systemctl --user start claude-to-im"
echo "TUI 접속:   codex-tui"
echo "포트 변경:  CTI_CODEX_WS_PORT=9100 (기본값)"
