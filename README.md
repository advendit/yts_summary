# yts — 유튜브 요약 (셀프호스팅)

유튜브 영상을 클릭 한 번으로 한국어 요약하는 크롬 익스텐션.
요약은 **본인 맥의 로컬 서버 + 본인 Claude 구독**(`claude -p`)으로 처리 — API 비용 0원.

```
크롬 익스텐션(UI) → localhost:8790 → yt-dlp 자막 추출 → claude -p 요약 → 마크다운 아카이빙
```

## 요구사항

- macOS + Chrome
- [Node.js](https://nodejs.org) 18+
- **Claude 구독** (Pro/Max) + Claude Code CLI 로그인:
  ```bash
  npm install -g @anthropic-ai/claude-code
  claude   # 실행 후 구독 계정으로 로그인
  ```

## 설치

```bash
git clone <이 저장소> && cd yts
./install.sh
```

스크립트가 yt-dlp 자동 설치, 서버 launchd 등록(로그인 시 자동 시작)까지 처리합니다.

마지막으로 익스텐션 로드:
1. Chrome → `chrome://extensions` → 우상단 **개발자 모드** 켜기
2. **압축해제된 확장 프로그램을 로드합니다** → 이 폴더의 `extension/` 선택

## 사용법

- 유튜브 영상 페이지에서 익스텐션 버튼 → 즉시 요약 (패널에 누적 표시)
- 홈/검색에서 버튼 → 영상 선택 모드 (클릭한 영상 요약, ESC 취소)
- 요약은 `~/Documents/YouTube요약/날짜_제목.md`에 자동 저장
- 📂 버튼 → 보관함 (`http://127.0.0.1:8790/archive`) — 목록·보기·삭제

## 문제 해결

- **자막 추출 실패**: yt-dlp가 오래된 경우가 대부분 → `~/.local/bin/yt-dlp -U`
- **서버 로그**: `/tmp/yts-server.log`
- **자막 없는 영상**: 지원 안 함 (STT 미구현)
- **포트**: 8790 고정. 충돌 시 `lsof -nP -iTCP:8790`으로 점유 프로세스 확인

## 제거

```bash
launchctl unload ~/Library/LaunchAgents/com.yts.server.plist
rm ~/Library/LaunchAgents/com.yts.server.plist
```

크롬에서 익스텐션 제거, 폴더 삭제.
