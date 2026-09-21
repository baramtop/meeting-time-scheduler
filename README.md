# 모임 시간 정하기

8~10명이 매주 모임 시간을 다같이 정하는 간단한 웹앱.

- 기본 일정: 매주 수요일 오후 8시
- 각자 이름을 입력하고 가능/불가능 표시
- 불가능한 사람이 있으면 대안 날짜/시간을 제안하고 투표
- 아무나 최종 시간을 "확정"할 수 있음
- 매주 자동으로 새 일정으로 초기화 (지난 주 기록은 남아있음)

프론트엔드는 순수 HTML/CSS/JS, 백엔드는 Vercel Serverless Function(`api/state.js`) +
Vercel KV(Redis)를 사용합니다.

## Vercel 배포 방법

1. 이 폴더를 GitHub 저장소로 올린 뒤 Vercel에서 Import
2. Vercel 프로젝트 대시보드 → **Storage** 탭 → **Create Database** → **KV(Redis)** 선택 후 생성
   - 생성 시 이 프로젝트에 연결(Connect)하면 `KV_REST_API_URL`, `KV_REST_API_TOKEN` 등의
     환경변수가 자동으로 추가됩니다. 별도로 손댈 필요 없음.
3. 다시 Deploy (또는 첫 배포 시 KV를 먼저 만들고 Import하면 한 번에 됨)

## 로컬에서 확인하고 싶을 때

```bash
npm install
npx vercel dev
```

`vercel dev`는 Vercel 계정 로그인 및 프로젝트 연결이 필요하고, KV 환경변수는
`vercel env pull`로 받아와야 정상 동작합니다. 단순히 화면만 보려면 `index.html`을
브라우저로 열어도 되지만, 이 경우 `/api/state`가 없어 데이터 저장은 되지 않습니다.
