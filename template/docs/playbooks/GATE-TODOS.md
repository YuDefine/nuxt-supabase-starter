# Cursor Task todos — {{CONSUMER}} gates

每個新 session 開工：`TodoWrite` merge true，一 gate 一格。`content` 必須含路徑。

| id | content | status |
| --- | --- | --- |
| `gate-01-dev-database` | SOP 01 連到已在跑的開發資料庫 — `docs/playbooks/01-dev-database.md` | pending |
| `gate-02-ssh-config` | SOP 02 SSH config — `docs/playbooks/02-ssh-config.md` | pending |
| `gate-03-oauth` | SOP 03 Google OAuth — `docs/playbooks/03-google-oauth.md` | pending |
| `gate-04-deploy-prod-db` | SOP 04 deploy/prod DB — `docs/playbooks/04-deploy-prod-db.md` | pending |
| `gate-05-post-verify` | SOP 05 達標 probe — `docs/playbooks/05-post-gate-verify.md` | pending |

當步 `in_progress`、後面 `pending`、success probe 通過才 `completed`。一次只推進一格（03 可與 01/02 並行）。
