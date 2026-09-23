# Impeccable 安裝指南（給 consumer `install-skills.sh` 用）


> Clade 鎖定版本見 `../SKILL.md` Prerequisites 區塊（目前 v4.3.1）。新 consumer 對齊本檔即可，不要從歷史 install-skills.sh copy v2 拆分形態。

## 標準 snippet

直接貼進 consumer 的 `scripts/install-skills.sh`：

```bash
# Impeccable Design Skill（pbakaus/impeccable — 單一 skill 含 23 sub-command + pin/unpin/hooks 三個 management command；clade design orchestrator 鎖定 v4.3.1）
# 釘 tag：裸 `pbakaus/impeccable` 拉 default branch HEAD，會裝到未發布內容（見下方「為什麼要釘 tag」）
IMPECCABLE_TAG="skill-v4.3.1"
echo "📦 Impeccable Design Skill（$IMPECCABLE_TAG）..."
npx skills add "https://github.com/pbakaus/impeccable/tree/$IMPECCABLE_TAG" $COPY_FLAGS  # symlink mode 改 --agent claude-code -y
# 4.2.0 起執行碼是原生 engine，launcher 第一次執行才下載。裝完當下先下載好，
# 之後在沒有對外網路的沙箱裡 /design 才跑得起來。下載失敗只警告、不中止其餘 skill 的安裝。
for IMPECCABLE_DIR in .claude/skills/impeccable .agents/skills/impeccable .cursor/skills/impeccable; do
  if [ -x "$IMPECCABLE_DIR/scripts/impeccable" ]; then
    "$IMPECCABLE_DIR/scripts/impeccable" engine-probe \
      || echo "  ⚠ impeccable engine 下載失敗（無對外網路或 ~/.impeccable 不可寫）；/design 決策頁要等 engine 裝好才跑得起來"
    break
  fi
done
echo "  ✓ Impeccable Design Skill 完成"
echo ""

# 清理 v1.x / v2.x deprecated sub-skill 目錄（v3 已合併為單一 skill）
DEPRECATED_DIR="$(pwd)/.claude/skills"  # <skills-root>：依 runtime 換成 .agents/skills 或 .cursor/skills
for legacy in adapt animate arrange audit bolder clarify colorize critique delight distill extract frontend-design harden layout normalize onboard optimize overdrive polish quieter shape teach-impeccable typeset; do
  if [ -d "$DEPRECATED_DIR/$legacy" ] && grep -qi impeccable "$DEPRECATED_DIR/$legacy/SKILL.md" 2>/dev/null; then
    echo "🧹 移除 deprecated sub-skill：$legacy"
    rm -rf "$DEPRECATED_DIR/$legacy"
  fi
done
echo ""
```

## copy mode vs symlink mode

| 模式 | flag | `<skills-root>/impeccable` 形態 | 適用 |
| --- | --- | --- | --- |
| **copy** | `--agent claude-code --copy -y` | 真實目錄 | 想把 skill 進 git tracking、不跨 agent 共用 |
| **symlink** (default) | `--agent claude-code -y` | `<skills-root>/impeccable` 是 symlink → `.agents/skills/impeccable/`（universal agents directory） | 多 AI agent（Claude / Codex / Cursor）共用同一份 |

兩種模式都會被 design orchestrator 認到。**加裝前 MUST 先確認該 repo 走哪一種**——`ls -la <skills-root>/` 看既有 skill 是 symlink 還是真實目錄，照它的慣例裝。

`/design` 決策頁直接呼叫 `scripts/impeccable concept-seed` 與 `scripts/impeccable serve-question`。路徑解析（skill-base-dir → `.claude/` → `.agents/` → `.cursor/skills/impeccable`）見 [decision-page.md](../decision-page.md)。Cursor 安裝後實際用到的常常是 `.cursor/skills/impeccable`，四條都要試。

> 2026-08-02 實證：對 symlink mode 的 repo 跑 `--copy` 會把 tracked 的 symlink（git 物件 `120000`）換成 59 個真實檔案，diff 看起來像整包新增，而該 repo 其餘 skill 仍是 symlink——單方面破壞了它的 skill 管理慣例。當時是 <consumer-k>，已還原。

當前各處配置（2026-08-25 實查安裝模式；2026-09-23 鎖定版本升到 v4.3.1，consumer 端重裝由 version-upgrade 的 Skills 落地承接）：

- **copy mode**: <consumer-a>、nuxt-supabase-starter/template、<consumer-c>、<consumer-d>、<consumer-b>、<consumer-j>、co-purchase、<consumer-h>、<consumer-g>、<consumer-e>
- **symlink mode**: <consumer-k>（`.claude/skills/*` → `.agents/skills/*`）
- **clade home**（clade home 是 Claude session）: copy mode，但 `.claude/*` 被 `.gitignore` 排除且白名單只放行自治區 skill 與 hub symlink → 靠 `scripts/install-skills.sh`（`pnpm skills:install`）重現，不進版控
- **global**（各 runtime 的 user-level skills 目錄；Claude 是 `~/.claude/skills/`，其他 runtime 依自身落點）: copy mode，手動安裝

（快照；清單以 registry 為準。驗版本跑 `awk 'NR==1&&/^---$/{f=1;next} f&&/^---$/{exit} f' "$IMPECCABLE/SKILL.md" | grep -m1 -E '^[[:space:]]*version:'`——4.1.3 起 `version:` 在 `metadata:` 底下，`^version:` 讀不到）

## skills-lock.json 會被一併改寫

`npx skills add` 會重算 **lock 檔內所有 entry** 的 `computedHash`，不只你剛裝的那一個。所以升 impeccable 的 commit 裡出現其他 skill 的 hash 變更是正常的，不是誤 stage。

**commit 時 MUST 帶上 `skills-lock.json`**——漏掉它，lock 記的 hash 與實際安裝內容不一致，下次 `npx skills check` 會報 drift。2026-08-02 的 fleet sweep 第一輪就漏了這個檔，7 個 consumer 得補第二個 commit。

## 升降版流程

只動 clade，consumer 自動跟齊：

1. 在 clade 改鎖定版本，**同一張 PR 一起改**（漏一處就是兩個版本號互相矛盾）：
   - `capabilities/core/skills/design/SKILL.md` Prerequisites（版本、release 連結、install 範例的 tag）
   - 本檔標準 snippet 的 `IMPECCABLE_TAG`
   - `scripts/inspect-new-project-round.ts` 的 `IMPECCABLE_LOCKED_VERSION`
   - `capabilities/modules/framework/nuxt/skills/project-bootstrap/references/impeccable-follow-up.md` 的版本
   - clade home `scripts/install-skills.sh` 的 `IMPECCABLE_TAG`
2. 走 `/clade-publish` 散播
3. consumer 把自己 `install-skills.sh` 的 impeccable 段對齊本檔 snippet（改 tag），再跑 `pnpm skills:install`

**不要在 consumer 端自行升降版**：clade design orchestrator 與 impeccable sub-command 形態強耦合，version drift 會導致 plan 內指令不存在。

## 為什麼要釘 tag（NEVER 裸 `pbakaus/impeccable`）

`npx skills add pbakaus/impeccable` 拉的是 default branch HEAD，而 HEAD 常常領先最新 release。
2026-09-23 實測：HEAD 比 `skill-v4.3.1` 多 56 筆 commit，frontmatter **仍寫 `4.3.1`**，卻多了一個
未發布的 sub-command `generate`。**版本號對得上、內容對不上**，所以版本檢查抓不到這種漂移。
clade home 就是這樣在 2026-09-18 靜默漂到 HEAD——`/design` 依賴的 `.mjs` 全部消失，而版本檢查只印一行
「找不到 version frontmatter」。

`npx skills add https://github.com/pbakaus/impeccable/tree/skill-v<X>` 裝出來的檔案集合
等於該 tag 在上游 repo 的 agents 版 skill 樹，`scripts/impeccable` 的執行權限也會保留（2026-09-23 實測）。

## 為什麼是 single-line install（不要再用 v2 拆分形態）

v2 用 `pbakaus/impeccable@<sub>` 裝獨立 sub-skill；v3.0+ 把所有 sub-command 合併進主 skill 的 `agents/openai.yaml`。GitHub release 內**只有一個 skill `impeccable`**：

```bash
$ npx skills add pbakaus/impeccable -l
◇  Found 1 skill
│    impeccable
```

`pbakaus/impeccable@adapt` / `@colorize` 等子路徑在 v3 release 不存在，安裝會 fail。

## staged `*.md` transform（舊 vp-staged 衝突，TD-776/TD-777 後已消滅）

**收斂後本節是歷史背景＋一條現行禁令。** fleet pre-commit 已收斂到
`bash scripts/pre-commit/runner.sh` → `checks/vp-staged.sh`（TD-776）：它經
`staged-targets.ts` 用 preset 的 `isStagedExcluded` 過濾，`<skills-root>/impeccable/**/*.md`
全部命中投影層（`.claude/` `.agents/` `.codex/` `.cursor/` 都在 `PROJECTION_EXCLUDES`），
根本送不進 `vp fmt`；`vite.config.ts` 的 `staged:` 在這條路徑上**沒有讀者**，裡面放
`*.md` transform 是死設定。

舊衝突（`vp staged` 路徑）：`staged:` 裡若有 `'*.md'` 那一格，升級 impeccable 一次 staged
大量 skill md 時兩種寫法都會卡——`'*.md': ['vp fmt']` 的 files 全被 ignorePatterns 濾掉 →
exit 1；transform 回 `[]` 被 `vp staged` 當 empty args → exit 1「Expected at least one
target file」。當時的繞法是 transform 回 `['true']` noop。

現在的正解是**不要放那一格**：`stagedBase` 刻意沒有 `*.md` glob（`fmtBase.ignorePatterns`
的 `**/*.md` 讓它只能產生空目標），md 檔不命中任何 glob 就不會被送進 `vp fmt`——比
`['true']` noop 更穩（`true` 是 shell 依賴，原生 Windows 無 coreutils 就失敗）。還留著
`'*.md': (files) => …` transform 的 `staged:` config 把該格整個刪掉即可；未收斂的
`vp staged` consumer（如 starter template）也照這形狀。

## 參考實作

- `<consumer-a>/scripts/install-skills.sh` — copy mode 標準範本
- `<consumer-c>/scripts/install-skills.sh` — copy mode
- `nuxt-supabase-starter/template/scripts/install-skills.sh` — copy mode（仍走 `vp staged` 路徑；`staged:` 不放 `*.md` 那一格，見上節）
- `<consumer-d>/scripts/install-skills.sh` — copy mode（同 <consumer-a>；目前無 symlink-mode consumer 可當範本，需 symlink 時用標準 snippet 的 `--agent claude-code -y` 變體）

## v3.1.0 → v3.9.1 累積 user-facing 行為（orchestrator 對齊項）

**何時讀**：升降版對齊、或要查 `../SKILL.md` 某條規範的上游出處時。跑一次 design pass 不需要讀這節。

**sub-command 集唯一變動：`teach` → `init`**（v3.5.0 rename；`teach` 保留為 deprecated alias，user 打 `teach` 仍 route 到 `init`）。clade plan 一律輸出 `/impeccable init`。

1. **`teach` → `init`**（v3.5.0）：一個指令 set up 專案 context（PRODUCT.md + DESIGN.md + Live Mode config + 推薦下一步），從單次 codebase scan 產出。舊名 `teach` 仍可用（alias）。
2. **新 management command `hooks`**（v3.6.0+）：`$impeccable hooks <on|off|status|ignore-rule|ignore-file|ignore-value|reset>` 安裝 / 修復 project-local detector hook（Claude / Codex / Cursor / Copilot），edit UI 檔後自動跑 detector 把 findings 回饋成 system reminder。**非 clade plan 的 orchestration 對象**（是 user 選裝的專案級 hook），plan 不主動排；user 問起才引導。
3. **Absolute bans 擴增**（v3.5 / v3.9）：跨 register 硬拒清單新增 — tiny all-caps tracked eyebrow（每段上方的 kicker）、numbered section markers（`01 · About / 02 · Process` 當 scaffold）、text-overflow（heading 在 breakpoint 溢出容器）、**decorative grid backgrounds（v3.9：`linear-gradient(...1px, transparent 1px)` + `background-size` 雙軸格線，除非是真的 canvas/map/blueprint）**、cream / sand / beige body bg（整個 warm-neutral band OKLCH L 0.84-0.97, C < 0.06, hue 40-100 都是 2026 AI default tell）。已折進 SKILL.md Step 2.5 Fidelity Check bans 清單。
4. **Detector 29 → 41 deterministic rules**（v3.5 加 14 條：`cream-palette` / `em-dash-overuse` / `marketing-buzzword` / `numbered-section-markers` / `oversized-h1` / `extreme-negative-tracking` / `gpt-thin-border-wide-shadow` / `repeating-stripes-gradient` / `image-hover-transform` / `broken-image` / `text-overflow` / `clipped-overflow-container` 等），引擎從 jsdom 換 `htmlparser2`（~20x 快、可 inline bundle）。對 clade plan 無影響，audit 報告更準更乾淨。
5. **`/impeccable bolder` 留在既有 design system 內**（v3.9）：專案有 DESIGN.md / token / 既有 component style 時，bolder pass 改用 hierarchy / proportion / density / copy 讓既有語言更果斷，**不**新造 color / gradient / effect；系統真的表達不出方向時才點名需要的新增並先問。→ 對應 SKILL.md Step 1.6 Matrix bolder 列。
6. **Critique persistence**（v3.1+）：`/impeccable critique` 每次跑會寫 `.impeccable/critique/<timestamp>__<slug>.md` 快照（score、P0/P1 計數、完整報告）；`/impeccable polish` 跑同 target 時自動讀最新快照當 input。同目錄 `ignore.md` 是 user-curated，列出項目不再 raise。v3.9 在非 Claude/Codex harness 上更常把 critique pass 丟到獨立 sub-agent 跑（fresh eyes）。**與 clade 的 `design-review.md` 不同檔、不同用途** — 兩者並存，邊界見 SKILL.md Step 6。
7. **Shape → build 4 named gates with STOP markers**（僅 Codex harness 啟用 native image_gen 時生效）：(a) Shape brief confirmed（Claude Code 走 Shape brief 決策頁）(b) Direction questions answered (c) Palette confirmed (d) One mock direction approved/delegated。**Claude Code 不是 native image-gen harness**，gates b-d collapse 進 Direction 決策頁 + shape brief；只在使用者跨到 Codex 時參照 4 gates。**NEVER** 輸出 `/impeccable craft`。
8. **Bare `/impeccable` context-aware 推薦 + monorepo-aware context + 每日 self-update check**（v3.5 / v3.8）：無參數 `/impeccable` 讀專案 + dirty git tree + 最新 critique 後推薦 2-3 個最高價值指令（不自動跑）；monorepo 下 PRODUCT.md / DESIGN.md 逐 app 解析。clade plan 一律輸出完整 `/impeccable <subcommand>` 形式，不受這些互動行為影響。

## v4.1.1 → v4.3.1（2026-09-23 升級）

**何時讀**：升降版對齊、或 consumer 回報「`/design` 找不到 impeccable」時。

1. **執行形態換成原生 launcher**（4.2.0）：全部 `scripts/*.mjs` 刪除，改成 `scripts/impeccable`（sh launcher）＋ `impeccable.cmd`。舊腳本都變成 verb：`impeccable context`、`signals`、`concept-seed`、`serve-question`、`surface-brief`、`live`、`pin`、`hooks`。**sub-command 集合（23 個）與 reference 檔集合都沒變**。
2. **engine 在執行期下載**（4.2.0）：skill 樹裡沒有 binary。第一次呼叫從 `github.com/pbakaus/impeccable/releases/download/engine-v<ver>/impeccable-<os>-<arch>` 下載到 `~/.impeccable/bin/<ver>/`，只以同 release 的 `.sha256` sidecar 驗雜湊（非 Windows 版沒有簽章）。4.3.1 對應 engine `0.1.5`，約 16 MB。`skills-lock.json` 的 `computedHash` 不涵蓋它。`IMPECCABLE_HOME` 改快取落點，`IMPECCABLE_BIN` 指向預先裝好的 binary。
3. **frontmatter 的 `version:` 移到 `metadata:` 底下**（4.1.3，只在被安裝的那份——上游 repo 的 agents 版 skill 樹）。所有讀版本的地方都要容許兩格縮排。
4. **question server 的 Host／Origin 閘**（4.1.3）：對非 loopback `Host` 的 GET、帶非 loopback `Origin` 的 POST `/answer`／`/build-path`／`/heartbeat` 回 403。經 proxy 嵌頁的一側要改寫 Origin（clade TD-799）。
5. **`allowed-tools` 拿掉 legacy 的 `Bash(node .claude/skills/impeccable/scripts/*)`**（4.2.0）。
6. **detector hook 遷移**：legacy 安裝寫進 `.claude/settings*.json` 的是 `[ ! -f …/hook.mjs ] || node …/hook.mjs`。`hook.mjs` 刪除後這個 guard 讓 hook **靜默失效**（不報錯、detector 不再跑）。重裝後在該專案重跑一次 `$IMPECCABLE/scripts/impeccable hooks on`，engine 認得舊形式並會改寫成新命令（上游 `crates/context/src/hook_markers.rs`）。
7. 其他（對 clade plan 無影響）：monorepo 逐 app 解析 DESIGN.md、detector 誤報減少、comp phase gates、透明背景 asset 生成。

## pin / unpin / hooks 三個 management command（user 問起才需要）

- `pin` / `unpin`：`$IMPECCABLE/scripts/impeccable pin <pin|unpin> <command>` 把 sub-command 轉成獨立 slash command（如 `/colorize` → `/impeccable colorize`），`unpin` 還原。clade design 文件**不依賴**這個機制；只在你個人偏好短名打字時自行 pin 常用幾個。
- `hooks`：`$IMPECCABLE/scripts/impeccable hooks <on|off|status|...>` 安裝 / 修復專案級 detector hook（見上節第 2 條）。**clade plan 不主動排**；純 user 選裝的專案設定，問起才引導。

**標準回答**：這三個是 v3 的 management command（不是 sub-command），clade design plan 一律輸出完整 `/impeccable <subcommand>` 形式，沒 pin 也能直接執行。pin 後的 alias 與 hooks 設定只在 user 自己專案 / 機器有效，不在 clade 治理範圍。
