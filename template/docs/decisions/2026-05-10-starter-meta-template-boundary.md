---
audience: maintainers
applies-to: starter-governance
---

# Starter Meta Template Boundary

## Decision

`nuxt-supabase-starter` 採用三層 starter hygiene governance：

- **A. Boundary**：本次 starter hygiene boundary rule、pre-commit enforcement、離線 audit script。這是本 change 的範圍。
- **B. Projection / Strip Manifest**：後續由 strip manifest / projection cleanup 決定哪些 meta-only 檔案不得進 scaffold output；這屬於 Change 2 `scaffolder-strip-manifest-and-validation-gate`，不在本 change 實作。
- **C. Validation Gate**：後續由 validate-starter / CI gate 驗證 scaffold output 是否乾淨；這同樣屬於 Change 2 `scaffolder-strip-manifest-and-validation-gate`，不在本 change 實作。

本次先做 A，因為 B/C 都需要先有穩定的邊界語彙，才能判斷什麼算污染、什麼算 starter-safe example、什麼必須保留在 root meta 層。

## Context

這個 repository 同時有兩個角色：

- repo root 是 meta 維護層，包含 release、scaffolder、hub sync、rules、hooks、vendor scripts、跨專案治理文件。
- `template/` 是 starter seed，使用者 scaffold / degit 後會直接帶走。

若缺少明確邊界，dogfood 業務碼、私人 `.env`、真實 email / tenant identifier、secret-like token、未標記 starter-only 文件，都可能被放進 `template/`，進而污染所有新專案。反過來，若把 root meta 維護邏輯塞進 `template/scripts/` 或 `template/.claude/rules/`，也會讓 scaffold output 帶走不該屬於一般 starter 專案的維護面。

## Alternatives Considered

- **DB-only enforcement**：拒絕。這類污染多半發生在檔案、文件、hook、seed、example，不是資料庫 constraint 能完整防住。
- **只合併到既有 commit hook**：拒絕。hook 可以擋 staged 污染，但沒有 root rule 作為 source of truth 時，check name、例外、繞過條件會快速 drift。
- **不新增 root rule**：拒絕。若只把規則寫在 hook、audit script 或 template projection，agent session 入口與 review 判準會失去共同語彙。
- **只補文件提醒**：拒絕。文件能降低誤判，但不能阻止私人 env 或 secret-like content 進 commit history。
- **直接做 B/C 全套**：拒絕。strip manifest 與 validate-starter gate 需要先依賴 A 的邊界定義；沒有 A 會把後續 gate 寫成臆測規則。

## Trade-offs Accepted

- fail-closed hook 會讓部分合法範例被 false positive 擋下，但相較於污染 scaffold output，先擋下再用 marker 或 documented bypass 說明更安全。
- regex-based scanner 可能漏掉未知 secret 或 business entity，但集中在 rule / hook / audit script 的同一組 check name 後，可以用 fixture 與後續 CI gate 漸進補強。
- root meta 與 `template/` path 在 Spectra artifacts 中需要更明確標註，增加 propose/apply 階段文字成本，但能降低跨層改動誤落點。

## Consequences

- root `.claude/rules/starter-hygiene.md` 成為 starter hygiene 的行為規範 source of truth。
- root `.husky/pre-commit` 在 staged `template/` 檔案進 history 前執行 fail-closed enforcement。
- root `scripts/audit-template-hygiene.sh` 提供可由 apply、commit、CI 重用的 full-tree audit entrypoint。
- `template/.claude/rules/` 維持 clade-managed projection，不承擔 root meta hygiene policy。
