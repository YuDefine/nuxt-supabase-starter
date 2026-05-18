## Context

`nuxt-supabase-starter/template/.claude/.hub-state.json` 列出 hub:sync clade-managed 的 72 個檔案。本 change 處理 `template/.claude/commands/` 內**不在** hub-state 的 9 個 starter-owned commands。

本 change scope 不含：

- L1 hub:sync clade-managed 49 rules / 13 spectra skills / 3 commands / 5 agents / 2 scripts（由 `clade-starter-sanitization` 處理）
- L2 clade plugin marketplace skills（oops / improvement-loop / review-rules，由 `clade-starter-sanitization` 處理）
- L3 53 個 starter-owned skills（由後續 `starter-public-hygiene-skills` 處理）

## 9 個 starter-owned commands 個別 audit + disposition

每條 command 已逐檔審內容，按下列 4 個維度評估：

1. **Personal context leak**：是否含 charles@... / `/Users/charles/...` / private GitHub repo URL / 個人 release flow
2. **Generic flow**：流程是否泛用（git / gh / curl / browser-use 等通用工具），不綁特定 consumer
3. **Use case 適用 scaffolded consumer**：scaffold 出去的新 consumer 是否會用到
4. **Source 證據**：command 內容的具體判斷依據

| Command               | Leak | Generic | Useful to consumer | Disposition          | 證據                                                                                                                                                 |
| --------------------- | ---- | ------- | ------------------ | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `canary.md`           | None | Yes     | Yes                | **Keep as-is**       | 純 `curl <URL> + browser-use` 健康檢查，無 hardcode                                                                                                  |
| `freeze.md`           | None | Yes     | Yes                | **Keep as-is**       | 寫 `.claude/guard-state.json`，generic guard 機制                                                                                                    |
| `unfreeze.md`         | None | Yes     | Yes                | **Keep as-is**       | freeze 對應，generic                                                                                                                                 |
| `guard.md`            | None | Yes     | Yes                | **Keep as-is**       | guard dashboard 顯示永久保護路徑（migrations / workflows / env），通用                                                                               |
| `retro.md`            | None | Yes     | Yes                | **Keep as-is**       | 純 `git log/diff stats`，generic sprint retro                                                                                                        |
| `second-opinion.md`   | None | Yes     | Yes                | **Keep as-is**       | 純 git diff code review prompt，generic                                                                                                              |
| `ship.md`             | None | Yes     | Yes                | **Keep as-is**       | `pnpm check + git push + gh pr create`，generic CI / release flow（含 Co-Authored-By: Claude 為 Claude Code 標配，非個人化）                         |
| `sprint-status.md`    | None | Yes     | Yes                | **Keep as-is**       | `git status / log / stash + spectra / gh` dashboard，generic                                                                                         |
| `validate-starter.md` | None | No      | **No**             | **Relocate to root** | 純粹是 starter repo 自身的 self-validation tool（驗證 scaffold 出去的新 consumer 完整性），scaffolded consumer 不維護 starter，使用此 command 無意義 |

### 為什麼 8 個 keep as-is 而非 sanitize

預期之外的結論。原本假設 `ship` / `retro` / `sprint-status` 是「個人 release / dashboard 流程」，但實際讀 source 後三者都是 generic：

- `ship` 只跑 `pnpm check + git push + gh pr create`，不綁 GitHub org / repo / reviewer / labels
- `retro` 只跑 `git log/diff/stat + gh pr list`，沒 hardcode date range owner
- `sprint-status` 只跑 `git/spectra/gh` 標準命令

它們對 scaffolded consumer 也有用 — 任何用 Nuxt + Supabase + GitHub 的 user 都會 push + 開 PR + 看 sprint stats。保留是合理 default。

## `validate-starter` relocation

### 問題

`validate-starter` 是 starter repo **自身**的測試 tool — 跑 `pnpm validate-starter` 時呼叫 `scripts/validate-starter.sh`（root），會：

1. 對每個 preset（`baseline` / `d-pattern-audit` / `nuxthub-ai` / `none`）跑 scaffold simulation
2. 把 `template/` 複製到 `template/temp/validate-starter/validate-<preset>/`
3. 驗證 scaffold 出去後檔案完整性 / lint / typecheck pass

scaffolded consumer 不需要這個 — 他們的「starter」就是已經 scaffold 出去的 app，不再 validate 別人 scaffold。

但目前：

- `../scripts/validate-starter.sh`（root）✅ 正確位置（root meta tool）
- `template/.claude/commands/validate-starter.md` ❌ 進到 `template/`，會被 scaffold 帶走
- `template/.agents/skills/validate-starter/SKILL.md` ❌ 同上（sync-to-agents 投影副產物）
- `template/.codex/agents/validate-starter.toml` ❌ 同上

### 解法

1. **新建** `../.claude/commands/validate-starter.md`（root layer）— 內容同 `template/.claude/commands/validate-starter.md`，呼叫 `../scripts/validate-starter.sh`
2. **刪除** `template/.claude/commands/validate-starter.md`
3. **刪除** `template/.agents/skills/validate-starter/`（整個目錄，sync-to-agents 投影）
4. **刪除** `template/.codex/agents/` 內對應 validate-starter projection 檔
5. 後續 sync-to-agents.mjs 跑時 `template/` 內不會再生出 validate-starter projection（因為 source `template/.claude/commands/validate-starter.md` 不存在）

starter 維護者用法：

```bash
# 在 root（~/offline/nuxt-supabase-starter）跑：
/validate-starter           # invokes ../.claude/commands/validate-starter.md
# 或：
pnpm validate-starter       # invokes ../scripts/validate-starter.sh directly
```

scaffolded consumer 用法：不用，他們不會看到此 command。

### sync-to-agents 機制澄清

`template/.agents/`、`template/.codex/`、`template/AGENTS.md` 都是 `sync-to-agents.mjs` 從 `template/.claude/` 投影出來。當 source 從 `template/.claude/commands/validate-starter.md` 移除後，下次 sync-to-agents 跑會自動清掉 projection。本 change 為了**乾淨度**手動刪除 projection（不等下次 sync），避免 PR 多帶 dangling projection。

## `audit-public-hygiene.mjs` 設計

### Scope

掃 `template/.claude/commands/` + `template/.agents/skills/` + `template/.codex/`，對每個檔案分類：

- **clade-managed**（hub-state.json checksums 列出）→ 跳過（由 `clade-starter-sanitization` 管）
- **starter-owned in allowlist**（design.md 本表 9 條 keep as-is + 後續 53 個 skills 經 `starter-public-hygiene-skills` 通過審查者）→ pass
- **starter-owned not in allowlist**（新加 / 未審查）→ warning，要求補審查紀錄
- **path 命中 deny-list**（如 `validate-starter`）→ error，required cleanup

### Allowlist 格式

`scripts/lib/public-hygiene-allowlist.json`：

```json
{
  "commands": {
    "starter-owned-keep": [
      "canary",
      "freeze",
      "unfreeze",
      "guard",
      "retro",
      "second-opinion",
      "ship",
      "sprint-status"
    ],
    "starter-owned-relocate": ["validate-starter"],
    "starter-owned-deny": []
  },
  "skills": {
    "starter-owned-keep": [],
    "starter-owned-relocate": [],
    "starter-owned-deny": []
  },
  "comment": "Skills 部分由 starter-public-hygiene-skills change 後續填入"
}
```

### CLI

```bash
node scripts/audit-public-hygiene.mjs                # default: error if violation
node scripts/audit-public-hygiene.mjs --json         # CI 機器輸出
node scripts/audit-public-hygiene.mjs --strict       # warning 也 fail-fast
node scripts/audit-public-hygiene.mjs --report-only  # 只報告，exit 0
```

### CI 整合

`package.json` 加 script `audit:public-hygiene`：`node scripts/audit-public-hygiene.mjs`。

GitHub Actions `.github/workflows/audit.yml`（既有 audit workflow 加 step）：

```yaml
- name: Audit public hygiene
  run: pnpm audit:public-hygiene
```

未過 fail PR。

## `starter-hygiene.md` 規則檔擴充

`../.claude/rules/starter-hygiene.md` 新增一節 `## L3 Commands Hygiene`：

- 邊界定義：`template/.claude/commands/` 內檔案分 clade-managed vs starter-owned
- 新加 starter-owned command 流程：必須走 `starter-public-hygiene-commands` 後續 change 補 audit + 加 allowlist
- audit script 觸發：每 PR + monthly cron
- bypass：不允許（任何例外都要走 change ceremony 加 allowlist）

## Risk / Trade-off

| Risk                                                                              | Impact                                         | Mitigation                                                                                                                      |
| --------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 8 個 keep as-is 之中某條未來引入 personal leak                                    | 低 — review-by-PR 會抓                         | audit script 每 PR 跑，未通過審查的新 command 會被警告                                                                          |
| `validate-starter` relocation 漏網某個 projection 路徑（`.codex/` / `AGENTS.md`） | 中 — scaffold 出去帶 dangling 內容             | tasks 內列具體刪除清單，並要求 sync-to-agents 重跑驗證                                                                          |
| Skills 部分先不審（53 個太大）造成本 change 半 effective                          | 中 — `template/.claude/skills/` 仍可能含個人化 | 本 change proposal 明示 scope，後續 `starter-public-hygiene-skills` 接續處理；audit script 先 stub skills 段為「未審查」warning |
| Audit script 跟 hub-state 解析邏輯 drift                                          | 低 — hub-state 是 JSON，schema 穩定            | 對 hub-state.json 加 unit test 驗 checksum 結構                                                                                 |

## Alternatives considered

- **整檔 deny / 整檔 keep 二元** — 拒絕，因為 9 個 commands 內容差異大，個別審查才不誤殺
- **不寫 audit script，靠 PR review 抓** — 拒絕，新 maintainer / 公開 contributor 不知道 hygiene 規則，需要機械 gate
- **把 8 個 keep commands 都 sanitize 改成 placeholder** — 不必要，內容已 generic，sanitize 只會引入無意義 churn

## Open questions

1. `starter-public-hygiene-skills`（53 個 skills 審查）的 scope 規模 — 是否該再分批（如按 prefix / 用途分 sub-change）？留給 next change propose 決定，本 change 不 block
2. `validate-starter` relocation 後是否該同步加 `pnpm create nuxt-supabase-starter` scaffold CLI 的 `--keep-validate-starter` flag（給 starter 維護者繼承）— 預設不需要，因為公開讀者 fork 後若要維護 starter 自然會 commit `validate-starter`；不為「假想需求」加 flag
