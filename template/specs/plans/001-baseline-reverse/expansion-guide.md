# 展開說明（backend 逆向基準線）

試點模組：`profiles`。其餘模組依 `coverage/modules.md` 的「未展開」逐個展開；本檔是展開的固定決策與驗收，作業者不各自判斷。

## 試點通過後的展開判定

| 判準 | 結果 |
| --- | --- |
| 試點的 feature、`dsl.md`、合約、DBML、覆蓋矩陣齊全，`tools/check-truth.mjs` exit 0 | 通過 |
| 試點經人確認（PR 審查） | **待確認**——審查通過前不展開其餘模組 |
| 其餘模組是否現在就展開 | 否。dev-login、audit、observability、shared-utils 的行為多半依賴 Gherkin runner 才能分辨「已驗證」與「未驗證」，runner 未選定前展開只會增加 `@unverified` 存量。frontend 另開 package（`002-frontend-reverse`） |

## 待決（不由本 package 決定）

1. **BDD runner**：backend 與 frontend 各用哪個 Gherkin runner（`.clade/manifest.json` 已宣告 `specformula`，但 repo 內沒有 `isa.yml`、沒有 `test:bdd`）。由 `/technical-research` 三題必問由使用者拍板。
2. runner 選定後才能做 SOP 步驟 13：runner 讀 truth（B1）、預設排除 `@unverified`、`dsl.md` ↔ step 雙向對帳（B4）。接線前 `check-truth.mjs` 只覆蓋 feature↔`dsl.md` 這一半。
3. Q-profiles-1／3／5／6／8 的裁決（見 `questions.md`）。

## 展開的固定決策

1. 模組鍵：contracts、`features/backend/`、`data/` 同名（現為 `profiles`）；`NN-` 前綴可選，用了三處一致。
2. 每個模組一份 `contracts/<模組>.yaml`，在 `openapi.yaml` 以 `$ref` 串起；每個 operation、schema 附 `x-source: <檔>:<行>`。
3. 每個聚合一份 `data/<模組>.dbml`，並同步 `data-model.dbml` 的表清單。
4. feature 依程式碼行為逆向，標 `@unverified`；規則原意與程式碼不符才標 `@code-mismatch`（需 runner 實跑）。現有缺陷鎖成規格時，Rule 標題寫「現況鎖定，非期望行為」並掛 Q 註解。
5. 句型逐字沿用；被第二個模組使用的句型由專責一方提升到介面根 `dsl.md` 並刪除舊位置（規約 MUST 5）。
6. 逆向補齊只補業務把關；瑣碎 CRUD 與純內部實作細節列「刻意不補」並附理由。
7. 展開作業者（含子代理）不 commit，由主線逐模組驗證後提交。
8. 每個模組新增 `coverage/<模組>.md`，並更新 `coverage/modules.md`。

## 驗收指令（cwd：`template/`）

```bash
node specs/plans/001-baseline-reverse/tools/check-truth.mjs        # 機械檢查，exit 0
node specs/plans/001-baseline-reverse/tools/build-inventory.mjs     # 重跑後 git diff 為空
npx -y @redocly/cli@latest lint specs/truth/contracts/openapi.yaml  # 合約 lint，0 錯誤
npx -y -p @dbml/core node -e "const {Parser}=require('@dbml/core');const fs=require('fs');for(const f of fs.readdirSync('specs/truth/data'))new Parser().parse(fs.readFileSync('specs/truth/data/'+f,'utf8'),'dbml')"  # 全部可解析
```

上游 `audit_feature_dsl_topology.py` 有已知假綠（TD-1121 #6／#7），只算必要條件，不單獨當驗收證據。
