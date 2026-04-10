# Claude-to-IM Skill (Custom Fork)

Codex CLI를 Discord와 연동하고, 작업 내용을 터미널 TUI로 실시간 관찰할 수 있도록 SDK 통신 방식을 수정/적용한 포크 버전.

- **원본**: [op7418/Claude-to-IM-skill](https://github.com/op7418/Claude-to-IM-skill)
- **변경 핵심**: `@openai/codex-sdk`(codex exec) → `codex app-server`(WebSocket JSON-RPC) 전환
- **추가 변경**:
  - `CTI_DISCORD_STREAM_ENABLED=false` 런타임 반영
  - `[DC]` 접두사 기반 Discord 선택 전송
  - `[DC]` 문장 즉시 전송
  - `[DC]` 다중 블록 분리 전송
  - `CTI_DISCORD_START_MESSAGE=false`로 작업 시작 자동 알림 비활성화 가능
  - 다른 봇 메시지 읽기 허용
- **원본 문서**: [README_ORIGINAL.md](README_ORIGINAL.md)

## 설치 및 적용

**[SETUP.md](SETUP.md)** 참조.

## Discord 권장 설정

코드만 복구해서는 현재 동작이 그대로 나오지 않는다. 아래 환경변수를
`~/.claude-to-im/config.env`에 넣고, 변경 후에는 반드시 데몬을 재시작해야 한다.

```env
CTI_RUNTIME=codex
CTI_DISCORD_STREAM_ENABLED=false
CTI_DISCORD_FORWARD_PREFIX=[DC]
CTI_DISCORD_START_MESSAGE=false
```

적용 후:

```bash
systemctl --user restart claude-to-im
```

의미:
- `CTI_DISCORD_STREAM_ENABLED=false`: Discord `(수정됨)` 스트리밍 편집 비활성화
- `CTI_DISCORD_FORWARD_PREFIX=[DC]`: `[DC]`가 붙은 응답만 Discord로 전달
- `CTI_DISCORD_START_MESSAGE=false`: 자동 `작업 시작` 알림 비활성화
- 위 설정이 없으면, 코드가 최신이어도 기대한 전달 규칙과 다르게 동작할 수 있다

포맷 후 복원:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/IgoAIga/Claude-to-IM-skill/main/scripts/restore.sh)
```

## License

MIT License - Copyright (c) 2024-2025 op7418 (원본), 이후 수정 사항 포함.
전문은 [LICENSE](LICENSE) 참조.
