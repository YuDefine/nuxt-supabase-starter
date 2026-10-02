# /api-plan 分冊

- ADD `contracts/openapi.yaml`（入口，`$ref` 串模組）、`contracts/profiles.yaml`（`listProfiles`、`getMyProfile`、`getProfileById`）。
- 每個 operation 與 schema 附 `x-source: <檔>:<行>`；`check-truth.mjs` ① 驗證可解析。
- lint：`npx -y @redocly/cli lint specs/truth/contracts/openapi.yaml`（見 `expansion-guide.md` § 驗收指令）。
- 不含：`POST /api/_dev/login`（dev-login 模組未展開）。
