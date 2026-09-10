---
name: specformula-entity-spec
description: 當要導入 SpecFormula、新增資料表或實體、或修改 Entity Mapping / DDL 時載入此規格
---
<!-- LOCKED: mirrored from SpecFormula/specformula-dev-framework@e5568250a2c0599983bce90fb08d548da35e1d64 via scripts/sync-upstream-mirrors.ts — edit upstream, never here -->

# SpecFormula Entity Spec 撰寫指南

Entity Spec 定義業務實體與資料表的對應關係，是 SpecFormula「規格三巨頭」之一。包含兩個部分：

- **`entity_to_table_mapping.yml`**：實體名稱 → 資料表名稱
- **`*.sql`（DDL）**：資料表結構定義

## SpecFormula 規範

### 1. 檔案存放位置必須參考 isa.yml 配置檔

Entity Spec 的存放路徑由 `isa.yml` 的 `config.data.source[].resource_path` 決定：

```yaml
# isa.yml
config:
  data:
    source:
      - name: default
        resource_path: specs/data                                    # ← 框架讀取路徑
        project_path: my-project/src/test/resources/specs/data       # ← Lint 報錯路徑
        db_type: postgresql                                          # ← DDL 語法依據
```

對應的檔案結構：

```
src/test/resources/specs/data/    # ← 與 resource_path 一致
├── entity_to_table_mapping.yml
├── schema.sql                    # 可拆分為多個 .sql 檔案
├── users.sql
└── todos.sql
```

### 2. DDL 格式依 db_type 決定

DDL 語法須符合 `isa.yml` 中該 Data Source 設定的 `db_type` 對應的合法 SQL 語法（如 `postgresql`、`mysql`、`embedded`、`mssql`）。

### 3. Entity 命名使用業務語言

`entity_to_table_mapping.yml` 定義此 Data Source 下所有業務實體與資料表的對應關係：

```yaml
# ✅ 推薦：業務語言
entity_to_table_mapping:
  - 會員: members
  - 訂單: orders
  - 商品: products

# ❌ 避免：技術名稱
entity_to_table_mapping:
  - member_entity: members
  - tbl_order: orders
```

