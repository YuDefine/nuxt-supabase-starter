---
name: Validate Starter
description: 從 meta repo root 驗證 template/ starter seed 的結構完整性、文件一致性與 scaffold 輸出
---

# Validate Starter Template

此 command 屬 **root meta 維護層**，只給 starter 維護者使用。scaffold 出去的使用者專案不會拿到它
（見 `.claude/rules/starter-hygiene.md` § L3 Commands Hygiene）。

驗證對象是本 repo 的 `template/` starter seed，而不是當前 repo root。

## Instructions

### Phase 1: 結構與文件基線（root script）

```bash
bash scripts/validate-starter.sh          # auto 偵測 demo / clean 模式
bash scripts/validate-starter.sh clean    # 指定驗證 clean 模式
bash scripts/validate-starter.sh demo     # 指定驗證 demo 模式
```

該 script 以 `template/` 為 root，涵蓋：

- Phase 1 結構檢查（`.claude/`、`openspec/`、`app/`、`server/`、`docs/decisions/`）
- Phase 2 `package.json` scripts 完備性
- Phase 3 文件關鍵字一致性
- Phase 3b Spectra / OpenSpec clean baseline
- Phase 4 mode-specific 檢查

在**開發中的 repo** 跑會在 Phase 3b 出現 FAIL（active change dir 尚未 archive），那是預期的；
clean baseline 只對 scaffold 輸出或 release 前的乾淨樹有意義。

### Phase 2: Scaffold 模擬（preset 全覆蓋）

```bash
cd template && vp run validate:starter
```

`template/scripts/validate-starter.mjs` 會對每個 preset（`baseline` / `d-pattern-audit` /
`nuxthub-ai` / `none`）跑 scaffold simulation，把輸出落在 `template/temp/validate-starter/`，
並驗證 strip manifest 與 audit signal。

### Phase 3: Public hygiene

```bash
node scripts/audit-template-hygiene.sh    # starter pollution 檢查
node scripts/audit-public-hygiene.mjs     # L3 commands / skills allowlist 檢查
```

### Phase 4: 手動一致性抽查

比對 `template/docs/QUICK_START.md`、`template/README.md`、`template/docs/CLAUDE_CODE_GUIDE.md`
內描述的目錄樹與實際結構：

```bash
grep -n "├──\|└──" template/docs/QUICK_START.md template/docs/CLAUDE_CODE_GUIDE.md template/README.md
```

### Phase 5: Tech Stack 對照

從 `template/README.md` 的 Tech Stack 章節解析 `[Name](url)` 連結，與 `template/package.json`
的 dependencies 比對，確認 README 宣稱的技術都實際安裝。

## Output

輸出驗證報告：

```markdown
## Starter Validation Report

**來源 Commit**: <git rev-parse --short HEAD>

| 階段                        | 狀態  | 備註 |
| --------------------------- | ----- | ---- |
| validate-starter.sh         | ✅/❌ |      |
| validate:starter (scaffold) | ✅/❌ |      |
| audit-template-hygiene      | ✅/❌ |      |
| audit-public-hygiene        | ✅/❌ |      |
| 文件一致性                  | ✅/❌ |      |
| Tech Stack                  | ✅/❌ |      |

## 總結: **PASS** / **FAIL**

### 發現的問題（如有）

1. ...
```

## Cleanup

```bash
rm -rf template/temp/validate-starter
```
