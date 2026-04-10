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

### 3. Discord 전달 규칙 분리
- `CTI_DISCORD_FORWARD_PREFIX=[DC]`가 붙은 응답만 Discord로 전달
- `item/agentMessage/delta`를 사용해 `[DC]` 문구는 **턴 종료 전에도 즉시 전달**
- 같은 답변 안에 `[DC]`가 여러 개 있으면 **각각 별도 Discord 메시지**로 분리 전송
- 일반 commentary / 중간 진행 텍스트는 Discord로 전달하지 않음

### 4. Discord 작업 시작 자동 알림
- 일반 작업 메시지를 받으면 Discord에 먼저 짧은 시작 문구를 1회 전송
- 환경변수: `CTI_DISCORD_START_MESSAGE` (기본값: `작업 시작`)
- `false`, `off`, `0`, `disabled` 중 하나로 설정하면 자동 시작 알림 비활성화

### 5. Discord에서 다른 봇 메시지도 읽기
- 자기 자신 봇 메시지만 제외하고, 다른 봇/웹훅 메시지는 입력으로 처리 가능

### 6. TUI 접속 스크립트 (`scripts/codex-tui.sh`)
- `codex resume --remote ws://127.0.0.1:PORT`를 간편하게 실행하는 래퍼

---

## 자동 설치 (스크립트)

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/IgoAIga/Claude-to-IM-skill/main/scripts/restore.sh)
```

이 스크립트는 다음을 자동으로 수행한다.

- `~/.codex/skills/claude-to-im` 클론/업데이트
- `~/.codex/skills/Claude-to-IM` 클론
- 코어 라이브러리에 커스텀 패치 적용
- 코어/스킬 순서대로 `npm install && npm run build`
- `codex-tui` 링크 등록
- `systemd --user` 서비스 등록 및 실행 중이면 재시작

> 중요:
> 복원 스크립트는 코드와 서비스까지 복구하지만, 실제 Discord 전달 동작은
> `~/.claude-to-im/config.env` 값에 따라 달라진다. 현재 포크 기준 권장값은
> 아래 "권장 Discord 설정" 블록을 따른다.

---

## 수동 설치 (단계별)

AI 에이전트가 위 스크립트 대신 직접 실행할 경우 아래 순서를 따른다.

### Step 1: 클론

```bash
# 스킬 저장소
git clone https://github.com/IgoAIga/Claude-to-IM-skill.git ~/.codex/skills/claude-to-im

# 코어 라이브러리 저장소
git clone https://github.com/op7418/Claude-to-IM.git ~/.codex/skills/Claude-to-IM

cd ~/.codex/skills/claude-to-im
git remote add upstream https://github.com/op7418/Claude-to-IM-skill.git
```

### Step 2: 코어 패치 적용 + 빌드

```bash
cd ~/.codex/skills/Claude-to-IM
git apply --3way ~/.codex/skills/claude-to-im/patches/claude-to-im-custom.patch
npm install
npm run build

cd ~/.codex/skills/claude-to-im
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

# Discord로 보낼 답변만 이 접두사로 시작
CTI_DISCORD_FORWARD_PREFIX=[DC]

# 작업 시작 자동 알림 비활성화
CTI_DISCORD_START_MESSAGE=false

# [선택] app-server WebSocket 포트 (기본값 9100)
# CTI_CODEX_WS_PORT=9100
```

### 권장 Discord 설정

현재 포크에서 사용자 경험을 맞추려면 아래 값을 권장한다.

```env
CTI_RUNTIME=codex
CTI_DISCORD_STREAM_ENABLED=false
CTI_DISCORD_FORWARD_PREFIX=[DC]
CTI_DISCORD_START_MESSAGE=false
```

설명:
- `CTI_RUNTIME=codex`: Claude CLI가 아니라 Codex app-server 기반으로 동작
- `CTI_DISCORD_STREAM_ENABLED=false`: Discord 스트리밍 편집 비활성화
- `CTI_DISCORD_FORWARD_PREFIX=[DC]`: `[DC]`가 붙은 응답만 Discord 전달
- `CTI_DISCORD_START_MESSAGE=false`: 자동 시작 알림 제거

설정 변경 후에는 반드시 재시작:

```bash
systemctl --user restart claude-to-im
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
| Discord에 중간 멘트까지 전부 올라옴 | `CTI_DISCORD_FORWARD_PREFIX` 미설정 | config.env에 `CTI_DISCORD_FORWARD_PREFIX=[DC]` 추가 후 재시작 |
| `[DC]` 여러 개가 한 덩어리로 감 | 구버전 daemon 실행 중 | restore.sh 재실행 또는 `systemctl --user restart claude-to-im` |
| `[DC]` 첫 문장만 먼저 가고 뒤가 늦게 붙음 | 구버전 daemon 실행 중 | restore.sh 재실행 또는 `systemctl --user restart claude-to-im` |
