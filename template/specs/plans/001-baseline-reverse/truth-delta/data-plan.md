# /data-plan 分冊

- ADD `data/data-model.dbml`（總覽：只列已展開聚合的資料表）、`data/profiles.dbml`。
- 不含：`audit_logs`、`evlog_events`（未展開，見 `coverage/modules.md`）。
- 可解析性：`@dbml/core`（`npx -y -p @dbml/core node -e …`，見 `expansion-guide.md` § 驗收指令）；`check-truth.mjs` ③ 比對總覽與聚合檔的表集合。
