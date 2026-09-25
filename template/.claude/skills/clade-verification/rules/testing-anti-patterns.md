---
description: Testing anti-patterns to avoid — mock 濫用、test-only production methods、不完整 mock、E2E fixture 寫死絕對日期、測試碼品質低於生產碼、測試結構契約
paths:
  [
    'test/**/*.ts',
    'packages/*/test/**/*.ts',
    'e2e/**/*.ts', 'packages/*/e2e/**/*.ts',
    '.github/workflows/**',
  ]
---
<!-- Clade native rule; source: rules/core/testing-anti-patterns.md; edit canonical source -->
<!-- clade-targets: claude,codex,cursor -->

# Testing Anti-Patterns

## Overview

**Core principle:** Test what the code does, not what the mocks do. Mocks are tools to isolate, not things to test. Strict TDD prevents most of these anti-patterns.

## The Iron Laws

```
1. Never test mock behavior
2. Never add test-only methods to production classes
3. Never mock without understanding dependencies
```

## Anti-Pattern 1: Testing Mock Behavior

**The violation:**

```typescript
// ❌ BAD: Testing that the mock exists
test('renders sidebar', () => {
  const wrapper = mount(MyPage)
  expect(wrapper.find('[data-testid="sidebar-mock"]').exists()).toBe(true)
})
```

**The fix:**

```typescript
// ✅ GOOD: Test real component or don't mock it
test('renders sidebar', () => {
  const wrapper = mount(MyPage) // Don't mock sidebar
  expect(wrapper.find('[role="navigation"]').exists()).toBe(true)
})

// OR if sidebar must be mocked for isolation:
// Don't assert on the mock - test Page's behavior with sidebar present
```

### Gate Function

```
BEFORE asserting on any mock element:
  Ask: "Am I testing real component behavior or just mock existence?"

  IF testing mock existence:
    STOP - Delete the assertion or unmock the component

  Test real behavior instead
```

## Anti-Pattern 2: Test-Only Methods in Production

**The violation:**

```typescript
// ❌ BAD: destroy() only used in tests
class Session {
  async destroy() {
    // Looks like production API!
    await this._workspaceManager?.destroyWorkspace(this.id)
    // ... cleanup
  }
}

// In tests
afterEach(() => session.destroy())
```

**The fix:**

```typescript
// ✅ GOOD: Test utilities handle test cleanup
// Session has no destroy() - it's stateless in production

// In test/helpers/
export async function cleanupSession(session: Session) {
  const workspace = session.getWorkspaceInfo()
  if (workspace) {
    await workspaceManager.destroyWorkspace(workspace.id)
  }
}

// In tests
afterEach(() => cleanupSession(session))
```

### Gate Function

```
BEFORE adding any method to production class:
  Ask: "Is this only used by tests?"

  IF yes:
    STOP - Don't add it
    Put it in test utilities instead

  Ask: "Does this class own this resource's lifecycle?"

  IF no:
    STOP - Wrong class for this method
```

## Anti-Pattern 3: Mocking Without Understanding

**The violation:**

```typescript
// ❌ BAD: Mock breaks test logic
test('detects duplicate entry', () => {
  // Mock prevents side effect that test depends on!
  vi.mock('~/server/utils/supabase', () => ({
    getServiceClient: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    }),
  }))

  await addEntry(config)
  await addEntry(config) // Should throw - but won't!
})
```

**The fix:**

```typescript
// ✅ GOOD: Mock at correct level
test('detects duplicate entry', () => {
  // Mock only the network call, preserve state management
  vi.mock('~/server/utils/supabase', () => ({
    getServiceClient: vi.fn().mockReturnValue(
      createMockSupabaseClient({
        initialData: existingEntries,
      })
    ),
  }))

  await addEntry(config) // State updated
  await addEntry(config) // Duplicate detected ✓
})
```

### Gate Function

```
BEFORE mocking any method:
  STOP - Don't mock yet

  1. Ask: "What side effects does the real method have?"
  2. Ask: "Does this test depend on any of those side effects?"
  3. Ask: "Do I fully understand what this test needs?"

  IF depends on side effects:
    Mock at lower level (the actual slow/external operation)
    OR use test doubles that preserve necessary behavior
    NOT the high-level method the test depends on

  IF unsure what test depends on:
    Run test with real implementation FIRST
    Observe what actually needs to happen
    THEN add minimal mocking at the right level

  Red flags:
    - "I'll mock this to be safe"
    - "This might be slow, better mock it"
    - Mocking without understanding the dependency chain
```

## Anti-Pattern 4: Incomplete Mocks

**The violation:**

```typescript
// ❌ BAD: Partial mock - only fields you think you need
const mockResponse = {
  status: 'success',
  data: { userId: '123', name: 'Alice' },
  // Missing: metadata that downstream code uses
}

// Later: breaks when code accesses response.metadata.requestId
```

Partial mocks hide structural assumptions; tests pass while integration fails.

**The Iron Rule:** Mock the COMPLETE data structure as it exists in reality, not just fields your immediate test uses.

**The fix:**

```typescript
// ✅ GOOD: Mirror real API completeness
const mockResponse = {
  status: 'success',
  data: { userId: '123', name: 'Alice' },
  metadata: { requestId: 'req-789', timestamp: 1234567890 },
  // All fields real API returns
}
```

## Anti-Pattern 5: Integration Tests as Afterthought

Testing is part of implementation. Can't claim complete without tests — write the failing test first (see § TDD Prevents These Anti-Patterns).

## Anti-Pattern 6: Boundary Values Not Tested

**The violation:**

```typescript
// Schema accepts optional return_notes
const schema = z.object({
  return_notes: z.string().trim().max(500).optional(),
})

// ❌ Test only happy paths
test('manual return with notes', () => {
  expect(schema.parse({ return_notes: '主管代為結案' })).toEqual({...})
})

test('manual return without notes', () => {
  expect(schema.parse({ return_notes: undefined })).toEqual({})
})

// Both pass. Implementation ships. Then production:
// Client sends { return_notes: null } → 400 ZodError, dialog dies on submit.
```

Zod's `.optional()` means `string | undefined`, NOT `null`, and forms commonly emit `null` for a cleared field. The boundary that ships to production is the one the test forgot.

**The fix:**

```typescript
// 1. Schema accepts the actual production payload
const schema = z.object({
  return_notes: z.string().trim().max(500).nullish(), // .nullable().optional()
})

// 2. Test covers every boundary value that crosses the wire
describe('return_notes boundaries', () => {
  test.each([
    ['undefined (field omitted)',     undefined,           true],
    ['null (form cleared)',           null,                true],   // ← the one that bit us
    ['empty string',                  '',                  true],
    ['whitespace only',               '   ',               true],
    ['valid string',                  '主管代為結案',       true],
    ['max length',                    'x'.repeat(500),     true],
    ['over max length',               'x'.repeat(501),     false],  // expect rejection
  ])('%s', (_label, input, shouldPass) => {
    const result = schema.safeParse({ return_notes: input })
    expect(result.success).toBe(shouldPass)
  })
})
```

### Gate Function

```
BEFORE writing the test for any field that crosses a wire (HTTP body, form payload, query param):
  Enumerate the boundary values:
    - null
    - undefined
    - empty string ('')
    - whitespace only ('   ')
    - zero / negative
    - max length / max length + 1
    - empty array / array of one / array of max+1
    - NaN, Infinity (for numbers)
    - case sensitivity (for enums)
    - unicode / emoji / RTL chars (for strings displayed to users)

  For each boundary the schema is supposed to ACCEPT → write a passing test
  For each boundary the schema is supposed to REJECT → write a test asserting rejection

  IF you cannot enumerate what the schema should do at each boundary:
    STOP - you don't have a complete spec
    Pin down the contract before writing the implementation

  Trace the actual production payload:
    - What does the form / dialog / client code emit when the field is empty?
    - Is it `null`, `undefined`, `''`, or omitted entirely?
    - Read the client code, don't guess.

AFTER writing the tests — mental mutation check:
  For each comparison operator in the code under test (>=, >, <=, <, ===, !==):
    Ask: "if I flip this operator, does at least one existing test go red?"
      YES → the boundary is pinned
      NO  → the boundary is NOT pinned. The suite proves the happy path and nothing else.
            Add a test at the exact value where flipping changes behavior.

    IF you cannot answer without running the tests:
      You do not know what your tests cover. Write the boundary test instead of guessing.

  This finds the boundary specific to YOUR logic (`amount >= threshold` needs a test at exactly
  `threshold`). Coverage answers "was this line executed"; this answers "would a WRONG version
  of this line be caught".
```

### Red flags

- Test file only contains "happy path" + "missing field" cases for an optional input
- Schema uses `.optional()` for fields the form clears to `null`
- "It works on my machine" but breaks in another environment that uses different defaults
- Test passes; manual QA submits the form and 400s

### 機械驗證通道（選用；多數模組不需要）

需要機械證據的模組（金流 / 額度 / 期限 / 配額）可用 mutation testing 讓存活的突變體指出沒被釘住的邊界。

- **該不該導入**：`~/offline/clade/vendor/snippets/mutation-testing/README.md` 的 gate——**沒有 unit test 的模組、不含比較運算子的模組一律不導入**
- **採用狀態**：`node ~/offline/clade/scripts/audit-mutation-testing.ts --repo .`（靜態讀 `.clade/mutation-summary.json`）
- 兩條用絕對路徑：它們只存在於 clade、不散播
- 不要把 mutation score 變成常駐 KPI —— 一旦它成為被追的數字，產出就會從
  「想清楚邊界」退化成「對每個中間值下 assertion」，測試變脆、重構全紅

## Anti-Pattern 7: Accumulated Invariant Not Pinned

**The violation:**

```sql
-- 額度餘額的 canonical model 是 remaining = Σ hours_change
-- （核發本身就是一筆正的 hours_change）
-- ❌ 實作又把核發時數加了一次
v_available := v_batch.hours + v_transaction_hours - v_reserved_hours;
```

單筆核發時 `Σ hours_change` 恰好等於 `batch.hours`，happy-path 全綠，錯誤到第二筆才顯形。AP6 與 mutation testing 都錨在既有 code 上，對「該有卻沒寫下來的不變量」結構性全盲，所以 AP7 的錨點是 **data model**。

### Gate Function

```
FOR 每一個「可對同一 parent entity 重複寫入」的 amount / quantity / count 欄位
  （額度異動、出貨明細、扣款紀錄、預約時數、點數異動 —— 不是只查手上這一個）:

  Q1. 這個欄位的歷史聚合量，上界是什麼？
  Q2. 那條上界寫在 spec 的哪一行？

  IF Q2 答不出來:
    STOP — 這是 spec gap，不是 test gap。
    先把不變量寫進 spec，再回來寫測試。
    不要自己發明一個上界然後把它測起來 —— 那是把猜測釘成契約。

  IF 不變量已在 spec:
    寫一條測試，fixture 直接帶「已累積若干筆歷史 row」的狀態，
    斷言聚合結果仍滿足該不變量。
```

spec 範例：`可出貨數量 = 進料數量 - 報廢數量 - 已出貨數量`（<consumer-b> `shipment-return` spec）。

**Test shape：static fixture**，直接帶已累積的 history rows（`[{hours: 112}, {hours: 8}]`），斷言 available 是 120 而不是 232；不需連續呼叫 N 次。

這條沒有機械訊號（[[TD-978]]），但不要因此把 spec 契約讀成建議。

### Red flags

- spec 只寫「檢查是否超過額度」，沒寫額度**怎麼算出來的**
- 測試 fixture 每條都只有一筆歷史 row（單筆時多數聚合錯誤恰好隱形）
- 餘額算式散在 RPC / API / 報表三處各寫一份，沒有一處被 spec 指名為 canonical
- 斷言的是**算式原文**（`expect(body).toContain('v_available := …')`）而不是算式的**結果** ——
  見下方 § 對設定檔原文的斷言，標的是行為本身

## Anti-Pattern 8: 測試碼品質低於生產碼

**The violation:**

測試裡用生產碼不願意寫的捷徑（單字母名、magic number、一條塞三個概念、直接 new 底層 SDK client）——三個月後被 `.skip`、最後被刪，生產碼失去安全網。

**The fix:**

測試碼遵守與生產碼同一套命名 / 結構契約（見下方 § 測試結構契約）。測試變髒的當下先整理
再加下一條，不要用「先讓它綠」把髒寫進去。

### Gate Function

```
BEFORE 宣告一條測試寫完:
  Ask: "六個月後，失敗訊息能讓一個沒寫過這條的人指出壞掉的是哪一個能力嗎？"

  IF no:
    STOP - 這條測試還沒寫完。拆概念、換名字、或抽 domain helper。

  Ask: "我會不會因為它太難改而 skip 它？"

  IF yes:
    STOP - 先讓它變好改，再讓它綠。
```

## When Mocks Become Too Complex

Mock setup longer than test logic, or mocks missing methods real components have → consider an integration test with real components.

## TDD Prevents These Anti-Patterns

**TDD 三法則**（寫任何生產碼之前，**每一條**都適用，不是只處理「看起來比較重要的那個模組」）：

1. **先有失敗測試才寫生產碼**——沒有紅燈就沒有下一步
2. **測試只寫到剛好失敗**（含編譯失敗）——不要一次把整個 spec 寫完再實作
3. **生產碼只寫到剛好通過**——不要順便把「下次會用到」的分支寫進去

**If you're testing mock behavior, you violated TDD** — you added mocks without watching the test fail against real code first.

## 測試結構契約

失敗時要能立刻指出壞掉的是哪一個能力。純 review 層，無機械訊號。

### Fast / Isolated / Repeatable / Self-validating / Timely

**每一條**測試都要同時滿足：

| | 意思 | 可觀察判準 |
| --- | --- | --- |
| Fast | 幾秒內跑完 | 診斷過程會跑幾十次；慢的抽去 integration / e2e |
| Isolated | 不依賴執行順序、不共享可變狀態 | 單獨跑與整包跑結果相同 |
| Repeatable | 任何環境、任何時間點結果相同 | 見下方 E2E fixture 時間錨點；無網路、無鐘點、無亂數未 seed |
| Self-validating | 失敗 = 非 0 exit，不靠人看 log | 沒有「跑完自己看輸出對不對」 |
| Timely | 與生產碼同時寫 | 見上方 TDD 三法則 |

### 一個測試只驗一個概念

`it('creates user, sends mail, and updates audit log')` 失敗時看不出壞的是哪一件，要拆成三條。
共用的 setup 抽 helper，不要靠把三件事塞進同一條來「少寫 setup」。

### Build-Operate-Check

每條測試都要看得出三段：準備資料 → 執行被測動作 → 斷言。低階 fixture（直接組 SDK client、
手寫 SQL row）要抽成 domain helper（`givenPendingOrder()`），讓 Build 段讀起來是領域語言。

## E2E 以風險路徑排序，非數量

E2E 不用「跑了幾條」或 coverage % 當 KPI——真正會出事的是失敗路徑、權限切換、資料邊界，不在 happy path 露面。測試名稱要對應風險（`rejects when user lacks write permission on shared resource`，不是 `clicks button`）。

對每條 change / PR 先問：**這次改動最可能出事的路徑是什麼？** 排序（高到低）：

1. **權限 / 認證邊界** — 用低權限 user 跑、過期 token、無 session、cross-tenant
2. **資料一致性** — partial write、concurrent update、cache invalidation、race condition
3. **失敗情境** — DB 連不上、external API timeout、middleware reject、quota exceeded
4. **input 邊界** — null / empty / max+1 / Unicode / SQL injection 嘗試
5. **Happy path** — 最後才覆蓋，用來確認流程沒壞

`[verify:e2e]` item 應指向風險路徑；`@human` 場景交人判之前把 top 3 風險路徑與對應測試寫進 evidence。

### 規約最小要求

當 change 動到下列任一類別，archive 前要在 design.md 或 proposal.md 列出對應風險路徑：

- 認證 / 授權邏輯
- DB schema migration
- 跨服務 / 跨 module 的 contract（API / event / cache key）
- payment / billing / 不可逆操作
- 資料 deletion / soft-delete logic

其他 change 為建議，不強制、不設 CI gate（會誤殺 typo fix）。

### 機械訊號（warn-only，TD-636）

```bash
node vendor/scripts/audit-risk-path-coverage.ts        # 恆 exit 0
```

diff 命中上列五類時，驗作用中 change 有 § Risk paths **且引用的測試檔真的存在**。**這支不升成 blocking**——findings 是 review 的對話起點。**綠燈不代表「風險路徑覆蓋足夠」**（只證明有宣告、檔在）。baseline 近 0 是預期值，不要因為「一片紅」就把它關掉或降級。

## E2E fixture 的時間錨點 MUST 相對於執行當下

E2E seed 出來的資料若帶**絕對日期**，測試就綁在寫它的那個月。UI 只要有任何 recency 分群（今天 / 昨天 / 本週 / 本月 / 更早）、保留期、或「N 天內」的篩選，同一份 fixture 過幾週後就會落進不同的桶 —— 元素預設收合、或根本不 render，於是所有依賴它可見的斷言一起 timeout。

一律用相對於執行當下的時間錨點：

```ts
// e2e/helpers.ts
export const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

// spec
seedConversation({ updatedAt: daysAgo(0) })   // 今天
seedConversation({ updatedAt: daysAgo(1) })   // 昨天
seedConversation({ updatedAt: daysAgo(60) })  // 更早
```

- 不要在 fixture / mock / seed 寫死 `'2026-04-12T09:00:00Z'` 這類絕對時刻，除非該測試**驗的就是**某個特定日期的行為（跨年、閏日、DST 邊界）—— 那種情況要在測試名稱或註解寫明為什麼日期必須固定
- 不要用「先前跑過都綠」當作沒問題的證據

這類失效在沒有任何人改動的情況下自己整批變紅。

> 相關但不同：[[timezone]] 管的是「日期怎麼被格式化 / 存取」，本節管的是「fixture 的時間錨點怎麼選」。同一份 fixture 兩條都要過。

## 跑測試的 workflow，其 paths filter MUST 含測試檔本身

`on.push.paths` / `on.pull_request.paths` 的清單若漏掉測試檔所在目錄，**只改測試的 commit 不會觸發任何 workflow** —— 修 E2E 的那次 push 驗證不了自己，紅燈也不會因為修好而轉綠，得等下一次剛好碰到清單內路徑的 commit 才一起跑。

- 把 workflow 實際會執行到的測試目錄（`e2e/**`、`test/**`、`packages/*/test/**`）列進 paths filter
- 順帶檢查 `workflow_run` 鏈：下游 workflow 的觸發條件是上游**跑了**，上游沒被觸發時下游同樣不動
- 不要只憑「我 push 了而且沒看到紅燈」判定修好 —— 先確認**真的有 run 被建立**（`gh run list --limit 3` 看 SHA 對不對）

## 對設定檔原文的斷言，標的是行為本身

本節對**每一份被 runtime 讀進去執行的宣告式原始碼**生效（workflow、compose、Dockerfile、SQL migration / function body、RLS policy、Terraform / wrangler）。斷言的標的要是可執行的那幾行，不是含註解的整段原文——註解常逐字引用實作，刪掉實作斷言仍被註解滿足（恆綠）。

原文斷言即使剝掉註解仍是弱形式（等價改寫就紅、語意改壞字串留著照綠）。有行為通道（能跑 migration、能查回結果）時一律斷言行為；沒有才退回原文斷言，並在測試檔寫明理由。

**兩條要求**：

1. **先取行為 view，再斷言**。有 parser 就 parse 後對節點斷言；純文字比對則先剝一層註解，之後所有行為斷言都走這個 view：

   ```sh
   GATE_STEP=$(awk '/<step marker>/ { inside = 1; next } inside && /^      - / { exit } inside { print }' "$WORKFLOW")
   GATE_CODE=$(printf '%s\n' "$GATE_STEP" | grep -v '^ *#')   # ← 行為 view
   code_grep() { printf '%s\n' "$GATE_CODE" | grep "$@"; }

   code_grep -qF 'select(.status != "completed")' || fail "..."
   ```

2. **每條新斷言附一次 mutation 證明**。把它要鎖的實作改壞、確認轉紅、再改回來。受保護路徑（`.github/workflows/` 等）在 repo 外的複本上跑：

   ```bash
   T=$(mktemp -d); mkdir -p "$T/.github/workflows" "$T/test/scripts"
   cp .github/workflows/<file>.yml "$T/.github/workflows/"
   cp test/scripts/<test>.sh "$T/test/scripts/"
   # 改壞 $T 內的 workflow → bash "$T/test/scripts/<test>.sh" 預期 FAIL → 還原 → 預期 PASS
   ```

   寫不出「改哪一行會讓它紅」，這條斷言就還沒被驗證過。

負向斷言（`not.toContain(X)`）的鏡像問題（註解命中造成誤報）同樣靠行為 view 解決。實例與偵測見 [[pitfall-config-assertion-satisfied-by-own-comment]]。

## Bug 診斷紀律：重現先於推理

**`NO ROOT-CAUSE GUESS BEFORE A RELIABLE RED`。**「這個一看就知道是什麼問題」「先改改看比較快」都不算遵守。

**1. 能穩定重現之前，不推測根因。** 先建一個「一跑就紅、修好就綠」的環境（註定失敗的測試、直接打 API、瀏覽器腳本、`git bisect`），且它**快**（幾秒內）又**穩**（每次錯誤訊息一致；時好時壞＝**還沒重現**）。

**2. 假設一次列 3-5 個，不要只列一個。** 只列一個會讓思路僵化在第一個念頭上。每個假設都要附「若此成立，改哪裡可以修好」 —— 寫不出驗證方案的不算假設，是感想。

**3. 動手前把假設清單交給第二雙眼睛**；沒有人可問時派 fresh-context checker 讀清單（[[checker-subagent]]）。

**4. 修完要補迴歸測試把它封死**——第 1 步那個測試留下來就是。
