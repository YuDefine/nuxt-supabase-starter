# 上游 aixbdd 覆寫：lifecycle 落點與 canonical doctor

clade 對上游 aixbdd owner 只做加法：上游檔維持 pin 的原文，clade 的調整全部寫在本檔。每一列寫明被覆寫的上游原句（anchor）與判準：

- 判準命中 → 照該列「覆寫後怎麼做」，該列 anchor 那句上游原文在命中範圍內不適用
- 判準沒命中 → 照上游原文，本檔該列不適用

anchor 由 `scripts/audit-upstream-overrides.ts` 對 pin 的 `vendor/aixbdd/.agents/skills/**` 逐字核對；上游改了那句，稽核會 exit 非零並指名該列，該列要重新核對後才能推 pin。本檔沒有列到的上游句子一律照原文。

## 判準

- **L｜lifecycle 落點**：本次 plan package 的 `plan.md` frontmatter 同時含 `work_id:` 與 `truth_baseline:` 兩個鍵。判準只看這兩個鍵；**NEVER** 用 repo 名、manifest、`specs/truth/**` 是否存在或任何其他檔案推斷。
- **D｜canonical doctor**：repo 的 `.claude/hub.json` `modules.capabilities` 含 `aixbdd`，也就是適用 fleet canonical doctor 契約的 clade consumer。doctor 命令依 repo 已確認的 package manager、workspace root、技術棧與既有 canonical project check 決定；**NEVER** 把 `pnpm run doctor` 當跨 repo 預設，也 **NEVER** 用固定 exit 0 的包裝器或 no-op 代替。

命中 L 時，下表的「L 落點」指這五點：

1. package 路徑是 `flow plan open` 鑄出的 `specs/plans/<work-id>/`（`W-<YYYY-MM-DD>-<slug>`）。owner **NEVER** 自行建立 package 目錄、**NEVER** 遞增 `NNN` 編號；同一件工作續跑同一個 package，**NEVER** 開第二份。
2. `plan.md` 是 lifecycle 檔、由 `flow` 持有：owner **NEVER** 建立、覆寫或刪除它。
3. 系統分析寫在、也從同 package 的 `system-analysis.md` 讀。
4. 本輪 truth delta 的載體是 `plan.md` 的 `## Truth delta` 表，欄位固定 `id`、`action`、`unit`、`reason`、`state`（`proposed`／`applied`／`withdrawn`），owner 新寫入的列 `state` 一律 `proposed`。該 package 沒有 `truth-delta.md`，owner **NEVER** 建立一份。
5. 被省略的 artifact 在 `plan.md` 的 `## Decisions` 留一行工作特定理由（例：CLI-only 需求沒有 `ui-plan.md`）；`work_kind` 決定的省略不寫 Decisions，見同目錄 `工作種類與必要產物.md`。

`flow` 的 specification-readiness 與 close gate 會機械擋下：package 內出現 `truth-delta.md`、lifecycle repo 在本工作期間新增 `specs/plans/NNN-*` 目錄、`plan.md` 原有的 `work_id`／`truth_baseline` frontmatter 消失。被擋就照上面五點修，**NEVER** 為了過 gate 改 frontmatter。

## L 族覆寫

| owner skill | 上游 anchor（檔＋原句逐字） | 判準 | 覆寫後怎麼做 |
| --- | --- | --- | --- |
| specify | `specify/rules/Feature目錄命名與輸出定位判準.md`：「`/specify` 每次執行都必須在 `specs/plans/` 下建立新的 `NNN-<slug>` plan package。」 | L | package 就是 L 落點 1 的 `specs/plans/<work-id>/`，已由 `flow plan open` 鑄出；Rule 1 的編號遞增與目錄建立不適用 |
| specify | `specify/rules/Feature目錄命名與輸出定位判準.md`：「`/specify` 只能寫入 `spec.md`、`checklists/requirements.md` 與初始化 `truth-delta.md`。」 | L | 可寫檔只有 `spec.md` 與 `checklists/requirements.md`；本輪 truth 變更意圖寫進 `plan.md` 的 `## Truth delta`（L 落點 4），`state` 一律 `proposed` |
| specify | `specify/SKILL.md`：「並初始化 `truth-delta.md` 骨架；本 phase 不建立或修改 `specs/truth/**`。」 | L | Phase 1 不建目錄、不建 `truth-delta.md`、不碰 `plan.md`（L 落點 1、2、4） |
| specify | `specify/SKILL.md`：「本次是否進入 `/clarify`、仍保留的 `NEEDS CLARIFICATION` 或假設，以及此 plan 是否可進入 `/spec-by-example` 或 `/technical-research`。」 | L | Phase 5 回報的 truth delta 落點是 `plan.md` 的 `## Truth delta` 表，**NEVER** 回報 `truth-delta.md` 路徑；同時回報被省略的 artifact 已在 `## Decisions` 留理由（L 落點 5） |
| system-analysis | `system-analysis/SKILL.md`：「READ 讀取使用者需求、呼叫者要求、目標 plan package 的 `spec.md`、`research.md`、`truth-delta.md`、既有 `plan.md`、`specs/truth/techstack.md` 與相關 `specs/truth/**`。」 | L | 既有系統分析讀 `system-analysis.md`，truth delta 讀 `plan.md` 的 `## Truth delta`（L 落點 3、4） |
| system-analysis | `system-analysis/SKILL.md`：「將系統介面盤點、Wave、分析重點與委派理由寫入」 | L | 輸出檔改為同 package 的 `system-analysis.md`；**NEVER** 建立、覆寫或刪除 `plan.md`，package 目錄已存在不另建（L 落點 1–3）。Phase 4 回報的輸出檔路徑同樣是 `system-analysis.md` |
| system-analysis | `system-analysis/SKILL.md`：「每次 handoff 都必須包含 plan package path、truth root、truth-delta path、介面名稱與分析重點。」 | L | handoff 的 truth-delta path 換成「`plan.md` 的 `## Truth delta` 表」 |
| api-plan | `api-plan/SKILL.md`：「READ 讀取使用者需求、呼叫者 handoff、plan package 的 `spec.md`、`research.md`、`plan.md`、`truth-delta.md`、`specs/truth/techstack.md`、既有 `specs/truth/contracts/**` 與指定後端 / API 介面名稱。」 | L | 系統分析內容讀 `system-analysis.md`，truth delta 讀 `plan.md` 的 `## Truth delta`（L 落點 3、4）；`plan.md` 只讀不寫 |
| data-plan | `data-plan/SKILL.md`：「READ 讀取使用者需求、呼叫者 handoff、plan package 的 `spec.md`、`research.md`、`plan.md`、`truth-delta.md`、`specs/truth/techstack.md`、既有 `specs/truth/data/**` 與指定資料介面名稱。」 | L | 同 api-plan |
| ui-plan | `ui-plan/SKILL.md`：「READ 讀取使用者需求、呼叫者 handoff、plan package 的 `spec.md`、`research.md`、`plan.md`、`truth-delta.md`、既有 `ui/**`」 | L | 同 api-plan |
| ui-plan | `ui-plan/SKILL.md`：「WRITE 將 UI 規劃寫入 `specs/plans/NNN-<slug>/ui/ui-plan.md`。」 | L | `specs/plans/NNN-<slug>/` 換成 L 落點 1 的 `specs/plans/<work-id>/`；同 Phase 的 `ui/*.html` 也一樣 |
| dsl-refine | `dsl-refine/SKILL.md`：「READ 讀取使用者要求、目標 plan package 的 `features/acceptance/**`、`plan.md`、`truth-delta.md`、`specs/truth/techstack.md`」 | L | 同 api-plan |
| spec-by-example | `spec-by-example/SKILL.md`：「WRITE 若 `specs/plans/NNN-<slug>/features/acceptance/` 尚不存在，建立該目錄。」 | L | 目錄換成 `specs/plans/<work-id>/features/acceptance/`；**NEVER** 另建 `NNN-<slug>`（L 落點 1） |
| spec-by-example | `spec-by-example/rules/輸出位置與acceptance切檔判準.md`：「`/spec-by-example` 的輸出位置固定為 `specs/plans/NNN-<slug>/features/acceptance/*.feature`。」 | L | 輸出位置改為 `specs/plans/<work-id>/features/acceptance/*.feature` |
| technical-research | `technical-research/SKILL.md`：「WRITE 將 decision-driven 研究內容寫入 `specs/plans/NNN-<slug>/research.md`。」 | L | 輸出路徑換成 `specs/plans/<work-id>/research.md`（L 落點 1） |
| technical-research | `technical-research/rules/Research輸出定位與spec後接續判準.md`：「`/technical-research` 的 decision-driven 研究過程必須輸出到 `specs/plans/NNN-<slug>/research.md`。」 | L | 同上 |
| truth-delta | `truth-delta/SKILL.md`：「WRITE 若 `truth-delta.md` 尚不存在，於當前 plan package 建立該檔案，並填入 plan package、truth root 與四個 truth owner section。」 | L | **NEVER** 建立 `truth-delta.md`；Phase 1 步驟 3、4 與 Phase 3 的 owner section 操作全部改對 `plan.md` 的 `## Truth delta` 表的列進行，新列 `state` 一律 `proposed`（L 落點 4） |
| tasks | `tasks/SKILL.md`：「READ 讀取使用者需求、目標 plan package 的 `spec.md`、`plan.md`、`research.md`、`ui/**`、`truth-delta.md`」 | L | 同 api-plan |
| tasks | `tasks/SKILL.md`：「WRITE 依 template 骨架輸出 `specs/plans/NNN-<slug>/tasks.md`。」 | L | 輸出路徑換成 `specs/plans/<work-id>/tasks.md`（L 落點 1） |
| implement | `implement/SKILL.md`：「READ 讀取使用者需求、目標 plan package、`tasks.md`、`truth-delta.md` 與目前 task 完成狀態」 | L | truth delta 讀 `plan.md` 的 `## Truth delta`，系統分析讀 `system-analysis.md`（L 落點 3、4） |

## D 族覆寫

| owner skill | 上游 anchor（檔＋原句逐字） | 判準 | 覆寫後怎麼做 |
| --- | --- | --- | --- |
| tasks | `tasks/SKILL.md`：「本輪新增技術先寫 Setup；」 | D | 本輪新增技術先寫 Setup；canonical doctor 缺失或非零時，即使本輪沒有新增技術，也以 doctor bootstrap／repair 例外先寫 Setup，再寫 Foundational |
| tasks | `tasks/SKILL.md`：「不得把 helper、fixture 或落點骨架塞進 Setup。」 | D | 「沒有新增技術就省略 Setup」只在 canonical doctor 已存在且通過時成立；doctor 缺失或非零時 Setup 例外保留一個具名、無依賴、可解鎖的 bootstrap／repair task。helper、fixture、落點骨架照舊不進 Setup |
| tasks | `tasks/rules/TruthDelta影響盤點與任務型態判準.md`：「在本輪有新增技術時建立：寫清套件名、配置、技術環境與最後的 smoke-test；不寫 DSL 語意、不寫產品行為。」 | D | 同上一列的 Setup 例外；Phase 5 回頭檢查時，doctor 缺失或非零就確認 bootstrap／repair Setup task 在 |
| tasks | `tasks/SKILL.md`：「READ 回頭檢查：任務皆為 `- [ ] T###`、truth-delta 已納入 Core Inputs、沒有 Impact Audit phase、有新增技術時 Setup 寫清套件名與 smoke-test」 | D | 回頭檢查之後照下方 § tasks：產出後跑 doctor 執行，並把 § Doctor Gate 段附加進 `tasks.md` |
| tasks | `tasks/templates/tasks.md`：「- Phase 1 `Setup` 只做本輪新增技術的基礎建設、技術環境與最後的 smoke-test；」 | D | `tasks.md` 的 Task Binding Contract 這一條補上「canonical doctor 缺失或非零時，即使本輪沒有新增技術，也保留一個 doctor bootstrap／repair Setup task」 |
| implement | `implement/SKILL.md`：「READ 讀取 `rules/完成定義-驗證與回寫判準.md`，確認 task 完成條件與回寫條件。」 | D | Phase 5 回寫 `[X]` 之前照下方 § implement：回寫前跑 doctor 執行 |
| implement | `implement/rules/完成定義-驗證與回寫判準.md`：「單一 task 的完成條件至少包含：所需變更已實作、對應檔案已寫入、」 | D | 完成條件另加「consumer 的 canonical doctor 已在該 task 的邊界內執行並 exit 0」；「doctor 尚未執行／非零」不算完成 |
| implement | `implement/rules/完成定義-驗證與回寫判準.md`：「Setup 完成條件是：該則寫明的套件與配置已在，且 smoke-test 證明連得上」 | D | doctor bootstrap／repair task 的完成條件另要：真實 canonical doctor 在健康 fixture exit 0、在刻意違規 fixture 非零，證明入口有效 |
| implement | `implement/rules/完成定義-驗證與回寫判準.md`：「失敗只能是 assertion 或產品行為，不能是 undefined step。」 | D | `[BDD-RED]` 可保留預期紅燈，但不免除該 task 自己的 canonical doctor receipt，且 receipt 必須 exit 0；**NEVER** 排除紅燈測試來製造 doctor 綠燈 |

### tasks：產出後跑 doctor

<!-- clade-doctor-hook: tasks-after-generation -->

命中 D 時，`/tasks` 產出 `tasks.md` 並通過回頭檢查後：

1. 執行 consumer 的 canonical doctor 一次，在 `tasks.md` 或本輪 carrier 留下可重跑的 receipt：命令、cwd、package manager／workspace root、exit code、狀態（`pass`／`needs-repair`／`blocked`）與失敗摘要。
2. doctor 通過標 `pass`。doctor 非零或入口缺失時保留真實失敗，在 Setup 新增一個具名、無後續依賴且可解鎖的 bootstrap／repair task，排在依賴它的 task 之前，標 `needs-repair` 或 `blocked`。這代表 doctor 未通過，不代表 tasks artifact 沒產出；`/tasks` **NEVER** 越權實作修復，交 `/implement` 執行該 task。環境不可達時具名記錄 blocked 原因與證據。
3. 把下面的 `## Doctor Gate` 段附加進 `tasks.md`，放在 Task Binding Contract 之後、Phase 1 之前：

```md
## Doctor Gate

- `tasks.md` 產出後必須執行 consumer 的 canonical doctor，並保存命令、cwd、package manager／workspace root、exit code、狀態（`pass`／`needs-repair`／`blocked`）與失敗摘要。
- doctor 非零或入口缺失時，tasks artifact 仍可完成產出，但必須在 Setup 建立一個具名、無後續依賴且可解鎖的 bootstrap／repair task；交 `/implement` 執行並重新跑 doctor，不能在 `/tasks` 越權修復，也不能用 no-op 或固定 exit 0 的替代品。
- 若 doctor 依賴後續 task，必須重排依賴或把入口初始化前移；不得在當前 task 偷修後續責任。
- `[BDD-RED]` 的預期 assertion／產品行為失敗是測試層狀態，不是 canonical doctor 失敗；保留該測試與紅燈證據，並另外取得 doctor 自己的 exit 0 receipt。
```

Doctor gate 契約：

- 有既有 canonical doctor：以 repo 自己的入口執行，健康 fixture 必須 exit 0，刻意違規 fixture 必須非零。
- 沒有入口：Setup 產出一個可解鎖的 bootstrap task，交 `/implement` 建立並驗證 canonical doctor；不能建立只回 0 的包裝器，也不能把後續 task 當成 doctor 已存在的證據。
- doctor 需要後續 task 才能通過：把依賴重排到 Setup／前置 task，保留 gate，不在當前 task 偷修後續責任。
- package manager、workspace root 或命令不確定：先以 repo canonical 文件／設定收斂；仍無法判定時記錄阻塞，不猜 `pnpm`。

bootstrap task 的交付形狀至少要讓下一個 agent 能直接執行：

```md
- [ ] T### Bootstrap canonical doctor（unlocked、無前置依賴）
  - Doctor receipt: status=`needs-repair`／`blocked`, command=`...`, cwd=`...`, exit=`...`, evidence=`...`
```

修復後只把同一個 `T###` 改成 `[X]`，並附新的 canonical doctor receipt；具名任務能唯一對應時，不要求虛構固定數字。

### implement：回寫 `[X]` 前跑 doctor

<!-- clade-doctor-hook: implement-before-task-complete -->

命中 D 時，`/implement` Phase 5 的回寫順序改為：

1. 每一個 task（`Parallel Hint` 批次裡的每一個 task 各自）在回寫 `[X]` 之前執行 canonical doctor，取得自己的 receipt；批次成員**NEVER** 共用一張 receipt，也 **NEVER** 在任一成員拿到 receipt 前先標其他成員完成。
2. doctor 缺失：先執行已具名、已解鎖的 Setup bootstrap task，**NEVER** 自造固定成功的包裝器。doctor 非零：保留真實失敗，受影響 task 維持未勾選，在修復 task 的邊界內修，或回報需要的 owner／依賴。環境不可用時保持 blocked，附命令、cwd、exit status 與證據。
3. 只有實作、直接驗證與該 task 的 doctor receipt 都通過，才把該 task 改成 `[X]`，其他 task 狀態不變。
4. `[BDD-RED]` 的預期 assertion／產品行為失敗可以保留，但同一 task 的 canonical doctor receipt 必須 exit 0。
5. plan package 全部 `[X]` 且每個 task 都有自己的 doctor 證據，才回報交付並詢問是否 commit；不自動 commit。commit 0-C 步驟取得自己的 doctor receipt，**NEVER** 借用其他 task 的。
