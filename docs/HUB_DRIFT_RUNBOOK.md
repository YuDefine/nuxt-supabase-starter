---
audience: ai-agent
applies-to: post-scaffold
related:
  - AGENTS.md
  - ../template/docs/AGENTS.md
purpose: pnpm hub:check 偵測到 drift 時，AI 該怎麼判斷與處理。包含場景對照、判斷依據、處理路徑（含 git commands）
---

# Hub Drift Runbook

> `pnpm hub:check` 報 drift 時看這份檔。每個場景給「徵兆 → 判斷 → 處理」三段。**禁止**靜默 `pnpm hub:sync` 還原 — 會吞掉 user WIP。

## 背景

`.claude/rules/`、`.claude/skills/`、部分 `.claude/hooks/`、`scripts/spectra-ux/*` 等檔案是 clade 中央倉（`~/offline/clade`）的投影，consumer 端帶 chmod 444 + checksum gate。

`pnpm hub:check` 比對 consumer 端檔案 checksum vs `.claude/.hub-state.json` 記錄的 clade 版本。不一致 → drift。

drift 來源有 4 類，**處理路徑完全不同**。先判斷類型再動手。

## 判斷流程（依此順序問）

```
偵測到 drift（pnpm hub:check 退出非 0）
│
├─ 1. 是不是「clade 升級殘留」？
│   ├─ 跑 `git -C ~/offline/clade log --oneline -5`
│   ├─ 看 .claude/.hub-state.json 的 syncedAt 是不是 < clade 最新 commit
│   └─ 是 → 場景 A
│
├─ 2. consumer 端檔案被改過（且不在預期）？
│   ├─ 跑 `git diff -- '.claude/rules/' '.claude/skills/' '.claude/hooks/' 'scripts/spectra-ux/'`
│   ├─ 看是 user / agent / SessionStart hook 改的
│   └─ 是 → 場景 B 或 C（依改動性質）
│
├─ 3. 第三方 npm skill 升級（npx skills add 管理的）？
│   ├─ 看 drift 路徑是否在 `.claude/skills/<antfu|onmax|pbakaus|supabase|obra|...>/`
│   └─ 是 → 場景 D
│
└─ 4. 都不是 → 場景 E（未知 / 需要人工判斷）
```

## 場景 A — clade 中央倉升級殘留

**徵兆**：

- `~/offline/clade` 有近期 commit 但 consumer 還沒同步
- `.claude/.hub-state.json` 的 syncedAt 比 clade 最新 commit 早
- drift 路徑全集中在 `.claude/rules/` 或 `.claude/skills/` 等 clade 治理區
- `git diff -- <drift-path>` 在 consumer 上**沒有** local 改動（diff 為空）

**判斷依據**：

```bash
# 確認 clade 比 consumer 新
( cd ~/offline/clade && git log -1 --format="%H %s %ai" )
cat .claude/.hub-state.json | grep syncedAt

# 確認 drift 路徑在 consumer 端 working tree 是乾淨的
git status -- '.claude/'
```

兩個條件都滿足 → **場景 A**。

**處理**：

```bash
pnpm hub:sync
pnpm hub:check    # 應該全綠
```

**為什麼這樣處理**：clade 已是 source of truth，consumer 端沒 local 改動，直接拉新版即可。

**禁止**：在 consumer 端 commit drift 修復（會把投影內容寫進 consumer history，下次 sync 又會重複）。

## 場景 B — consumer 端誤改（user / agent / IDE 寫入）

**徵兆**：

- drift 路徑在 `.claude/rules/` / `.claude/skills/` / `.claude/hooks/` / `scripts/spectra-ux/`
- `git diff` 顯示 consumer 上**有** local 改動
- 改動內容看起來是「想優化某個 rule」「想加一條 skill 範例」之類

**判斷依據**：

```bash
# 看具體改了什麼
git diff -- .claude/rules/ .claude/skills/

# 通常 chmod 444 會擋寫入，能改進來代表 IDE / agent bypass 過權限
ls -la .claude/rules/code-style.md   # 應該是 -r--r--r--
```

**處理**：

兩條路徑，**一定要先問使用者意圖**：

### B1 — 改動是有意義的（該回中央倉）

```bash
# 1. 把 consumer 端的改動 stash 起來
git stash push -m "drift to send back to clade" -- .claude/rules/ .claude/skills/

# 2. 還原 consumer 為 clade 版本
pnpm hub:sync

# 3. 把 stash 的內容 apply 到 ~/offline/clade 對應位置
cd ~/offline/clade
# 手動把 stash 內容貼到對應 rules/skills/ 檔（注意路徑映射）
git diff           # 確認改動正確
node scripts/_validate-manifests.mjs
git add -A && git commit -m "feat: <說明>"
node scripts/publish.mjs patch
git push && git push --tags
node scripts/propagate.mjs    # 把新版推到所有 consumer

# 4. 回 consumer，drop stash（已經在 clade 了）
cd <consumer>
git stash drop
pnpm hub:sync     # 拿到包含自己改動的新版
```

### B2 — 改動是誤動（IDE 自動化、agent 失誤、merge artifact）

```bash
# 直接還原
git checkout -- .claude/rules/ .claude/skills/    # 或細到具體檔
pnpm hub:check    # 應該綠
```

**禁止**：

- AI **不可** 靜默 `git checkout --` 還原（會吞 user WIP）— 必須先 `git diff` 給使用者看 + 取得明確確認
- AI **不可** 直接在 consumer 上 commit 這些 drift（B2 是錯的；B1 是錯的位置）

## 場景 C — local 改動但屬於白名單例外

**徵兆**：

- drift 路徑在 `.claude/local-rules/`（規劃中）或 `manifest.localHooks` 名單內的 hook
- `.claude/settings.json` 的 `permissions` / `enabledMcpjsonServers` / `enabledPlugins` 區塊（local config）

**判斷依據**：

```bash
# 看 hub.json 的 localHooks 名單
cat .claude/hub.json | jq '.localHooks'

# 看 settings.json 哪些區塊是 local 治理
# permissions / enabledMcpjsonServers / enabledPlugins → local，不該 drift
# hooks → 大部分由 clade 治理（除了 localHooks 白名單）
```

**處理**：這些不該被 hub:check 偵測為 drift。如果 hub:check 把它們列為 drift，**是 hub:check 的偵測邏輯有 bug**（或檔案不在白名單但應該在）。

```bash
# 1. 先確認 manifest.localHooks 是否漏列
cat .claude/hub.json
# 對照 ~/offline/clade/manifest.schema.json 的 localHooks 規範

# 2. 真的該加入白名單 → 改 ~/offline/clade/scripts/init-consumer.mjs 或 hub.json 的 localHooks
# 然後 patch + propagate
```

## 場景 D — 第三方 npm skill 升級

**徵兆**：

- drift 路徑在 `.claude/skills/<antfu|onmax|pbakaus|supabase|obra|hugorcd|vercel-labs|nuxt>/`
- 不在 clade 治理範圍（npx skills add 管理）

**判斷依據**：

```bash
# 看 install-skills.sh 列了哪些第三方 skills
cat scripts/install-skills.sh | grep "skills add"

# 對應 drift 的 skill 是不是在這份清單
```

**處理**：

```bash
# 重新安裝（會拿最新版）
pnpm skills:install

# 或鎖定版本
# 修改 install-skills.sh，把 `skills add @author/skill` 改 `skills add @author/skill@<version>`
```

`pnpm hub:check` 不該對第三方 skills 報 drift（因為不在 clade checksum 清單）。如果報了 → checksum 清單有 bug。

## 場景 E — 未知（防呆）

**徵兆**：以上都不是。

**處理**：**停下來、問使用者**。不要嘗試自動修復。具體步驟：

```bash
# 1. 列出全部 drift 路徑
pnpm hub:check 2>&1 | tee drift-report.txt

# 2. 對每條 drift 路徑，看 consumer 端 vs ~/offline/clade 對應位置的 diff
diff -u .claude/rules/<file> ~/offline/clade/rules/<file>
# （注意路徑映射可能不是 1:1，看 sync-rules.mjs 的邏輯）

# 3. 報告給使用者：drift 路徑、consumer 內容、clade 內容、可能原因
# 4. 等使用者決定是哪一類場景
```

## AI 處理 drift 的硬性規則

| 規則 | 理由 |
|---|---|
| **NEVER** 靜默 `pnpm hub:sync` 還原 drift | 可能吞掉 user 在 consumer 端有意改動的內容 |
| **NEVER** 靜默 `git checkout --` 還原 .claude/ 路徑 | 同上 |
| **NEVER** 直接在 consumer 端 commit drift 修復 | 會把投影寫進 consumer history，下次 sync 重複出現 |
| **MUST** 先用 `git diff` 看具體內容 | 才能判斷場景 |
| **MUST** 改動有意義時，先 stash → 改 clade → propagate → unstash | 維持 clade 為 source of truth |
| **MUST** 場景 E（未知）時停下問使用者 | 防呆 |

## 快速命令參考

| 動作 | 命令 |
|---|---|
| 看 drift 詳情 | `pnpm hub:check` |
| 從 clade 拉新版（場景 A）| `pnpm hub:sync` |
| 看 consumer local 改動 | `git diff -- '.claude/'` |
| Stash drift | `git stash push -m "drift" -- .claude/` |
| 還原為 clade 版本 | `pnpm hub:sync`（或 `git checkout -- .claude/`） |
| 看 clade 是否有新版 | `( cd ~/offline/clade && git log --oneline -5 )` |
| 重裝第三方 skills | `pnpm skills:install` |
| 看 hub.json modules | `cat .claude/hub.json` |
| 看 hub-state checksum | `cat .claude/.hub-state.json` |

## 與其他文件的關係

- root [`CLAUDE.md`](../CLAUDE.md) — clade 治理規則的高階說明（哪些去改 clade、哪些是 local）
- [QUICK_START.md](QUICK_START.md) — scaffold 流程，會 wire pre-commit 防呆
- [`template/docs/NEW_PROJECT_CHECKLIST.md`](../template/docs/NEW_PROJECT_CHECKLIST.md) — 環境驗收，含 hub-drift 檢查項
- [AGENTS.md](AGENTS.md) — meta layer AI 入口，drift 場景時跳到本檔
