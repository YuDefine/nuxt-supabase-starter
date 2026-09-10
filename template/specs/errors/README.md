<!-- LOCKED: mirrored from SpecFormula/specformula-dev-framework@e5568250a2c0599983bce90fb08d548da35e1d64 via scripts/sync-upstream-mirrors.ts — edit upstream, never here -->
# SpecFormula 錯誤訊息模板 registry

本目錄為跨語言錯誤訊息渲染之 source of truth，4 語言實作（Java / Python / C# / TypeScript）共用。具體 contract 見 ADR-0026《SpecFormula Framework Exception Taxonomy》§7.1 / §7.2.1 / §7.3。

## 目錄結構（locale-as-directory + per-SUBSYSTEM split）

```
specs/errors/
├── README.md          ← 本檔
└── <locale>/          ← canonical locale 為 zh-TW；其他 locale 由各 project ADR 自管
    ├── dsl.yml
    ├── spec.yml
    ├── symbol.yml
    ├── exec.yml
    └── assert.yml
```

## File partition 規則

每個 SUBSYSTEM 對應 1 個檔案，filename 為該 prefix 之 lowercase：

| SUBSYSTEM 範圍                               | filename     | 對應 code prefix |
| -------------------------------------------- | ------------ | ---------------- |
| DSL preprocessor                             | `dsl.yml`    | `DSL_*`          |
| spec readers（isa / api / entity / mapping） | `spec.yml`   | `SPEC_*`         |
| VAR / CAS / TIME / template ref              | `symbol.yml` | `SYMBOL_*`       |
| instruction execution（非斷言失敗）          | `exec.yml`   | `EXEC_*`         |
| Then 期望斷言失敗                            | `assert.yml` | `ASSERT_*`       |

**entry 之 code prefix 必須與所在檔案 basename 一致**（例：`SPEC_ISA_FILE_NOT_FOUND` 不得出現在 `dsl.yml`）；違反者由 §7.2.1 結構檢查攔截。

## Entry schema

```yaml
<CODE>:
  category: <argument | state | lookup | assertion>
  template: "<簡單 {snake_case_key} 字面替換之模板字串>"
  fixtures:
    - details: { <snake_case_key>: <value>, ... }
    - details: { ... } # 可有多組
```

- `category` 必填，4 個 sibling 之語言中立關鍵字（對應 ADR §一 hierarchy 之 4 個 catchable category）。`SpecFormula{Category}Error` 為 generator 寫入 §7.3 feature 之 `error_class` 欄；該詞彙已收錄於 `terminology-dictionary.yml`，per-language sync 替換為各語言原生型別名。
- `template` 必填、非空字串。`{key}` 為 snake_case，對應 details record 之對外欄位。
- `fixtures` 必填、至少 1 組。每組 `details` 之 key 集合必須等於 `template` 之 placeholder 集合（雙向相等）。
- `details` 之 value 型別僅允許 `string` / `int` / `long` / `bool` / `null`（§7.3 byte-identical 斷言依賴此限制；`float` / `decimal` / `date` 必須由 throw site 格式化為 string 後置入）。
- 不支援條件 / plural / 數字格式化。

## 跨檔 invariant（§7.2.1）

由語言中立檢查程式於規格 repo 內執行一次，4 語言 CI 共用 exit code：

1. **跨檔 code key uniqueness**：單一 locale 全部檔案 merge 後，code key 集合不得重複。
2. **File partition consistency**：entry 之 code prefix 必須與所在檔案 basename（lowercase）一致。
3. **`category` 欄位驗證**：必填，且值必須屬於 4 個 sibling 關鍵字之一。
4. **`fixture details` value 型別限制**：每組 fixture 之 `details` 之 value 型別必須屬於 `string` / `int` / `long` / `bool` / `null`。
5. **Locale 完整性**：non-canonical locale 之檔名集合（出現之 SUBSYSTEM 檔案）必須與 canonical `zh-TW` 一致；entry 集合可不一致（允許未翻譯，fallback 行為由 project ADR 規範）。

## 新增 1 個 code 的步驟

見 ADR-0026 §3.5；本目錄為其中 step #4 之落地點。摘要：

1. 在語言實作之 code enum / const 加新值（§四 命名規約 `<SUBSYSTEM>_<SUBJECT>_<CONDITION>`）
2. 新建對應 PascalCase details record
3. 將 record 加入 discriminated union
4. **在本目錄對應 SUBSYSTEM 檔加 entry**：`category` + `template` + 至少 1 組 `fixtures`
5. 各語言補 serialization mapping（若內部欄位非 snake_case）
6. throw site 改用新 code + details record；不得手寫 message
7. **重新產出 rendering feature**：`uv run scripts/generate-error-message-rendering-feature.py`

## 渲染驗證

訊息渲染正確性由獨立 feature `specs/features/spec-error/error-message-rendering.feature` 驗證一次（§7.3）；其他業務 feature 不得斷言訊息字面（§G11）。

該 feature 由 `scripts/generate-error-message-rendering-feature.py` 從本目錄之 `<canonical-locale>/*.yml` 自動產生，**禁止手動編輯**；CI 以 `--check` 模式驗證 registry 與 feature 是否同步。

```sh
# 重新產出
uv run scripts/generate-error-message-rendering-feature.py

# CI 檢查（dry-run；不一致則 exit 1）
uv run scripts/generate-error-message-rendering-feature.py --check
```

## typed Then 句型

`Then 應拋出 SpecFormula*Error` / `And 錯誤碼為 ...` / `And 錯誤詳情 ...` 等 typed Then 句型之**權威定義**為 ADR-0026 §6.1 + §6.2；不另立 vocab.md（§8.1）。

## 相關文件

- [ADR-0026 §7.1 訊息模板 registry](../adr/0026-specformula-error-taxonomy.md)
- [ADR-0026 §7.2.1 語言中立 registry 結構檢查](../adr/0026-specformula-error-taxonomy.md)
- [ADR-0026 §7.3 獨立 rendering feature](../adr/0026-specformula-error-taxonomy.md)
- [`scripts/generate-error-message-rendering-feature.py`](../../scripts/generate-error-message-rendering-feature.py) — generator
- [`specs/features/spec-error/error-message-rendering.feature`](../features/spec-error/error-message-rendering.feature) — 自動產生之渲染驗證 feature
