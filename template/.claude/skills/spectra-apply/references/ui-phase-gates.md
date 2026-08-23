<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/spectra-apply/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# spectra-apply — Step 6c / 6d UI phase gate 細節

> 本檔是 `spectra-apply/SKILL.md` 的執行細節分冊（clade fork 加料，2026-08-02 自 SKILL.md 抽出以縮 invoke 成本）。
> SKILL.md 對應 step 的 inline pointer 指到本檔；**MUST 依 pointer 指示完整讀對應 § 再執行**。
> 行為 gate（NEVER / MUST 判定）留在 SKILL.md inline；本檔是操作 recipe / 範本 / 查表。

---

## Step 6c — 理由（<consumer-a> app-status-badge-extraction 2026-05-24 實證）

   **理由**：a UI-view refactor MUST NOT change observable behavior. <consumer-a> `app-status-badge-extraction`（2026-05-24）做 `UBadge → AppStatusBadge` refactor，但 `attendance/amendments.vue` 的 `useEmployeeListQuery({ perPage: 200 })` 違反 schema `max(100)` → API 400 → `employeeNameMap` empty → 員工 column 整列「-」。Refactor「component substitute + typecheck pass」判定通過，但 page runtime 已壞 — design review / verify:ui / manual review 全沒攔，user 親眼才抓到。Step 6c 是針對這條失效鏈的 mechanical gate。

---

## Step 6d — 理由（<consumer-a> line-notification-system 2026-06-26 實證）

   **理由**：`vendor/review-rules/patterns.json` 定義的機械可檢規則（如 `ubadge-size-ban`、`overlay-width-class`）在 pre-commit hook 有逐行 grep 的 fallback，但跨行 Vue template props（如 `<UBadge\n  size="xs"\n/>`）在 hook 首次落地前會漏抓。在 apply 階段加 multi-line 整檔掃描是 defense-in-depth。<consumer-a> `line-notification-system`（2026-06-26）的 `UBadge size="xs"` 穿過 pre-commit hook 上線即為實證。

---

## Step 6d — review-rules multi-line scan 內嵌腳本

   2. **跑 review-rules multi-line scan**：

      ```bash
      node -e "
      const fs = require('fs');
      const data = JSON.parse(fs.readFileSync('<consumer>/vendor/review-rules/patterns.json', 'utf8'));
      const rules = data.rules.filter(r => r.fileGlob === '*.vue');
      const files = process.argv.slice(1);
      const tagRe = /<[A-Z][A-Za-z]*(?:\s|\n)(?:[^>]|\n)*?\/?>/g;
      let hasError = false;
      for (const rule of rules) {
        const re = new RegExp(rule.pattern);
        const exRe = rule.excludePattern ? new RegExp(rule.excludePattern) : null;
        for (const file of files) {
          const content = fs.readFileSync(file, 'utf8');
          // multi-line: 展平 Vue tag 區塊再 match
          let m; tagRe.lastIndex = 0;
          while ((m = tagRe.exec(content)) !== null) {
            const flat = m[0].replace(/\n\s*/g, ' ');
            if (re.test(flat) && !(exRe && exRe.test(flat))) {
              const line = content.slice(0, m.index).split('\n').length;
              process.stderr.write('[' + rule.id + '] ' + file + ':' + line + ' ' + rule.message + '\n');
              if (rule.severity === 'error') hasError = true;
            }
          }
          // single-line fallback for non-tag patterns
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (re.test(lines[i]) && !(exRe && exRe.test(lines[i]))) {
              // 避免 tag-extracted 重複命中
              if (/<[A-Z]/.test(lines[i])) continue;
              process.stderr.write('[' + rule.id + '] ' + file + ':' + (i+1) + ' ' + rule.message + '\n');
              if (rule.severity === 'error') hasError = true;
            }
          }
        }
      }
      process.exit(hasError ? 1 : 0);
      " <touched-vue-files...>
      ```

---

## Step 6c — rollout 狀態

Phase 1 為 model-driven（SKILL.md 指示）；Phase 3 會把本 check 升級成 `archive-gate.sh` hard gate（master plan 3.1）。
