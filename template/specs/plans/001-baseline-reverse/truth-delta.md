# Truth delta：backend 逆向基準線（001-baseline-reverse）

> **Green 不該需要改產品碼。** 下游若照這份 truth 跑 `/tasks`，`[BDD-GREEN]` 需要動產品碼，代表逆向描述跟程式碼不一致——先回本 package 修 truth。
> 例外只有 `@code-mismatch`（規則原意與產品碼不符、待裁決）；目前沒有任何 `@code-mismatch`。

**性質**：逆向基準線。truth 描述程式碼現在做什麼，不是應該做什麼。所有 ADD 描述的行為已存在於產品碼，因此本 package 省略 `spec.md` 與 acceptance feature。
**範圍**：backend 介面、試點模組 `profiles`。frontend 介面尚未開 package（見 `coverage/modules.md`）。
**work id**：`W-2026-10-02-nuxt-supabase-starter-aixbdd-b3`（`specs/truth/work-lifecycle.md` 尚不存在，本 repo 屬未遷移 consumer，故用 `NNN-` 目錄）。

| owner | 動作 | 單元 | 分冊 |
| --- | --- | --- | --- |
| `/technical-research` | ADD | `specs/truth/techstack.md` | `truth-delta/technical-research.md` |
| `/api-plan` | ADD | `specs/truth/contracts/{openapi,profiles}.yaml` | `truth-delta/api-plan.md` |
| `/data-plan` | ADD | `specs/truth/data/{data-model,profiles}.dbml` | `truth-delta/data-plan.md` |
| `/dsl-refine` | ADD | `specs/truth/features/backend/{dsl.md,profiles/**}` | `truth-delta/dsl-refine.md` |

## 產出工具

| 工具 | 作用 | 重跑判準 |
| --- | --- | --- |
| `tools/build-inventory.mjs` | 從程式碼機械產生 `mapping/inventory.md`（路由、資料表、頁面、既有測試） | 重跑後 `git diff` 為空 |
| `tools/check-truth.mjs` | 只讀檢查：x-source、模組鍵、DBML 表集合、feature↔dsl、驗證狀態、覆蓋矩陣 | exit 0 |

合約、DBML、feature 是人依盤點寫成，沒有產生器；因此沒有「重跑產生 truth」的腳本，檢查腳本是它們的回歸防線。
