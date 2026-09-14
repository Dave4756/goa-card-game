# 전장연 카드게임 서버

서버 권위형(Server-authoritative) 실시간 카드 대전 백엔드입니다.
HP, 데미지, 상태이상, 코인플립 등 **모든 판정은 서버에서만 계산**하고,
클라이언트는 액션 요청 + 상태 렌더링만 담당합니다. (치팅 방지)

## 폴더 구조

```
server.js                  # Express + Socket.io 진입점, 소켓 이벤트 라우팅
src/data/cards.json        # 카드 데이터 (몹/아이템) - 여기만 수정하면 밸런스 조정 가능
src/engine/constants.js    # 상태이상/스택/필드키워드 상수
src/engine/CardInstance.js # 필드/패에 존재하는 카드의 런타임 상태
src/engine/Player.js       # 플레이어의 덱/패/필드/트레쉬
src/engine/GameRoom.js     # 게임 진행의 핵심 (턴, 데미지 파이프라인, 승패 판정)
src/engine/keywordHandler.js # 턴 시작 훅 (화상 틱, 특성 발동, 솔라빔 카운트다운 등)
src/engine/skills.js       # 카드별 스킬 로직 + 소모형 아이템 효과
src/rooms/RoomManager.js   # 방 코드 생성/매칭 큐
public/                    # 테스트용 최소 클라이언트 (버튼 기반, 드래그앤드롭 아님)
```

## 로컬 실행

```bash
npm install
npm start
# http://localhost:3000 접속, 두 개의 브라우저 탭으로 테스트
```

## Render.com 배포

1. 이 폴더 전체를 깃허브 저장소 루트(또는 원하는 서브폴더)에 푸시
2. Render 대시보드 → New → Web Service → 저장소 연결
3. 설정값:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Environment**: Node
4. 배포 후 발급되는 URL로 접속하면 바로 플레이 가능합니다.
   (Socket.io는 같은 Express 서버에서 서빙되므로 별도 CORS 설정 불필요)

> 무료 티어는 일정 시간 요청이 없으면 슬립 상태가 되어 첫 접속 시 몇 초 지연이 발생할 수 있습니다.
> UptimeRobot 같은 무료 핑 서비스로 5~10분마다 `/healthz`를 호출하면 슬립을 줄일 수 있습니다.

## 게임 흐름 (구현된 것)

1. `createRoom` / `joinRoom` / `findMatch` 로 2인 매칭
2. 매칭 완료 시 자동으로 카드 3장 드로우 (몹 카드 최소 1장 보장)
3. `placement` 페이즈: `placeMob`으로 필드에 몹 배치 → `confirmPlacement`
4. 양쪽 다 준비되면 서버가 동전을 던져 선공 결정, `battle` 페이즈 시작
5. 매 턴: `drawCard`(턴당 1회) → 아이템 장착/사용 자유롭게 → `useSkill` 사용 시 턴 종료
6. 상태이상(혼란/화상/수면), 스택(과충전/과열된 연료), 필드키워드(전기장), 각 카드 특성 모두 서버에서 자동 처리
7. 필드에 몹이 하나도 없고 낼 카드도 없으면 패배 처리

## 아직 단순화된 부분 (다음에 다듬으면 좋은 것들)

- **인면어 전장연의 "회피"**: 능동 스킬이 아니라 피격 시 반응형 방어라서, 현재는 자동 발동이 아니라 주석으로만 표시해뒀어요.
  `GameRoom.dealDamage` 앞단에 `targetCard.defId === 'card_inmyeoneo'`일 때 코인플립 후 무효화하는 훅을 추가하면 됩니다.
- **런닝맨 전장연의 연속 스킬 보너스**: 스킬 설명에 적힌 "+40 고정"을 기준으로 구현했고, 특성 설명의 "+20씩 누적"은 아직 반영 안 함 (둘 중 원하시는 규칙으로 통일해주세요).
- **드래그앤드롭 UI**: 지금 클라이언트는 버튼 클릭 기반 테스트용입니다. 실제 서비스용 UI(드래그앤드롭, 카드 일러스트, 이펙트 애니메이션)는 백엔드 이벤트(`events` 배열: damage/heal/coinFlip/death/specialEvolution 등)를 받아서 원하는 애니메이션으로 다시 그리시면 됩니다.
- **카드 이미지**: `src/data/cards.json`에 `image` 필드를 추가하고 `public/images/` 폴더에 파일을 넣은 뒤 클라이언트에서 참조하면 됩니다.

## 카드/밸런스 수정하는 법

전부 `src/data/cards.json`에서 숫자만 바꾸면 됩니다. 새로운 고유 스킬 로직(예: 새 카드 추가)은
`src/engine/skills.js`에 같은 패턴으로 `card_새아이디: { s1: (ctx) => {...} }` 형태로 추가하면 됩니다.
