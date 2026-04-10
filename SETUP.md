# Claude-to-IM 커스텀 포크 — 설치 및 적용 가이드

> **이 문서는 AI 에이전트(Codex/Claude)가 URL만 받고 자동 적용할 수 있도록 작성됨.**
> 사람이 읽어도 되지만, 핵심 대상은 "이 URL 적용해줘"라고 지시받은 AI 에이전트.

## 저장소 정보

- **포크**: `https://github.com/IgoAIga/Claude-to-IM-skill.git`
- **원본**: `https://github.com/op7418/Claude-to-IM-skill.git`
- **용도**: Discord ↔ Codex 브리지 (app-server 기반, TUI 실시간 관찰 지원)

## 원본 대비 커스텀 변경 사항

### 1. Codex Provider: SDK → app-server 전환 (`src/codex-provider.ts`)
- 기존: `@openai/codex-sdk`가 `codex exec` subprocess를 spawn → TUI 관찰 불가
- 변경: `codex app-server --listen ws://127.0.0.1:PORT`를 spawn → WebSocket JSON-RPC 통신
- 효과: **Discord에서 Codex 작업 중, 다른 터미널에서 TUI로 실시간 관찰 가능**
- 환경변수: `CTI_CODEX_WS_PORT` (기본값: 9100)

### 2. Discord 스트리밍 편집 비활성화 (`src/config.ts`)
- `CTI_DISCORD_STREAM_ENABLED=false`가 런타임에 정상 반영되도록 설정 매핑 추가

### 3. TUI 접속 스크립트 (`scripts/codex-tui.sh`)
- `codex resume --remote ws://127.0.0.1:PORT`를 간편하게 실행하는 래퍼

---

## 자동 설치 (스크립트)

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/IgoAIga/Claude-to-IM-skill/main/scripts/restore.sh)
```

---

## 수동 설치 (단계별)

AI 에이전트가 위 스크립트 대신 직접 실행할 경우 아래 순서를 따른다.

### Step 1: 클론

```bash
# Codex 스킬 디렉토리에 클론
git clone https://github.com/IgoAIga/Claude-to-IM-skill.git ~/.codex/skills/claude-to-im

cd ~/.codex/skills/claude-to-im

# 원본을 upstream으로 등록 (향후 업데이트 머지용)
git remote add upstream https://github.com/op7418/Claude-to-IM-skill.git
```

### Step 2: 의존성 설치 + 빌드

```bash
npm install
npm run build
```

### Step 3: config.env 생성

`config.env.example`을 참고하여 `config.env`를 만든다. **최소 필수 항목:**

```env
# Discord 봇 토큰
CTI_DISCORD_BOT_TOKEN=여기에_봇_토큰

# 허용 채널 (쉼표 구분)
CTI_DISCORD_ALLOWED_CHANNELS=채널ID1,채널ID2

# Codex용 OpenAI API 키
OPENAI_API_KEY=여기에_API_키

# 런타임 (codex 고정)
CTI_RUNTIME=codex

# Discord 스트리밍 편집 비활성화 (메시지가 계속 "(수정됨)"으로 갱신되는 것 방지)
CTI_DISCORD_STREAM_ENABLED=false

# [선택] app-server WebSocket 포트 (기본값 9100)
# CTI_CODEX_WS_PORT=9100
```

권한 설정:
```bash
chmod 600 config.env
```

### Step 4: codex-tui 명령어 등록

```bash
mkdir -p ~/.local/bin
ln -sf ~/.codex/skills/claude-to-im/scripts/codex-tui.sh ~/.local/bin/codex-tui
```

`~/.local/bin`이 PATH에 있는지 확인. 없으면:
```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
```

### Step 5: systemd 서비스 등록 (권장)

Codex compact 등으로 세션이 재시작되어도 데몬이 죽지 않도록 systemd user service로 실행한다.

```bash
# 서비스 파일 복사
mkdir -p ~/.config/systemd/user
cp ~/.codex/skills/claude-to-im/scripts/claude-to-im.service ~/.config/systemd/user/

# 서비스 파일 내 경로가 실제 설치 경로와 맞는지 확인 (기본값: ~/.codex/skills/claude-to-im)
# 다른 경로에 설치했다면 WorkingDirectory를 수정

# 등록 + 시작
systemctl --user daemon-reload
systemctl --user enable claude-to-im
systemctl --user start claude-to-im
```

서비스 관리:
```bash
systemctl --user status claude-to-im    # 상태 확인
systemctl --user restart claude-to-im   # 재시작
systemctl --user stop claude-to-im      # 중지
journalctl --user -u claude-to-im -f    # 로그
```

> **대안 (systemd 불가 시):** `nohup`으로 수동 실행
> ```bash
> cd ~/.codex/skills/claude-to-im
> setsid nohup node dist/daemon.mjs > /tmp/claude-to-im-daemon.log 2>&1 &
> ```

### Step 6: 동작 확인

```bash
# 데몬 실행 확인
systemctl --user status claude-to-im

# Discord에서 Codex에 메시지 전송 → app-server 자동 시작

# 다른 터미널에서 TUI 접속
codex-tui
```

---

## 일상 운영

| 작업 | 명령어 |
|---|---|
| 데몬 시작 | `systemctl --user start claude-to-im` |
| 데몬 중지 | `systemctl --user stop claude-to-im` |
| 데몬 재시작 | `systemctl --user restart claude-to-im` |
| 데몬 로그 | `journalctl --user -u claude-to-im -f` |
| TUI 접속 | `codex-tui` |
| TUI 접속 (포트 지정) | `codex-tui 9200` |
| 로그 확인 | `cat /tmp/claude-to-im-daemon.log` |
| 포트 점유 확인 | `ss -tlnp \| grep 9100` |
| 고아 프로세스 정리 | `pkill -f 'codex app-server'` |

## 원본 업데이트 머지

```bash
cd ~/.codex/skills/claude-to-im
git fetch upstream
git merge upstream/main
npm install && npm run build
# 데몬 재시작
```

## 트러블슈팅

| 증상 | 원인 | 해결 |
|---|---|---|
| `Address in use` | 이전 app-server가 포트 점유 | `pkill -f 'codex app-server'` 후 재시작 |
| `app-server exited (code=1)` | 포트 충돌 또는 codex CLI 미설치 | 포트 확인 + `codex --version` |
| `codex-tui` 연결 실패 | 데몬 미실행 또는 첫 메시지 전 | Discord에서 메시지 전송 후 재시도 |
| `(수정됨)` 반복 | `CTI_DISCORD_STREAM_ENABLED` 미설정 | config.env에 `=false` 추가 후 재시작 |
