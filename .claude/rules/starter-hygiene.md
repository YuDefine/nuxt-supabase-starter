---
description: 維護 nuxt-supabase-starter 時區分 root meta repo 與 template starter seed，防止私人資料、dogfood 業務碼、未標記 starter-only 內容污染 scaffold 輸出
globs:
  - CLAUDE.md
  - template/**
  - scripts/**
  - .husky/**
  - openspec/changes/**
---

# Starter Hygiene

這份 rule 是 `nuxt-supabase-starter` root meta repo 的 starter hygiene source of truth。它規範維護者與 agent 在改檔前如何判斷「root meta 維護層」與 `template/` starter seed 的邊界，並提供 hook、audit script、review 共用的 violation 名稱與回報格式。

`template/.claude/rules/` 是 clade-managed projection，會跟著 starter seed 被 scaffold 帶走；**NEVER** 把 root meta hygiene 政策寫到 `template/.claude/rules/`。

## 邊界定義

| Surface                                                                 | 責任                                                               | 會被 scaffold / degit 帶走嗎              |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------- |
| repo root `CLAUDE.md`、`.claude/rules/`、`.husky/`、`scripts/`、`docs/` | starter meta 維護、release、hook、audit、scaffolder 文件與治理規則 | 否                                        |
| `template/`                                                             | 使用者新專案會繼承的 Nuxt + Supabase starter seed                  | 是                                        |
| `template/.examples/`                                                   | starter-safe 範例、fixture、可複製參考素材                         | 是，但必須保持 placeholder / example-only |
| `template/.starter/`                                                    | starter 維護專用但刻意留在 seed 內的標記內容                       | 是，必須明確標記為 starter-only           |
| `*.starter.md`                                                          | 在一般文件目錄中刻意保留的 starter-only 文件                       | 是，檔名即為標記                          |

屬於 root meta 的工作：

- root hook、audit script、release / validate / create-clean / scaffolder 維護腳本。
- starter 維護者文件、治理規則、跨專案同步規則。
- 只服務本 repo 維護流程、不應進入使用者 scaffold 輸出的工具或資料。

屬於 `template/` starter seed 的工作：

- scaffold 後使用者立即需要的 Nuxt app、Supabase schema、範例 env、docs、tests、agent instructions。
- 使用 placeholder、`example.com`、`localhost`、零值 UUID、範例 tenant name 的 starter-safe 預設內容。
- 可教學但不綁定真實業務域的 examples；放在 `template/.examples/` 時仍不得含私人或 tenant-specific 資料。

## Pollution 類型

下列內容進入 `template/` 時視為 starter pollution，hook 與 audit script 應使用相同 check names 回報：

| Check name                        | 阻擋內容                                                                                                                              | 常見修正                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `private-env-file`                | `template/.env`、`template/.env.local`、`template/**/.env`、`template/**/.env.local` 等私人 env 檔；`.env.example` 僅能放 placeholder | 移出 `template/`，或改成 `template/.env.example` 並清成 placeholder               |
| `secret-like-content`             | API key prefix、`Bearer` token、JWT-shaped token、Slack webhook、private key block、其他疑似 secret                                   | 移除 secret，改用 placeholder，並不要在報告中印完整值                             |
| `real-email-identifier`           | 非 placeholder 的真實 email、個人帳號、可識別使用者資料                                                                               | 改用 `user@example.com`、`admin@example.test` 或明確範例資料                      |
| `real-tenant-identifier`          | 真實 tenant slug、org id、customer id、非 placeholder UUID 或可對應實體租戶的 identifier                                              | 改用 `demo-tenant`、`example-org`、零值 UUID 或 `template/.examples/` 中的範例    |
| `unmarked-starter-only-doc`       | 一般 `template/**/*.md` 中出現 `starter-only`、`internal-only`、`do not scaffold`、`dogfood` 等未標記維護文字                         | 改名為 `*.starter.md`，或移入 `template/.starter/` / `template/.examples/`        |
| `dogfood-business-code`           | dogfood 專案的頁面、API、seed、測試、copy、schema、tenant-specific workflow                                                           | 移到 root docs / examples / playground，或另開 change 設計為 starter-safe 範例    |
| `dogfood-schema-hint`             | `template/supabase/**` 中出現特定客戶、業務域、tenant schema、private seed data 的痕跡                                                | 改成通用 starter schema，業務範例放 `template/.examples/` 並去識別化              |
| `maintenance-script-misplacement` | root 維護腳本、release / validate / audit / scaffolder tooling 誤放進 `template/scripts/`                                             | 移到 repo root `scripts/`，`template/scripts/` 只保留 scaffold 後專案會用到的腳本 |

## Spectra session 分流規則

開始 Spectra change 前先判斷 path 層級：

- 只改 root meta：proposal / design / tasks 使用 repo root path 或從 `template/` cwd 表示為 `../...`，例如 `../.husky/pre-commit`、`../scripts/audit-template-hygiene.sh`。
- 只改 starter seed：path 以 `template/` cwd 為準，寫成 `app/**`、`server/**`、`supabase/**`、`docs/**` 等；這些內容會被 scaffold 帶走。
- 同時改 root meta 與 `template/`：proposal、design、tasks 都 MUST 標註 path 層級，分清 root paths 與 template paths，並說明為什麼必須跨層。
- 發現需求其實屬 strip manifest、create-clean output rewriting、scaffolder CLI behavior、validate-starter CI gate integration：本 rule 只負責邊界判斷，MUST 另開對應 change，不要塞進 starter hygiene 邊界工作。
- 需要保留 starter-only 內容在 `template/`：MUST 使用 `template/.starter/`、`template/.examples/` 或 `*.starter.md`，不要放在一般文件路徑假裝是使用者專案文件。

判斷不清楚時，先把候選檔案列成 root meta / starter seed / follow-up 三欄；若同一個 task 同時混到多層且無法明確驗收，先調整 Spectra artifacts，不要直接實作。

## Reporting Format

rule、pre-commit hook、audit script、fixture test 的 starter hygiene violation MUST 使用同一個標題格式：

```text
[Starter Hygiene] <check name> 不通過
```

每則 report MUST 包含四段，且不得印出完整 secret value：

```text
[Starter Hygiene] <check name> 不通過
問題: <一行說明違反的邊界或污染類型>
證據: <檔案路徑；secret 僅列 pattern category 或 redacted 摘要>
修正方式: <移出 template、改 placeholder、改到 .examples/.starter、或改名 *.starter.md>
繞過方式: <只有在 Spectra artifact / PR / commit context 記錄明確 rationale 後，才允許使用維護者明示的 bypass；禁止靜默略過>
```

範例：

```text
[Starter Hygiene] private-env-file 不通過
問題: 私人環境檔不能進入會被 scaffold 帶走的 template tree。
證據: template/.env.local
修正方式: 移除該檔；若使用者需要設定範本，改用 template/.env.example 並只保留 placeholder。
繞過方式: 只有在 Spectra artifact / PR / commit context 記錄此檔為刻意保留且已去識別化後，才能使用維護者明示的 bypass。
```

Hook 與 audit script 新增或調整檢查時，MUST 先更新本 rule 的 check name 表，再同步 fixture；check name drift 視為 scanner error，應 fail closed。
