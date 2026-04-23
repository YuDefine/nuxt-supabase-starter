---
name: Validate Starter
description: 驗證 starter template 的 Cursor 遷移完整性與相容性
---

# Validate Starter Template

從建立新專案開始驗證，確認 Cursor 原生配置與 Claude 相容配置都能正確落地。

## Phase 1: 建立測試專案

```bash
TEST_DIR="/tmp/starter-validation-$(date +%s)"
git clone . "$TEST_DIR"
```

之後所有檢查都在 `$TEST_DIR` 內執行。

## Phase 2: 結構驗證

### Cursor 原生結構

- [ ] `.cursor/hooks.json`
- [ ] `.cursor/cli.json`
- [ ] `.cursor/mcp.json`
- [ ] `.cursor/commands/`
- [ ] `.cursor/commands/validate-starter.md`
- [ ] `.cursor/commands/cursor-spectra-propose.md`
- [ ] `.cursor/rules/`
- [ ] `.cursor/rules/truth-layers.mdc`
- [ ] `.cursor/agents/`
- [ ] `.cursor/agents/code-review.md`

### Claude 相容結構

- [ ] `.claude/settings.json`
- [ ] `.claude/skills/`
- [ ] `.claude/agents/`
- [ ] `.claude/hooks/`

### 根層說明

- [ ] `AGENTS.md`
- [ ] `CLAUDE.md`

## Phase 3: JSON 合法性

```bash
jq . .cursor/hooks.json
jq . .cursor/cli.json
jq . .cursor/mcp.json
```

## Phase 4: 指令與規則數量

```bash
find .cursor/commands -maxdepth 1 -name '*.md' | wc -l
find .cursor/rules -maxdepth 1 -name '*.mdc' | wc -l
```

預期：

- `.cursor/commands/*.md` 至少 10 個
- `.cursor/rules/*.mdc` 至少 20 個

## Phase 5: Scaffold 驗證

```bash
pnpm --dir template/packages/create-nuxt-starter test
```

## Output

輸出報告至少包含：

- Cursor 原生結構是否完整
- Claude 相容結構是否仍保留
- JSON 是否有效
- scaffold 測試是否通過
- 哪些項目仍屬「近似遷移」而非 1:1 對標
