# 골든타임 게임 시스템 연동

`golden-time-system.js`는 UI를 포함하지 않는 게임 규칙 모듈입니다. 화면과 버튼은 만들지 않으며, 일자·예산·청렴도·경제 방어력·혁신 기여도·예산 결산 점수·최종 점수·등급·랭킹·저장을 관리합니다. 재난 진행 상황은 플레이어에게 상황을 전달하기 위한 별도 상태로 추적하며 점수와 등급 계산에는 넣지 않습니다. 게임 예산은 해원시 재난 대응 조달에 배정된 가용 예산이며, 모든 예산·비용 값의 단위는 억 원입니다. 시작 예산은 3,000억 원입니다.

## 불러오기

브라우저에서는 스크립트를 포함한 뒤 `GoldenTimeSystem`을 사용합니다. Node 환경에서는 `require("./golden-time-system")`로 불러옵니다. 별도 빌드 단계나 패키지는 필요하지 않습니다.

## 상태 시작 및 담당 모듈 연동

```js
const system = GoldenTimeSystem;
let game = system.createState();

// 계약 심사, 자재, 기업 지원, 재난 모듈은 성공/실패 결과를 변화량으로 전달합니다.
game = system.applyOutcome(game, {
  source: "procurement-review",
  label: "공정 심사 완료",
  budgetDelta: -8, // 예산 사용은 음수, 환수/절감은 양수
  integrityDecision: "correct",
  details: { decision: "approved" }
});

// 조달 기간의 예상 수요와 안전재고, 예산 제약으로 보충 계획을 계산합니다.
const replenishment = system.calculateReplenishmentPlan({
  forecastDailyDemand: 3,
  leadTimeDays: 2,
  safetyStock: 4,
  onHand: 5,
  onOrder: 1,
  committedQuantity: 2,
  budget: 3000,
  protectedBudget: 1200,
  unitCost: 10
});
// 목표 재고 10, 재고 위치 4, 보충 필요량 6, 계획 매입량 6

// 매입·대기·방출 등 각 실행 가능 계획의 위험 조정 비용을 계산합니다.
const chosenCost = system.calculateExpectedPlanCost({
  acquisitionCost: 40,
  holdingCost: 3,
  shortageQuantity: 0,
  shortageProbability: 0.2,
  shortageImpactPerUnit: 50,
  obsolescenceCost: 0
});
const bestFeasibleCost = 40; // 같은 상태에서 비교한 실행 가능 계획 중 최저 위험 조정 비용
const marketResponse = system.classifyMarketResponse(chosenCost, bestFeasibleCost);

// 원자재 시황 한 건의 평가 결과를 전달합니다.
game = system.applyOutcome(game, {
  source: "material-reserves",
  label: "원자재 가격 급등 대응",
  budgetDelta: -6,
  economicDecision: {
    requiredQuantity: 10,
    availableQuantity: 9,
    referenceUnitCost: 10,
    actualTotalCost: 45,
    chosenExpectedCost: 43,
    bestFeasibleExpectedCost: 40
  }
});

// 혁신제품의 실제 활용 결과가 확인된 뒤 평가합니다.
game = system.applyOutcome(game, {
  source: "sme-support",
  label: "혁신제품 공공 활용 결과",
  budgetDelta: -5,
  innovationDecision: "partial"
});

// 하루 업무를 정산합니다. 그날의 점수와 등급을 먼저 성적표에 저장합니다.
game = system.closeDay(game, {
  source: "daily-settlement",
  label: "일일 업무 정산",
  budgetDelta: -8,
  budgetAssessment: { allocatedBudget: 10, actualCost: 8, fulfillment: 1 }
});

// 이후 1일차 밤 뉴스를 생성합니다. 이 결과는 2일차 아침 경제 시황 뉴스에
// 반영할 내용으로 뉴스 모듈이 보관합니다. 1일차 dailyResults는 바꾸지 않습니다.

// 1일차 밤에 지진이 발생하면 재난 목표를 먼저 등록합니다.
game = system.beginDisaster(game, "규모 7.8 지진 발생", [
  { id: "relief-supplies", label: "구호물품 도착", target: 100 },
  { id: "routes", label: "보급로 복구", target: 5 },
  { id: "drone-deliveries", label: "드론 운송", target: 10 }
]);

// 밤 뉴스 결과는 2일차 아침에 반영할 데이터로 보관합니다.
game = system.queueMorningOutcome(game, {
  source: "night-news-outcome",
  label: "1일차 밤 결과 및 2일차 아침 반영 자료",
  budgetDelta: 4,
  disasterMetrics: [
    { id: "relief-supplies", achieved: 70 },
    { id: "routes", achieved: 4 },
    { id: "drone-deliveries", achieved: 6 }
  ],
  disasterStatus: "주요 보급로 일부 복구",
  details: { newsInputs: { materialMarket: "철강 가격 상승", supplyChain: "일부 보급 안정" } }
}, "day-1-night-news");

// 뉴스 담당 모듈은 이 자료로 아침 기사와 경제 시황 티커를 구성합니다.
const pendingNewsInputs = system.getPendingMorningOutcomes(game);
// pendingNewsInputs[*].outcome.details.newsInputs, .disasterMetrics 등을 사용

// 뉴스 표시 내용이 준비된 뒤 상태에 한 번 반영합니다.
game = system.applyMorningOutcomes(game);
```

각 게임 모듈은 직접 UI 상태를 수정하지 않습니다. 당일 업무 결과는 `applyOutcome`으로 기록하고, 밤 뉴스에서 나온 다음 날 효과는 정산 뒤 `queueMorningOutcome`으로 보관해 다음 날 아침 `applyMorningOutcomes`로 한 번 적용합니다. 점수 변화량은 모듈별로 음수 또는 양수일 수 있고, 점수값은 0~100으로 제한됩니다. 예산은 실제 남은 값 그대로 누적되므로 부족한 지출도 음수로 표시됩니다.

역할은 다음과 같이 나뉩니다. 5번 재난·뉴스 담당은 밤 뉴스 사건과 다음 날 아침 뉴스에 담길 내용을 구성하고, 1번 UI 담당은 뉴스와 티커를 화면에 표시합니다. 6번 게임 시스템은 `queueMorningOutcome`으로 구조화된 결과와 상태 변화를 보관하고, `getPendingMorningOutcomes`로 미적용 수치 데이터를 제공합니다. 뉴스 생성·표시가 준비된 뒤 6번 시스템의 `applyMorningOutcomes`를 호출해 해당 수치와 상태를 한 번 갱신합니다. 게임 시스템은 뉴스 문구나 티커를 생성하지 않습니다.

## 결과 화면 데이터

```js
const result = system.summarize(game);
// { day, days, budget, scores, scoredCategories, dailyResults, pendingMorningOutcomes, finalScore, grade, title, finished }
const tonight = result.dailyResults[result.dailyResults.length - 1];
// { day, scores, scoredCategories, budget, disaster, finalScore, grade, title }
```

하루 순서는 **아침 뉴스 반영 → 업무 선택·결과 기록 → `closeDay` 정산 및 성적표 저장 → 밤 뉴스 생성 및 `queueMorningOutcome` → 다음 날 아침 뉴스와 `applyMorningOutcomes`**입니다. 밤 뉴스와 다음 날 아침 시황은 별개의 결과를 중복 적용하는 두 시스템이 아닙니다. 밤 뉴스에서 드러난 가격·공급·기업 활용 결과가 다음 날 시황의 입력이 되고, 그 효과를 `applyMorningOutcomes`가 한 번만 반영합니다. 이 함수는 `closeDay` 뒤 큐에 추가된 결과만 다음 날 시작 전에 적용합니다. 필요하면 그때 결과에 연결된 점수도 기록합니다. 전날 성적표는 소급 수정하지 않습니다. `closeDay`는 정산 시점에 평가가 완료된 항목으로 `finalScore`와 등급을 저장합니다. 다음 날에는 이어진 상태와 평가 기록으로 다시 계산합니다. 5일차 정산 결과가 최종 점수와 등급이며, 5일차 밤 뉴스는 최종 상황을 보여주는 엔딩 뉴스가 됩니다. 같은 날짜를 두 번 정산하면 중복 성적표를 만들지 않도록 오류를 반환합니다.

최종 점수와 등급은 청렴도, 경제 방어력, 혁신 기여도, 예산 결산 네 항목으로만 계산합니다. 정상 시나리오에서는 네 항목을 각각 25% 반영하고, 초기 점수는 0점입니다. 예외적으로 당일 결과가 없는 항목은 해당 정산에서 제외하고 나머지 완료 항목의 비중을 동일하게 조정합니다. `scoredCategories`에는 그 정산에 실제 포함된 항목이 표시됩니다. 결과가 도착하면 이후 정산부터 포함합니다. 재난 전후 모두 점수 산식 원칙은 동일하며, 재난 상황 진척도는 점수나 등급에 가산하지 않습니다. 시작 예산은 3,000억 원입니다. 등급 경계는 A 90점 이상, B 80점 이상 90점 미만, C 70점 이상 80점 미만, D 60점 이상 70점 미만, F 60점 미만입니다. 청렴도는 `SCORING_CRITERIA.md`의 판정 기록 산식으로 계산합니다.

등급은 10점 간격으로 산정합니다: A는 90점 이상, B는 80점 이상 90점 미만, C는 70점 이상 80점 미만, D는 60점 이상 70점 미만, F는 60점 미만입니다.

## 저장 및 랭킹

브라우저 게임은 `createSession`을 사용하면 상태가 바뀔 때마다 자동 저장되고, 저장된 상태를 이어서 불러옵니다. 새로고침이나 페이지 이탈 때도 `pagehide`에서 저장하고 플레이 시간을 기록하도록 생명주기 이벤트를 연결합니다. 다시 게임을 열면 오프라인 시간은 플레이 시간에 포함되지 않으며, 세션을 시작할 때 `start()`를 호출합니다.

```js
const session = system.createSession(localStorage, {
  saveKey: "golden-time-save",
  rankingKey: "golden-time-ranking",
  stateOptions: { days: 5, startingBudget: 3000 }
});
let game = session.getState(); // 저장 기록이 있으면 불러오고, 없으면 새 게임 생성
session.bindPageLifecycle(window); // 페이지 이탈 저장 및 뒤로 복원 대응
session.start(); // 새 게임 또는 이어하기 시작

game = session.applyOutcome({
  source: "procurement-review",
  integrityDecision: "correct"
}); // 변경 직후 자동 저장

// 5일차 closeDay 이후, 엔딩 화면에서 한 번 호출합니다.
const leaderboard = session.finalizeRanking("플레이어");
```

`pause()`는 현재까지의 플레이 시간을 저장하고 시간을 멈춥니다. 이어하기를 시작할 때 `start()`를 다시 호출하세요. `bindPageLifecycle(window)`는 페이지가 숨겨지거나 닫힐 때 저장하고, 브라우저의 뒤로/앞으로 캐시에서 복원될 때 시간을 다시 잽니다. 반환된 해제 함수를 호출하면 이벤트 연결을 제거할 수 있습니다. 저장 데이터에는 현재 일자, 네 점수, 예산, 성적표, 미적용 밤 뉴스 결과, 누적 플레이 시간이 함께 들어갑니다.

자동 저장을 유지하려면 상태를 바꾸는 호출은 `system.applyOutcome(game, ...)` 대신 `session.applyOutcome(...)`처럼 세션 메서드로 실행합니다. 사용 가능한 변경 메서드는 `beginDisaster`, `applyOutcome`, `queueMorningOutcome`, `applyMorningOutcomes`, `closeDay`입니다. `session.getState()`는 읽기용 복사본을 반환합니다. 5일차 `closeDay` 후 `finalizeRanking(이름)`을 호출하면 최종 성적과 누적 플레이 시간으로 랭킹을 한 번 등록합니다.

`createSession`을 사용하지 않는 경우에도 저장소를 직접 전달해 브라우저에서는 `localStorage`, 다른 게임 셸에서는 자체 어댑터를 쓸 수 있습니다. 다만 그 경우 상태 변경 뒤 `save()`를 직접 호출하고, 시작·일시정지·완료 시간을 관리해야 합니다.

```js
system.save(localStorage, "golden-time-save", game);
game = system.load(localStorage, "golden-time-save") || system.createState();

const leaderboard = system.addRankingEntry(localStorage, {
  name: "플레이어",
  completed: game.finished,
  finalScore: system.calculateFinalScore(game),
  grade: system.getGrade(system.calculateFinalScore(game)).grade,
  playTimeMs: 248000
});
```

랭킹은 5일 플레이를 완료한 기록만 등록하고, 최종 점수 내림차순으로 정렬합니다. 최종 점수가 같으면 실제 플레이 시간이 짧은 기록이 앞섭니다. 점수와 플레이 시간이 모두 같으면 공동 순위이며, 다음 순위 번호는 건너뜁니다(예: 1, 1, 3). `playTimeMs`는 시작부터 엔딩까지의 플레이 시간(밀리초)이며, 게임에서 일시정지를 지원하면 정지 시간은 제외하는 것을 권합니다. 로컬 저장소 기준으로 기기 간 공유는 하지 않습니다.

## 결과 변화량 계약

```ts
type Outcome = {
  source?: string;
  label?: string;
  budgetDelta?: number;
  budgetAssessment?: { allocatedBudget: number; actualCost: number; fulfillment: number };
  integrityDecision?: "correct" | "ordinaryWrong" | "falseApproval";
  economicDecision?: { marketResponse?: "success" | "partial" | "failure"; chosenExpectedCost?: number; bestFeasibleExpectedCost?: number; requiredQuantity: number; availableQuantity: number; referenceUnitCost: number; actualTotalCost: number };
  innovationDecision?: "success" | "partial" | "failure";
  disasterMetrics?: Array<{ id: string; achieved: number; target?: number; label?: string; weight?: number }>;
  disasterStatus?: string;
  details?: unknown;
};
```

재난 담당 모듈은 지진 발생 시 `beginDisaster`를 호출합니다. 밤 뉴스의 현장 지표는 `disasterMetrics`로 `queueMorningOutcome`에 넣고, 다음 날 아침 `applyMorningOutcomes`로 적용합니다. `disaster.progress`와 `disaster.status`는 `scores`와 별도로 관리되어 점수·등급에 영향을 주지 않습니다.

계약 심사 모듈은 최종 판정마다 `integrityDecision`을 한 번 전달합니다. `correct`는 적격 업체 승인 또는 부실 업체 반려, `ordinaryWrong`은 적격 업체 오반려, `falseApproval`은 부실 업체 승인을 뜻합니다. 점수 모듈이 누적 판정 건수로 청렴도를 자동 계산하므로 `scoreDeltas.integrity`는 보내지 않습니다. 조사·판단 보류 중에는 결과를 전달하지 않고 최종 판정이 난 뒤 전달합니다.

재난/뉴스 모듈은 밤 뉴스에서 확인한 현장 지표를 다음 날 아침 `disasterMetrics`로 전달합니다. 각 지표는 안정된 ID, 목표량, 실제 달성량을 갖습니다. 게임 시스템은 각 달성률 `min(achieved / target, 1)`을 계산해 평균하고, 결과를 `disaster.progress`에 저장합니다. 기본은 지표별 동일 비중이며, 시나리오에서 중요도가 다르면 `weight`를 지정해 가중 평균할 수 있습니다. 시나리오는 지진 시작 시 전체 복구 지표를 선언하고, 이후 아침 뉴스에서 각 지표의 누적 달성량을 갱신해야 진척률이 새 목표 추가 때문에 불필요하게 출렁이지 않습니다. `disaster.progress`는 상황 표시 전용으로 점수·등급에 포함되지 않습니다.

원자재/시황 모듈은 `calculateReplenishmentPlan`으로 조달 리드타임 수요, 안전재고, 재고 위치와 보호 예산을 반영한 계획 매입량을 구할 수 있습니다. 선택지별 비용은 `calculateExpectedPlanCost`로 계산합니다. 이 비용은 현재/예상 조달비용, 보유 비용, 공급 차질 확률에 따른 부족 영향 비용, 폐기·진부화 비용을 합산합니다. 당시 상태에서 실행 가능한 선택지 중 최저 비용을 `bestFeasibleExpectedCost`로 삼고, 선택한 안의 비용을 `chosenExpectedCost`에 전달하면 `classifyMarketResponse`가 최저 비용 대비 5% 이내는 성공, 25% 이내는 부분 성공, 그보다 높으면 실패로 판정합니다. 또는 시나리오별 기준이 다르면 `marketResponse`를 직접 지정할 수 있습니다. 평가 대상 시황마다 `economicDecision`을 한 번 전달합니다. `requiredQuantity`는 목표 확보량, `availableQuantity`는 기존 재고·매입분·안전 및 규격이 확인된 대체 자재를 포함한 확보량입니다. `referenceUnitCost`는 기준 자재의 시황 단가, `actualTotalCost`는 확보한 양에 귀속되는 실제 매입·대체 조합·보유 비용입니다. 게임 시스템이 수요 충족률과 예산 효율률을 계산하고 `marketResponse × 50 + supplyFulfillment × 30 + budgetEfficiency × 20`으로 시황 점수를 산출합니다. 경제 방어력은 평가 시황 점수의 누적 평균입니다. 실제 원자재 수익·비용은 `budgetDelta`로 함께 반영할 수 있으며, `scoreDeltas.economicDefense`는 직접 보내지 않습니다. 자세한 판단 원칙은 `SCORING_CRITERIA.md`를 참고합니다.

중소기업 지원 모듈은 시나리오가 당일 제공하는 활용 결과에 따라 제안마다 `innovationDecision`을 한 번 전달합니다. `success`, `partial`, `failure`는 각각 1, 0.5, 0점으로 기록되고, 혁신 기여도는 평가 완료된 제안 점수의 평균입니다. 가치가 낮은 제안을 적절히 거절한 경우도 성공으로 평가할 수 있으며, 예산 제약으로 지원을 줄였거나 결과가 제한된 경우는 부분 성공, 가치가 높은 실현 가능 제안을 충분한 여력이 있는데도 놓친 경우는 실패로 판정합니다. 투자 수익과 손실은 `budgetDelta`로 반영하고, `scoreDeltas.innovation`을 직접 보내지 않습니다. 시나리오는 해당 날짜의 정산 전에 활용 결과를 제공해야 합니다.

예산이 배정된 업무가 완료되면 담당 모듈은 `budgetAssessment`를 전달합니다. `allocatedBudget`은 해당 업무의 배정액(억 원), `actualCost`는 관련 환수·수익을 차감한 실제 순지출(억 원, 최소 0), `fulfillment`는 계획 결과 달성률(0~1)입니다. 시스템은 업무별로 `fulfillment × min(1, allocatedBudget / actualCost) × 100`을 계산하고, 배정액을 가중치로 평균 내 `budgetPerformance`를 갱신합니다. 남은 예산과 수익은 별도로 `budgetDelta`(억 원)에 반영합니다. `scoreDeltas.budgetPerformance`는 직접 보내지 않습니다.
