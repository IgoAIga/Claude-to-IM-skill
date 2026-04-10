# Claude-to-IM Skill (Custom Fork)

Codex CLI를 Discord와 연동하고, 작업 내용을 터미널 TUI로 실시간 관찰할 수 있도록 SDK 통신 방식을 수정/적용한 포크 버전.

- **원본**: [op7418/Claude-to-IM-skill](https://github.com/op7418/Claude-to-IM-skill)
- **변경 핵심**: `@openai/codex-sdk`(codex exec) → `codex app-server`(WebSocket JSON-RPC) 전환
- **원본 문서**: [README_ORIGINAL.md](README_ORIGINAL.md)

## 설치 및 적용

**[BUILD.md](BUILD.md)** 참조.
