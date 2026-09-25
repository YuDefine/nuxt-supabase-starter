# Impeccable 安裝指南（給 consumer `install-skills.sh` 用）


> Clade 鎖定版本見 `../SKILL.md` Prerequisites 區塊。新 consumer 對齊本檔 snippet 即可，不要從舊的 install-skills.sh 複製。

## 標準 snippet

直接貼進 consumer 的 `scripts/install-skills.sh`：

```bash
# Impeccable Design Skill（pbakaus/impeccable — 單一 skill 含 23 sub-command + pin/unpin/hooks 三個 management command；clade design orchestrator 鎖定 v4.3.1）
# 釘 tag：裸 `pbakaus/impeccable` 拉 default branch HEAD，會裝到未發布內容（見下方「為什麼要釘 tag」）
IMPECCABLE_TAG="skill-v4.3.1"
echo "📦 Impeccable Design Skill（$IMPECCABLE_TAG）..."
npx skills add "https://github.com/pbakaus/impeccable/tree/$IMPECCABLE_TAG" $COPY_FLAGS  # symlink mode 改 --agent claude-code -y
# 執行碼是原生 engine，launcher 第一次執行才下載。裝完當下先下載好，
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

對 symlink mode 的 repo 跑 `--copy` 會把 tracked 的 symlink（git 物件 `120000`）換成整包真實檔案，diff 看起來像整包新增，而其餘 skill 仍是 symlink——單方面破壞該 repo 的 skill 管理慣例。

各 consumer 的實際模式以上面的 `ls -la` 為準。兩個不在 consumer registry 的落點：

- **clade home**（clade home 是 Claude session）: copy mode，但 `.claude/*` 被 `.gitignore` 排除且白名單只放行自治區 skill 與 hub symlink → 靠 `scripts/install-skills.sh`（`pnpm skills:install`）重現，不進版控
- **global**（各 runtime 的 user-level skills 目錄；Claude 是 `~/.claude/skills/`，其他 runtime 依自身落點）: copy mode，手動安裝

## skills-lock.json 會被一併改寫

`npx skills add` 會重算 **lock 檔內所有 entry** 的 `computedHash`，不只你剛裝的那一個。所以升 impeccable 的 commit 裡出現其他 skill 的 hash 變更是正常的，不是誤 stage。

**commit 時 MUST 帶上 `skills-lock.json`**——漏掉它，lock 記的 hash 與實際安裝內容不一致，下次 `npx skills check` 會報 drift。注意 `npx skills check` 本身會把 `.claude/skills/<skill>` 改成 symlink → `.agents/skills/`，與本檔 copy mode 的前提衝突；只拿它讀報告，跑完確認 `.claude/skills/<skill>` 仍是實體目錄。

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

`npx skills add pbakaus/impeccable` 拉的是 default branch HEAD，而 HEAD 常常領先最新 release：
frontmatter 版本號仍是上一個 release，內容卻可能多出未發布的 sub-command 或刪掉 `/design` 依賴的腳本。
**版本號對得上、內容對不上**，所以版本檢查抓不到這種漂移。

`npx skills add https://github.com/pbakaus/impeccable/tree/skill-v<X>` 裝出來的檔案集合
等於該 tag 在上游 repo 的 agents 版 skill 樹，`scripts/impeccable` 的執行權限也會保留。

## 為什麼是 single-line install

所有 sub-command 都在主 skill 裡，GitHub release 內**只有一個 skill `impeccable`**：

```bash
$ npx skills add pbakaus/impeccable -l
◇  Found 1 skill
│    impeccable
```

`pbakaus/impeccable@adapt` / `@colorize` 等子路徑不存在，安裝會 fail。

## staged `*.md` transform：`staged:` 不放 `*.md` 那一格

fleet pre-commit 走 `bash scripts/pre-commit/runner.sh` → `checks/vp-staged.sh`：它經
`staged-targets.ts` 用 preset 的 `isStagedExcluded` 過濾，`<skills-root>/impeccable/**/*.md`
全部命中投影層（`.claude/` `.agents/` `.codex/` `.cursor/` 都在 `PROJECTION_EXCLUDES`），
送不進 `vp fmt`；`vite.config.ts` 的 `staged:` 在這條路徑上**沒有讀者**，裡面放
`*.md` transform 是死設定。

仍走 `vp staged` 的 consumer（如 starter template）若 `staged:` 有 `'*.md'` 那一格，升級 impeccable
一次 staged 大量 skill md 時兩種寫法都會卡：`'*.md': ['vp fmt']` 的 files 全被 ignorePatterns
濾掉 → exit 1；transform 回 `[]` 被 `vp staged` 當 empty args → exit 1「Expected at least one
target file」。

正解是**不要放那一格**：`stagedBase` 刻意沒有 `*.md` glob（`fmtBase.ignorePatterns`
的 `**/*.md` 讓它只能產生空目標），md 檔不命中任何 glob 就不會被送進 `vp fmt`。不要用
`['true']` noop 繞（`true` 是 shell 依賴，原生 Windows 無 coreutils 就失敗）。還留著
`'*.md': (files) => …` transform 的 `staged:` config 把該格整個刪掉即可。

## 參考實作

- `<consumer-a>/scripts/install-skills.sh` — copy mode 標準範本
- `<consumer-c>/scripts/install-skills.sh` — copy mode
- `nuxt-supabase-starter/template/scripts/install-skills.sh` — copy mode（仍走 `vp staged` 路徑；`staged:` 不放 `*.md` 那一格，見上節）
- `<consumer-d>/scripts/install-skills.sh` — copy mode（同 <consumer-a>；目前無 symlink-mode consumer 可當範本，需 symlink 時用標準 snippet 的 `--agent claude-code -y` 變體）

## 疑難排解（consumer 回報「`/design` 找不到 impeccable」或 detector 不跑）

- **只有 `scripts/*.mjs`、沒有 `scripts/impeccable`**：裝的是舊版。照標準 snippet 重裝（釘 tag）。
- **engine 下載**：skill 樹裡沒有 binary。第一次呼叫從 `github.com/pbakaus/impeccable/releases/download/engine-v<ver>/impeccable-<os>-<arch>` 下載到 `~/.impeccable/bin/<ver>/`，只以同 release 的 `.sha256` sidecar 驗雜湊（非 Windows 版沒有簽章）；`skills-lock.json` 的 `computedHash` 不涵蓋它。`IMPECCABLE_HOME` 改快取落點，`IMPECCABLE_BIN` 指向預先裝好的 binary。
- **舊 detector hook 靜默失效**：legacy 安裝寫進 `.claude/settings*.json` 的是 `[ ! -f …/hook.mjs ] || node …/hook.mjs`。`hook.mjs` 已不存在，這個 guard 讓 hook 不報錯也不跑。重裝後在該專案重跑一次 `$IMPECCABLE/scripts/impeccable hooks on`，engine 會把舊形式改寫成新命令。
- **decision page 經 proxy／嵌頁回 403**：impeccable 4.1.3 起 question server 有 Host／Origin 閘——非 loopback `Host` 的 GET、帶非 loopback `Origin` 的 POST `/answer`／`/build-path`／`/heartbeat` 回 403。經 proxy 嵌頁的一側（`/decisions`）要改寫 Origin（clade TD-799）。

## pin / unpin / hooks 三個 management command（user 問起才需要）

- `pin` / `unpin`：`$IMPECCABLE/scripts/impeccable pin <pin|unpin> <command>` 把 sub-command 轉成獨立 slash command（如 `/colorize` → `/impeccable colorize`），`unpin` 還原。clade design 文件**不依賴**這個機制；只在你個人偏好短名打字時自行 pin 常用幾個。
- `hooks`：`$IMPECCABLE/scripts/impeccable hooks <on|off|status|...>` 安裝 / 修復專案級 detector hook（edit UI 檔後自動跑 detector，把 findings 回饋成 system reminder）。**clade plan 不主動排**；純 user 選裝的專案設定，問起才引導。

**標準回答**：這三個是 management command（不是 sub-command），clade design plan 一律輸出完整 `/impeccable <subcommand>` 形式，沒 pin 也能直接執行。pin 後的 alias 與 hooks 設定只在 user 自己專案 / 機器有效，不在 clade 治理範圍。
