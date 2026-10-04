# Roadmap

> 人工維護的 backlog。工作佇列與進行中項目以 `pnpm flow`（work spine）與
> `tasks/`、`docs/tech-debt.md` 為準；本檔只留策展過的優先順序。

## Next Moves

### 近期

- [mid] **TD-016** Cloudflare 上零引數 `useRuntimeConfig()` 回的是 module-eval snapshot，而 env 是每次 invocation 才注入 —— `config.appEnv` 可能恆為 `unknown`；機制已釘死，待一次真實部署實測。成立的話根因在 clade `deploy-env-identity` 的接線表 — 獨立
- [low] **TD-017** `validate-starter` 留下的 `temp/` scaffold 產物會讓 doctor gate 從 exit 0 變 exit 1 — 獨立
- [low] **TD-014** 範圍已收斂：24 條 blocked error 於 2026-09-11 全數清除（clade TD-1019 / TD-1066 + v1.12.46），`--visibility public --dry-run` 回 `diagnostics: []`。**剩下只有 `<maintainer-domain>` 佔位符無解析說明**（22 檔 58 處），不擋任何 gate — 修在 clade 源檔，本 repo 只驗收
- [mid] M3b.3 scaffolder `--multi-package` flag (T4 layout overlay) — 依賴：M3b.2 已完成 (commit `a9dd764`)；獨立於其他 starter 工作

### 中期

_(尚未累積)_

### 長期

_(尚未累積)_

---

## Done

- 2026-05-09 M3b.1 starter T1 evlog baseline wiring (depth 3 → 6+) — commit `728d534`
- 2026-05-09 M3b.2 scaffolder CLI `--evlog-preset` flag — commit `a9dd764` (8/9) + integration verify follow-up (this session)
