---
name: specformula-api-spec
description: 當要導入 SpecFormula、規劃新的 API、或調整 API Spec Schema 時載入此規格
---
<!-- LOCKED: mirrored from SpecFormula/specformula-dev-framework@e5568250a2c0599983bce90fb08d548da35e1d64 via scripts/sync-upstream-mirrors.ts — edit upstream, never here -->

# SpecFormula API Spec 撰寫指南

API Spec 使用 OpenAPI 3.0 格式，是 SpecFormula「規格三巨頭」之一。

## SpecFormula 規範

### 1. summary 全域不可重複

`summary` 是 ApiCall 和 ResponseValidate 指令的識別依據，在整份 API Spec（含多檔案）中不可重複。使用「動詞 + 名詞」的業務語言命名：

```yaml
# ✅ 正確
summary: 新增待辦事項
summary: 查詢待辦事項列表
summary: 查詢單一待辦事項

# ❌ 錯誤
summary: 查詢待辦事項    # 與上面重複，無法識別
summary: POST user       # 避免技術用語
```

### 2. 檔案存放位置必須參考 isa.yml 配置檔

API Spec 的存放路徑由 `isa.yml` 的 `config.api.resource_path` 決定，撰寫前須先確認配置：

```yaml
# isa.yml
config:
  api:
    resource_path: specs/api                                    # ← 框架讀取路徑
    project_path: my-project/src/test/resources/specs/api       # ← Lint 報錯路徑
```

對應的檔案結構：

```
src/test/resources/specs/api/    # ← 與 resource_path 一致
├── api-spec.yml
├── auth-api.yml                 # 可拆分為多個檔案
└── ...
```

## 與 Feature 指令的對應

| Gherkin 元素 | API Spec 來源 |
|-------------|---------------|
| `新增待辦事項`（summary） | `paths.*.*.summary` |
| HTTP Method | 從 path 定義推斷 |
| URL Path | `paths` 的 key |
| Request Body 欄位 | `requestBody.content.*.schema.properties` |
| Path 參數（`P:`） | `parameters[].in: path` |
| Query 參數（`Q:`） | `parameters[].in: query` |
| Header 參數（`H:`） | `parameters[].in: header` |
| Response 欄位 | `responses.*.content.*.schema.properties` |
