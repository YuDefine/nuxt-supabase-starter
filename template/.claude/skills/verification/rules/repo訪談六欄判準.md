
# Rule 1 - 六欄從 repo 與實跑結果回答，能自行找到的資訊不問使用者

- Level: `MUST`
- 產物寫給下一個冷啟動 agent 使用，不是寫給本次 session 自己看的說明。從 repo 與實跑結果回答以下六欄：

| 欄位 | 必須查明 |
| --- | --- |
| Surface | 使用者實際碰的 Web、CLI/TUI、desktop、API、mobile 或 library surface |
| Launch | repo 官方啟動指令、port、env、seed、auth、ready signal、teardown |
| Doctor | 一條唯讀 health check，能辨認 instance、revision、port ownership 與 auth |
| Drive | 現有 Playwright/Cypress/PTY/curl/debug harness；沒有才選通用工具 |
| Observe | screenshot、ARIA、transcript、response、log、exit code、side effect |
| Isolate | port、data dir、profile、session 與 concurrent run 的隔離方式 |

## Good Example

- 這個例子是好的，因為每欄都有 repo 內的出處或實跑結果。

```text
Launch：pnpm dev（package.json scripts.dev）→ port 3000，ready signal「Local: http://localhost:3000」（實跑 12 秒出現）
Drive：e2e/ 已有 Playwright config → 沿用，不另裝工具
```

## Bad Example

- 這個例子是壞的，因為能自己查的資訊拿去問使用者。

```text
請問專案怎麼啟動？用哪個 port？有沒有 e2e 工具？
```

# Rule 2 - 不能 build 或 launch 就停下回報 baseline blocker

- Level: `MUST`
- 若 checkout 不能 build 或 launch，停止並精確回報 baseline blocker。
- 只有與產品行為無關的缺失靜態目錄或 sample config 才可建立 verification scaffolding，且 cleanup 必須移除。

## Good Example

- 這個例子是好的，因為精確回報 blocker 後停止。

```text
baseline blocker：pnpm build 失敗於 server/api/orders.ts:42（TS2339），未進 Generate
```

## Bad Example

- 這個例子是壞的，因為改產品 code 讓它能啟動。

```text
build 失敗 → 先把 orders.ts 那行註解掉，繼續產生 verify skill
```
