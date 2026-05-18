# Brief: `clade-starter-sanitization` sister change

**Where to run**: `~/offline/clade`（**NOT** here in starter repo）

**How to invoke**:

```bash
cd ~/offline/clade
# 然後在 clade session 內：
/spectra-propose clade-starter-sanitization
```

把以下整份 brief 貼進 propose prompt（或讓 codex draft 時用作 input context）。

---

## Why（給 propose 用）

`nuxt-supabase-starter` 的定位是「真的公開、任何人可 clone」的 Nuxt + Supabase scaffold seed。但目前 starter 透過 `pnpm hub:sync` 從 clade 拉的 72 個 clade-managed 檔案，以及 clade plugin marketplace（hub-core 等）安裝的 3 個 maintainer-only skill，都帶有：

- **Consumer name leak**：`perno` / `TDMS` / `edge-rag` 在 rule 內以 adoption matrix 欄位 / 事故敘事主角形式出現
- **Personal path leak**：`/Users/charles/...` / `~/offline/clade/...` 散落各檔
- **個人 email leak**：`charles@yudefine.com.tw`、`yudefine.com.tw`
- **Internal narrative**：「實證 2026-05-18 TDMS session」「perno 2026-05-17 incident」這類事故回放段落
- **Clade-internal skill**：`oops` / `improvement-loop` / `review-rules` 是 clade 自治區工具（明文「NEVER 在 consumer session 跑」），卻被 propagate 進 `template/.agents/skills/`

公開讀者 clone starter 後拿到的 `.claude/` 全是我私人 governance baseline，缺乏 sanitization layer。

## Scope（L1 + L2，不含 L3）

**L1: hub:sync clade-managed content** — `template/.claude/.hub-state.json` checksums 列出的 72 個檔案：

- 49 rules（全部 `template/.claude/rules/`）
- 13 spectra-\* skills
- 3 commands（commit / db-migration / doc-sync）
- 5 agents（check-runner / code-review / db-backup / screenshot-review / references/clade-review-rules）
- 2 scripts（codex-review-safe.sh / commit-lock.mjs）

**L2: clade plugin marketplace skills** — clade `plugins/hub-core/skills/` 內的 maintainer-only skill：

- `oops` — cross-consumer pitfall mgmt，自治區明文
- `improvement-loop` — clade improvement-loop 契約
- `review-rules` — clade/project rules registry mgmt

**Scope 排除**：L3（starter-owned commands + skills）由 starter repo 內 `starter-public-hygiene-commands` change 處理。

## What Changes

### 1. Sanitization rule file

`vendor/sanitization-rules/starter.json`：

```jsonc
{
  "denyListSkills": ["oops", "improvement-loop", "review-rules"],
  "redactionMap": {
    "/Users/charles/": "~/",
    "/Users/charles/.local/bin/": "<HOME>/.local/bin/",
    "~/offline/clade": "<clade-central-repo>",
    "charles@yudefine.com.tw": "<maintainer-email>",
    "yudefine.com.tw": "<maintainer-domain>",
  },
  "consumerNameMap": {
    "\\bperno\\b": "<consumer-a>",
    "\\bTDMS\\b": "<consumer-b>",
    "\\bedge-rag\\b": "<consumer-c>",
    "\\bnuxt-edge-agentic-rag\\b": "<consumer-c>",
    "\\byuntech-usr-sroi\\b": "<consumer-d>",
    "\\bbigbyte\\b": "<client-a>",
    "\\bfongchen\\b": "<client-b>",
  },
  "markerStrip": {
    "begin": "<!-- starter:strip-begin -->",
    "end": "<!-- starter:strip-end -->",
  },
}
```

### 2. sanitization library

`scripts/lib/sanitize-projection.mjs` — sanitize 一個檔內容的函式：

- 接受 source text + sanitization rule object
- 依序套用：marker strip → consumer name redact → general redaction map
- 回傳 sanitized text + 套用過的規則統計

### 3. propagate.mjs starter mode

`scripts/propagate.mjs` 接受 `--sanitize-for=<consumer-name>` flag。當 propagate 到 `nuxt-supabase-starter` 這個 consumer 時：

- 讀 `vendor/sanitization-rules/starter.json`
- 對每個 propagate 的檔跑 `sanitize-projection.mjs`
- L2 denyListSkills 內的 skill 不投影到 starter 的 plugin install layer

具體機制 depends on 既有 propagate.mjs 結構（needs codex / propose author 讀 source 設計）。

### 4. clade source 端 marker

對下列已命中的 B 類 narrative 段落加 `<!-- starter:strip-begin --> ... <!-- starter:strip-end -->` 包裝（marker 在 clade source 中性、其他 consumer 看到也 transparent）：

- `rules/code-style.md` 內：
  - `### 真實事故參考` heading + 對應內容段
  - `**真實事故參考**：perno 2026-05-14 觀察 ...` inline 段落
- `rules/manual-review.md` 內：
  - `### 真實案例（為什麼這條 rule 存在）` heading + 對應內容段
  - `實證 2026-05-18 TDMS session：...` inline 段落
- `rules/worktree-default.md` 內多段（5+ 處）：
  - `TDMS bcfde9c8` 事故描述
  - `Pin 機制是 TDMS 2026-05-17 事故修正` 段
  - `v2 失敗模式（perno 2026-05-17 session 完整暴露）` 整段
  - `為什麼步驟 2 必要（TDMS-1J 2026-05-18 incident）` 整段
  - `2026-05-18 TDMS session 連續犯兩次` 整段
- `rules/agent-routing.codex-watch-protocol.md`：
  - `（實證：.claude/.hub-state.json syncedAt 跳到當天近期時間）` inline

### 5. starter 端 audit script

`template/scripts/audit-clade-leak.mjs`（會被散播進 starter root scripts/）：

- 掃 starter 的 `template/.claude/` 內 clade-managed 檔案（依 hub-state.json）
- 對 forbidden token 跑 grep（consumer name / personal path / personal email / unstripped narrative marker）
- 命中即 fail-fast，提示「rerun `pnpm hub:sync` to re-sanitize from clade」

CI 啟用：`.github/workflows/audit.yml` 加 step。

### 6. README + CLAUDE.md 補充

starter 根目錄 README 與 CLAUDE.md 補一節「This template's `.claude/` reflects sanitized clade governance baseline. You may keep, prune, or replace it.」

## Acceptance Criteria

1. `vendor/sanitization-rules/starter.json` 包含三類 map：denyListSkills / redactionMap / consumerNameMap / markerStrip
2. `scripts/lib/sanitize-projection.mjs` 通過 unit test（覆蓋 4 種 redaction 場景 + edge cases）
3. `scripts/propagate.mjs` 對 `--sanitize-for=starter` 套用 sanitization；其他 consumer 維持原行為
4. clade source 內 4 個 rule 檔加入 `<!-- starter:strip -->` marker（共 ~10+ 處 narrative 段）
5. 跑 `node scripts/propagate.mjs --target starter --dry-run` 後 starter 端 `template/.claude/` 內：
   - 0 命中 `perno` / `TDMS` / `edge-rag` raw consumer name
   - 0 命中 `/Users/charles/` raw path
   - 0 命中 `charles@yudefine.com.tw` raw email
   - `template/.agents/skills/oops/` / `improvement-loop/` / `review-rules/` 三目錄不存在
6. starter 端 `audit-clade-leak.mjs` 跑過 0 violation
7. CI gate 啟用，未過 fail PR
8. 其他 5 個 consumer（perno / TDMS / edge-rag / yuntech-usr-sroi / 自己）propagate 仍維持原樣（不 sanitize）

## Implementation order

1. clade source marker 先做（task 4）— 不 break 任何 consumer，只是加 HTML comment
2. sanitization library + rule file（task 1, 2）— independent unit
3. propagate.mjs starter mode（task 3）— 整合上面兩件
4. dry-run 跑 propagate to starter，驗證 sanitization 結果
5. starter 端 audit script + CI（task 5, 6）
6. 真正 propagate 上線

## 給 codex draft / propose 的 reading list

去 clade 跑 propose 前，codex / human author 必讀：

- `scripts/propagate.mjs`（理解既有 propagation flow + consumer config）
- `scripts/publish.mjs`（理解 publish ceremony，sanitization 該在 publish 還是 propagate 端）
- `scripts/lib/`（已有的 lib helper structure，新檔對齊命名規約）
- `vendor/oxfmtignore-governance.mjs` 或同類 governance file（作為 sanitization rule file 結構參考）
- `.claude-plugin/marketplace.json`（plugin discovery，了解 L2 deny-list 該介入哪一層）
- `plugins/hub-core/skills/oops/SKILL.md`（理解 maintainer-only skill 的 frontmatter / metadata 結構，判斷 deny-list 偵測機制）
- `~/offline/nuxt-supabase-starter/template/.claude/.hub-state.json`（starter 端 SoT，verify after propagation）

## Open questions (給 propose author)

1. **Sanitization 該在 publish 還是 propagate 端**？ publish 寫 sanitized snapshot 到 marketplace artifact / propagate 動態 sanitize？ trade-off：publish-side 一次性、artifact 可預測；propagate-side 動態、容易 hotfix
2. **L2 plugin deny-list 機制**：透過 plugin manifest（hub-core 端宣告 starter-deny）vs starter 端 sync-to-agents filter — 哪邊改動較小？需要看 `.claude-plugin/marketplace.json` 結構
3. **Marker syntax**：HTML comment（`<!-- starter:strip -->`）vs frontmatter flag vs heading magic — propose author 評估 markdown render 影響
4. **Audit script 在 starter root 還是 template/scripts/**：root 比較對（不該被 scaffold 帶走），但需要 starter 端 propagate 機制配合（clade publish 到 starter 時 propagate target path）

## 不要做

- **NEVER** 在這 change 內動 L3（53 個 starter-owned skills + 9 個 starter-owned commands）— 已交給 `starter-public-hygiene-commands`（commands 部分，已 propose 在 starter repo）+ 後續 `starter-public-hygiene-skills`
- **NEVER** 動既有 propagate.mjs 對其他 consumer（perno / TDMS / edge-rag / yuntech-usr-sroi）的行為 — starter sanitization 是新 mode，不該倒退既有行為
- **NEVER** 把 marker strip 改成 destructive replacement（把整段刪掉），實際應 strip 出乾淨版本但 clade source 保留全段（其他 consumer 看 marker 透明）

---

**(End of brief — vendor 給 clade propose 用)**
