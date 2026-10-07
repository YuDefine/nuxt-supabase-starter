---
name: bp
description: 把一條最佳實踐登記進 clade 的正確落點，或查新專案該套用哪些既有標準。Use when 使用者送 `\bp`、說「這個記成最佳實踐」「這條規範收進 clade」，或問新專案該套哪些現成標準。NOT for 寫進 memory，NOT for 散播既有改動（走 clade-publish）。
license: MIT
metadata:
  author: clade
  version: "1.0"
  clade:
    permission_tier: draft
---

<!-- clade-skill-scope: both -->

# bp — 最佳實踐落點路由

把一條最佳實踐判到 clade 的正確落點、回報理由、等確認後落地並散播；也負責列出新專案該套用的既有 convention，以及在 commit 時比對 staged diff 防重造輪子。落點是 skill 或某支 skill 的 `rules/` 時，skill 的形狀交給 `/skill-engineering` 把關。

# SOP

## Phase 1 -- 判定 mode 與 session 位置

1. READ 讀取使用者輸入，判定 record（預設：`\bp <一句話>`、「記成最佳實踐」，或 `/skill-engineering`、`/work-route` 交棒進來的一段判準或做法）、plan（新專案該套哪些標準）或 check（`/bp check`、commit 0-F）；plan 跳到 Phase 5，check 跳到 Phase 6。
2. THINK 若目前在 consumer session，記下這是 Direction B 跨界（consumer session → clade 改源頭＋散播；使用者送 `\bp` 就是明確授權），Phase 4 結束時回到原 consumer 並明示已回來。

## Phase 2 -- record：判定落點

1. THINK 先讀取 `rules/落點路由判準.md` 與 `references/落點與散播機制.md`，自答 Q1／Q2／Q3 並記下命中的列與 tie-breaker 答案，答不出的那題才整理成是非題問使用者。
2. READ 若判到 `docs/`，讀取 clade `docs/README.md` 的子目錄准入 predicate，定出子目錄。
3. THINK 依已載入規則收斂落點、要動的檔、觸發點與連帶項（conventions.json、audit signal、走 /oops 的 truth unit）；落點是新 skill、既有 skill 的流程或某支 skill 的 `rules/` 時，同時定出要走的 `/skill-engineering` lane 與目標 step。

## Phase 3 -- record：回報並等確認

1. WRITE 先讀取 `templates/落點回報.md` 與 `templates/落點回報.example.md`，依骨架回報後停下。
2. READ 讀取使用者確認或修正；未確認前不寫入任何檔，修正後回到 Phase 2 重判。

## Phase 4 -- record：落地與散播

1. READ 若要動 rule、SKILL 或 snippet 措辭，讀取 clade `rules/core/rule-authoring.md` § 先分類失敗型態，再選形式。
2. DELEGATE 若落點是新 skill，先寫 `evals/skills/<name>/cases.json`，再呼叫 `/skill-engineering` 走 create lane；若落點是既有 skill 的流程、判準或 `rules/`，呼叫 `/skill-engineering` 走 optimize lane，把確認版回報交給它當根因閘門的預期結果與落差輸入，不自己改 SKILL.md；本次 record 若是 `/skill-engineering` 逐 step 決策時交過來的，改把確認版回報交回那個 caller 的 optimize lane 落地，不另開一輪 `/skill-engineering`。
3. WRITE 其餘落點依確認版寫入；新 audit script 先過 `propagate-maintenance-mode` 三問並補 `registry/audits.json` entry。
4. DELEGATE 呼叫 `/clade-publish` 散播。

## Phase 5 -- plan：列出該套用的既有 convention

1. DELEGATE 有 consumer manifest 時執行 `node ~/offline/clade/scripts/bp-scan.ts --plan --repo <目標 repo 絕對路徑>`；還沒有 manifest（溝通期）時執行 `node ~/offline/clade/scripts/bp-scan.ts --plan --json --modules '<modules JSON>'`。
2. WRITE 把輸出的 convention、各自的 `rule_refs`／`snippet_refs`／`doc_ref` 與現況 adoption 逐條列成候選回報使用者，等逐條確認；本步只交候選清單給 consumer 自家 session，不對 consumer 業務檔動手。

## Phase 6 -- check：比對 staged diff

1. DELEGATE 執行 `node ~/offline/clade/scripts/bp-scan.ts --changed-only`。
2. THINK 先讀取 `rules/check輸出判讀判準.md`，依兩類可靠度分別處置並回報；判定出既有資產沒涵蓋的新最佳實踐時回到 Phase 2。
