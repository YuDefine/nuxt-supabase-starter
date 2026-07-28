---
description: Testing anti-patterns to avoid — mock 濫用、test-only production methods、不完整 mock、E2E fixture 寫死絕對日期
paths:
  [
    'test/**/*.ts',
    'packages/*/test/**/*.ts',
    'template/test/**/*.ts',
    'e2e/**/*.ts',
    'template/e2e/**/*.ts',
    '.github/workflows/**',
  ]
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/testing-anti-patterns.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


# Testing Anti-Patterns

## Overview

Tests must verify real behavior, not mock behavior. Mocks are a means to isolate, not the thing being tested.

**Core principle:** Test what the code does, not what the mocks do.

**Following strict TDD prevents these anti-patterns.**

## The Iron Laws

```
1. NEVER test mock behavior
2. NEVER add test-only methods to production classes
3. NEVER mock without understanding dependencies
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

**Why this is wrong:**

- You're verifying the mock works, not that the component works
- Test passes when mock is present, fails when it's not
- Tells you nothing about real behavior

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

**Why this is wrong:**

- Production class polluted with test-only code
- Dangerous if accidentally called in production
- Violates YAGNI and separation of concerns
- Confuses object lifecycle with entity lifecycle

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

**Why this is wrong:**

- Mocked method had side effect test depended on
- Over-mocking to "be safe" breaks actual behavior
- Test passes for wrong reason or fails mysteriously

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

**Why this is wrong:**

- **Partial mocks hide structural assumptions** - You only mocked fields you know about
- **Downstream code may depend on fields you didn't include** - Silent failures
- **Tests pass but integration fails** - Mock incomplete, real API complete
- **False confidence** - Test proves nothing about real behavior

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

### Gate Function

```
BEFORE creating mock responses:
  Check: "What fields does the real API response contain?"

  Actions:
    1. Examine actual API response from docs/examples
    2. Include ALL fields system might consume downstream
    3. Verify mock matches real response schema completely

  Critical:
    If you're creating a mock, you must understand the ENTIRE structure
    Partial mocks fail silently when code depends on omitted fields

  If uncertain: Include all documented fields
```

## Anti-Pattern 5: Integration Tests as Afterthought

**The violation:**

```
✅ Implementation complete
❌ No tests written
"Ready for testing"
```

**Why this is wrong:**

- Testing is part of implementation, not optional follow-up
- TDD would have caught this
- Can't claim complete without tests

**The fix:**

```
TDD cycle:
1. Write failing test
2. Implement to pass
3. Refactor
4. THEN claim complete
```

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

**Why this is wrong:**

- **`.optional()` rejects null** — Zod's `.optional()` means `string | undefined`, NOT `string | null`. JSON serialization preserves null. Forms commonly emit `null` for "user cleared the field" or "input was empty."
- **Test only covered the values the implementer thought of** — `undefined` and a string. The actual production payload is `null` (because the dialog code does `value.trim() || null`).
- **The boundary that ships to production is the one the test forgot.**

This generalizes beyond null: zero, empty string, empty array, NaN, Infinity, max-length+1, unicode, leading/trailing whitespace, mixed-case enums.

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
```

### Red flags

- Test file only contains "happy path" + "missing field" cases for an optional input
- Schema uses `.optional()` for fields the form clears to `null`
- "It works on my machine" but breaks in another environment that uses different defaults
- Test passes; manual QA submits the form and 400s

## When Mocks Become Too Complex

**Warning signs:**

- Mock setup longer than test logic
- Mocking everything to make test pass
- Mocks missing methods real components have
- Test breaks when mock changes

**Consider:** Integration tests with real components often simpler than complex mocks

## TDD Prevents These Anti-Patterns

**Why TDD helps:**

1. **Write test first** → Forces you to think about what you're actually testing
2. **Watch it fail** → Confirms test tests real behavior, not mocks
3. **Minimal implementation** → No test-only methods creep in
4. **Real dependencies** → You see what the test actually needs before mocking

**If you're testing mock behavior, you violated TDD** - you added mocks without watching test fail against real code first.

## Quick Reference

| Anti-Pattern                    | Fix                                           |
| ------------------------------- | --------------------------------------------- |
| Assert on mock elements         | Test real component or unmock it              |
| Test-only methods in production | Move to test utilities                        |
| Mock without understanding      | Understand dependencies first, mock minimally |
| Incomplete mocks                | Mirror real API completely                    |
| Tests as afterthought           | TDD - tests first                             |
| Boundary values not tested      | Enumerate null/empty/zero/max+1 boundaries; trace actual client payload |
| Over-complex mocks              | Consider integration tests                    |

## Red Flags

- Assertion checks for `*-mock` test IDs
- Methods only called in test files
- Mock setup is >50% of test
- Test fails when you remove mock
- Can't explain why mock is needed
- Mocking "just to be safe"
- Optional input field test only covers `undefined` (forgets `null` and empty string)
- Schema uses `.optional()` for a field the form sends as `null`

## The Bottom Line

**Mocks are tools to isolate, not things to test.**

If TDD reveals you're testing mock behavior, you've gone wrong.

Fix: Test real behavior or question why you're mocking at all.

## E2E 以風險路徑排序，非數量

E2E test coverage 不該用「跑了幾條」當 KPI，也不該用「按鈕能不能按、頁面能不能打開」當 confidence proxy。AI 大量產出 happy path E2E 後，**測試數量會通膨**，但對「這個 change 安不安全」的證明力卻可能下降 — 因為真正會出事的是失敗路徑、權限切換、資料邊界，這些不會在 happy path 露面。

對應 [@FortesHuang HJnWgQGJMx](https://hackmd.io/@FortesHuang/HJnWgQGJMx)：「真正昂貴的不是 coding，而是定義規則、驗證規則。」

### 反模式

- **數量 KPI**：「這條 spectra change 加了 5 條 E2E」當作 done — 不問這 5 條覆蓋了什麼風險路徑
- **Happy path bias**：登入成功 → 點某按鈕 → 看到「成功」訊息；不測登入失敗、無權限、cache 過期、duplicate request、partial write
- **Coverage % 假性 confidence**：line coverage 80% 但 critical path（auth check / migration / payment）為 0%
- **Test 名稱不對應風險**：`test('clicks button')` vs `test('rejects when user lacks write permission on shared resource')`

### 正模式

對每條 spectra change / PR，先問：**這次改動動到的程式碼，最可能出事的路徑是什麼？**

排序依據（高到低）：

1. **權限 / 認證邊界** — 用低權限 user 跑、過期 token、無 session、cross-tenant
2. **資料一致性** — partial write、concurrent update、cache invalidation、race condition
3. **失敗情境** — DB 連不上、external API timeout、middleware reject、quota exceeded
4. **input 邊界** — null / empty / max+1 / Unicode / SQL injection 嘗試
5. **Happy path** — 最後才覆蓋，用來確認流程沒壞

### 落地建議

- **Spectra change archive 前**：design.md / proposal.md 內含 § 「Risk paths」，列出該 change 動到的高風險路徑 + 對應 E2E 在哪
- **Manual review 對應**：`rules/core/manual-review.md` 的 `[verify:e2e]` marker 應指向**風險路徑**，而非 happy path
- **Review GUI 對應**：review-gui 在 archive 前可以 prompt「列出本 change 的 top 3 風險路徑跟對應測試」
- **不**強制要求所有 PR 都附 risk-path doc — 純文件 / refactor / typo change 跳過
- **不**用 coverage % 當 gate；用 risk-path 對應度當 review 對話起點

### 規約最小要求

當 change 動到下列任一類別，archive 前 **MUST** 在 design.md 或 proposal.md 列出對應風險路徑：

- 認證 / 授權邏輯
- DB schema migration
- 跨服務 / 跨 module 的 contract（API / event / cache key）
- payment / billing / 不可逆操作
- 資料 deletion / soft-delete logic

其他 change 為**建議**而非強制。違反靠 reviewer 在 manual-review tier 1/2 攔截，不靠 CI gate（會誤殺 typo fix）。

## E2E fixture 的時間錨點 MUST 相對於執行當下

E2E seed 出來的資料若帶**絕對日期**，測試就綁在寫它的那個月。UI 只要有任何 recency 分群（今天 / 昨天 / 本週 / 本月 / 更早）、保留期、或「N 天內」的篩選，同一份 fixture 過幾週後就會落進不同的桶 —— 元素預設收合、或根本不 render，於是所有依賴它可見的斷言一起 timeout。

**MUST** 用相對於執行當下的時間錨點：

```ts
// e2e/helpers.ts
export const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

// spec
seedConversation({ updatedAt: daysAgo(0) })   // 今天
seedConversation({ updatedAt: daysAgo(1) })   // 昨天
seedConversation({ updatedAt: daysAgo(60) })  // 更早
```

- **NEVER** 在 fixture / mock / seed 寫死 `'2026-04-12T09:00:00Z'` 這類絕對時刻，除非該測試**驗的就是**某個特定日期的行為（跨年、閏日、DST 邊界）—— 那種情況要在測試名稱或註解寫明為什麼日期必須固定
- **NEVER** 用「先前跑過都綠」當作沒問題的證據

**為什麼值得單獨列一條**：這是最難察覺的一類失效 —— 寫的當下全綠、review 時全綠、CI 連續數週全綠，然後在沒有任何人改動的情況下自己變紅。定位成本高（第一反應永遠是「誰動了什麼」，而答案是沒有人），而且會整批發作。

實證（2026-07-28 <consumer-c>）：4 個 spec 的 seeded conversation 用 2026 年 4 月的固定日期，7 月起全部落入預設收合的「更早」bucket，sidebar 看不到對話 —— 單一 anti-pattern 造成 8 條失敗，且與同批其他 7 條無關的失敗混在一起，掩蓋了彼此的根因。

> 相關但不同：[[timezone]] 管的是「日期怎麼被格式化 / 存取」，本節管的是「fixture 的時間錨點怎麼選」。同一份 fixture 兩條都要過。

## 跑測試的 workflow，其 paths filter MUST 含測試檔本身

`on.push.paths` / `on.pull_request.paths` 的清單若漏掉測試檔所在目錄，**只改測試的 commit 不會觸發任何 workflow** —— 修 E2E 的那次 push 驗證不了自己，紅燈也不會因為修好而轉綠，得等下一次剛好碰到清單內路徑的 commit 才一起跑。

- **MUST** 把 workflow 實際會執行到的測試目錄（`e2e/**`、`test/**`、`packages/*/test/**`）列進 paths filter
- **MUST** 順帶檢查 `workflow_run` 鏈：下游 workflow 的觸發條件是上游**跑了**，上游沒被觸發時下游同樣不動
- **NEVER** 只憑「我 push 了而且沒看到紅燈」判定修好 —— 先確認**真的有 run 被建立**（`gh run list --limit 3` 看 SHA 對不對）

實證（2026-07-28 nuxt-supabase-starter）：`Template CI` 的 paths 有 `template/app/**`、`template/server/**`、`template/scripts/**` … 就是沒有 `template/e2e/**`；`Template E2E` 又是 `workflow_run: [Template CI]` 觸發。結果修 `e2e/fixtures/index.ts` 的 commit 既不跑 CI、也不跑 E2E，得手動 `gh workflow run` 才驗得到。同一份清單也漏了 `template/packages/**`，單元測試的修正一樣不觸發。
