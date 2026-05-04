# Impeccable v3 安裝指南（給 consumer `install-skills.sh` 用）

> Clade 鎖定版本見 `../SKILL.md` Prerequisites 區塊（目前 v3.0.6）。新 consumer 對齊本檔即可，不要從歷史 install-skills.sh copy v2 拆分形態。

## 標準 snippet

直接貼進 consumer 的 `scripts/install-skills.sh`：

```bash
# Impeccable Design Skill（pbakaus/impeccable — 單一 skill 含 24 sub-command；clade design orchestrator 鎖定版本）
echo "📦 Impeccable Design Skill..."
npx skills add pbakaus/impeccable $COPY_FLAGS  # symlink mode 改 --agent claude-code -y
echo "  ✓ Impeccable Design Skill 完成"
echo ""

# 清理 v1.x / v2.x deprecated sub-skill 目錄（v3 已合併為單一 skill）
DEPRECATED_DIR="$(pwd)/.claude/skills"
for legacy in adapt animate arrange audit bolder clarify colorize critique delight distill extract frontend-design harden layout normalize onboard optimize overdrive polish quieter shape teach-impeccable typeset; do
  if [ -d "$DEPRECATED_DIR/$legacy" ] && grep -qi impeccable "$DEPRECATED_DIR/$legacy/SKILL.md" 2>/dev/null; then
    echo "🧹 移除 deprecated sub-skill：$legacy"
    rm -rf "$DEPRECATED_DIR/$legacy"
  fi
done
echo ""
```

## copy mode vs symlink mode

| 模式 | flag | `.agents/skills/impeccable` 形態 | 適用 |
| --- | --- | --- | --- |
| **copy** | `--agent claude-code --copy -y` | 真實目錄 | 想把 skill 進 git tracking、不跨 agent 共用 |
| **symlink** (default) | `--agent claude-code -y` | symlink → `.agents/skills/impeccable/`（universal agents directory） | 多 AI agent（Claude / Codex / Cursor）共用同一份 |

兩種模式都會被 design orchestrator 認到。當前 5 個 consumer 配置（2026-05-04）：

- copy mode: perno、nuxt-supabase-starter/template、nuxt-edge-agentic-rag
- symlink mode: yuntech-usr-sroi、TDMS（無 install-skills.sh，預設 symlink）

## 升降版流程

只動 clade，consumer 自動跟齊：

1. 在 clade 改 `plugins/hub-core/skills/design/SKILL.md` Prerequisites 區塊的鎖定版本（含 GitHub release 連結）
2. `node scripts/publish.mjs patch && node scripts/propagate.mjs` 散播
3. consumer 跑 `pnpm skills:install`（執行 install-skills.sh）pull latest

**不要在 consumer 端自行升降版**：clade design orchestrator 與 impeccable sub-command 形態強耦合，version drift 會導致 plan 內指令不存在。

## 為什麼是 single-line install（不要再用 v2 拆分形態）

v2 用 `pbakaus/impeccable@<sub>` 裝獨立 sub-skill；v3.0+ 把所有 sub-command 合併進主 skill 的 `agents/openai.yaml`。GitHub release 內**只有一個 skill `impeccable`**：

```bash
$ npx skills add pbakaus/impeccable -l
◇  Found 1 skill
│    impeccable
```

`pbakaus/impeccable@adapt` / `@colorize` 等子路徑在 v3 release 不存在，安裝會 fail。

## 已知 vp-staged 衝突（vite-plus 專案）

`vp staged` 對 staged file 跑 lint-staged 時，若 staging 含大量 `.agents/skills/impeccable/**/*.md`（升級 impeccable 時的常見場景），兩條路都會卡：

| 寫法 | 卡點 |
| --- | --- |
| `'*.md': ['vp fmt']`（simple） | `vp fmt` 收到 files 後全被 `fmt.ignorePatterns`（`.claude/**` / `.agents/**`）過濾 → exit 1「All matched files may have been excluded by ignore rules」 |
| `'*.md': (files) => ... return []`（transform 過濾後 0 target） | `vp staged` 把 `[]` interpret 為 vp fmt empty args → exit 1「Expected at least one target file」 |

vp 0.1.20 仍有此 bug（驗證過）。**繞法**：transform function 0 target 時回傳 `['true']` noop bash 命令：

```js
'*.md': (files) => {
  const allowed = files.filter(f =>
    !f.includes('/.agents/skills/') &&
    !f.includes('/.claude/rules/') &&
    !f.includes('/.codex/hooks/') &&
    !f.includes('/.codex/agents/') &&
    !f.includes('/.agents/commands/') &&
    !f.includes('/.agents/') &&
    !f.includes('/.codex/')
  )
  return allowed.length > 0 ? [`vp fmt ${allowed.join(' ')}`] : ['true']
}
```

只 nuxt-supabase-starter/template 用 `core.hooksPath = template/.vite-hooks/_` + `*.md` rule，會踩到。其他 consumer 沒 `*.md` rule 或 ignorePatterns 寫法不同，不會踩。

## 參考實作

- `perno/scripts/install-skills.sh` — copy mode 標準範本
- `nuxt-edge-agentic-rag/scripts/install-skills.sh` — copy mode + simple `*.md` lint-staged
- `nuxt-supabase-starter/template/scripts/install-skills.sh` — copy mode + transform `*.md` + noop fallback
- `yuntech-usr-sroi/scripts/install-skills.sh` — symlink mode 範本
