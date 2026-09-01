---
name: verification-create
description: Use when user requests verification setup. NOT for maintenance.
---
<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/verification-create/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


# Create project verification infrastructure

把 pstack 的 `create-verification-skill` 內化成 clade 的跨 runtime 版本。產物寫給下一個冷啟動 agent 使用，不是寫給本次 session 自己看的說明。

## Decision boundary

- 已存在 `.claude/skills/verify-*/features/README.md`，需求是更新或重跑 → invoke `/verification-maintain`。
- 需求只是替目前 change 收集 UI 截圖 → invoke `/review-screenshot`。
- 需求是 implementation 與 change artifacts 對帳 → invoke `/spectra-verify`〔openspec〕。
- 本 skill 只建立 verification infrastructure；不替某個產品 change 宣告驗收通過。

## Output contract

建立一個 consumer-owned、tracked 的 canonical skill：

```text
.claude/skills/verify-<app>/
├── SKILL.md
├── features/
│   ├── README.md
│   └── <feature>.md
└── scripts/                  # 只有 repo 真的需要 helper 才建立
```

`.agents/`、`.codex/`、`.cursor/` 是投影面，NEVER 直接把 canonical source 寫進那些目錄。現有 `sync-to-codex`／`sync-to-cursor` 負責跨 runtime 投影。

## Workflow

### 1. Interview the repo

從 repo 與實跑結果回答以下六欄；能自行找到的資訊不問使用者：

| 欄位 | 必須查明 |
| --- | --- |
| Surface | 使用者實際碰的 Web、CLI/TUI、desktop、API、mobile 或 library surface |
| Launch | repo 官方啟動指令、port、env、seed、auth、ready signal、teardown |
| Doctor | 一條唯讀 health check，能辨認 instance、revision、port ownership 與 auth |
| Drive | 現有 Playwright/Cypress/PTY/curl/debug harness；沒有才選通用工具 |
| Observe | screenshot、ARIA、transcript、response、log、exit code、side effect |
| Isolate | port、data dir、profile、session 與 concurrent run 的隔離方式 |

若 checkout 不能 build 或 launch，停止並精確回報 baseline blocker。只有與產品行為無關的缺失靜態目錄或 sample config 才可建立 verification scaffolding，且 cleanup 必須移除。

### 2. Generate `verify-<app>`

`SKILL.md` 必須有可發現的 `name`／`description`，並依序包含：

1. `Launch` — exact command、ready signal、teardown；server/UI 使用 verification lease。
2. `Doctor` — first drive、fresh session 與 surprising failure 後都可重跑的唯讀檢查。
3. `Drive` — repo 現有 stable selector／command；UI 優先 role、accessible name、route 與既有 test handle。
4. `Evidence` — real user path、action + result、second-view side-effect proof、artifact location。
5. `Cleanup` — 只清自己建立的 process／scratch state，NEVER 依 process name 殺程序，NEVER 刪 evidence。
6. `Helpers` — 每支 helper 的 invocation、inputs、outputs 與 executable bit。

若 control-plane evidence recorder 已存在，Evidence 交給 recorder 配發 `evd_*` 並記 subject revision、digest、timestamp 與 typed references。尚未接 recorder 時寫 artifacts + manifest；NEVER 自造看似 canonical 的 ID。

### 3. Seed the feature map

讀 [feature-map-contract.md](references/feature-map-contract.md)。建立 `features/README.md` 與最重要的 3–5 個 user-facing feature；每個 feature 的每一個 entry point 都要明列，不能用驗過其中一條路徑代替其他路徑。

### 4. Validate structure

```bash
node .claude/skills/verification-maintain/scripts/check-feature-map.mjs \
  .claude/skills/verify-<app>
```

exit 0 才能進 live proof。結構紅時只修 verification skill，不改產品 code 來迎合文件。

### 5. Prove the generated skill

實跑一次完整閉環：

```text
Launch → Doctor → Drive one mapped feature → Capture evidence → Cleanup
```

失敗 iteration 也要 cleanup。最後驗 evidence 在 cleanup 後仍存在；沒實跑過的 generated skill 是 draft，不是 deliverable。

### 6. Hand off maintenance

輸出 target path、已實跑 feature、evidence path、known unreachable prerequisites，並指出後續用 `/verification-maintain`。只有使用者詢問 cadence 時才推薦時間排程；control-plane 預設在 user-facing source change 後與正式驗收前觸發維護。

## Completion evidence

- [ ] validator exit 0
- [ ] Launch／Doctor／Drive／Evidence／Cleanup invocation 與結果可重跑
- [ ] cleanup 後 evidence 仍存在
- [ ] git diff 只含 verification infrastructure 與明確 scaffolding
- [ ] 沒有宣稱任何產品 change 已被 UX owner 接受

## Upstream attribution

本 skill 改編自 Lauren Tan 的 pstack `create-verification-skill`。授權與改編邊界見 [UPSTREAM.md](references/UPSTREAM.md)。
