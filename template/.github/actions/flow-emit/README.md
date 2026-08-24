# flow-emit

把一次 CI 執行放上這個 repo 的 flow 脊椎。

## 為什麼要 artifact 這一段

runner 是 ephemeral 的：job 結束，workspace 裡的 `.clade/flow/events.jsonl` 一起消失。
沒有回流路徑的 emit 等於寫進虛空。所以這支 action 做兩件事 —— 發事件、把脊椎上傳成
`flow-events-<run_id>`，本機再收回來：

```bash
gh run download <run-id> -n flow-events-<run-id> -D /tmp/flow-ci
pnpm flow ingest /tmp/flow-ci
```

`ingest` 依 `event_id` 去重，所以同一個 artifact 收兩次是 no-op；每筆都重跑一次 redaction
與 validator，來源在本 repo 治理範圍外，這兩關 NEVER 略過。

## 用法

```yaml
- uses: ./.github/actions/flow-emit          # leading ./ ：解析本地 vendored 副本
  if: always()
  with:
    kind: gate
    actor: ci
    outcome: ${{ job.status == 'success' && 'ok' || 'fail' }}
    payload: '{"workflow":"${{ github.workflow }}","sha":"${{ github.sha }}"}'
```

`if: always()` 是重點：只在成功時發事件的 timeline，剛好漏掉唯一有人會回頭查的那一種 run。

## 邊界

- consumer 還沒被 propagate（沒有 `.clade/vendor/scripts/flow/`）→ 印 warning、exit 0。
  **NEVER** 讓一支遙測 action 擋住任何人的 CI。
- 事件的 `substrate` 固定 `ci`；`work-id` 留空會鑄一個 orphan id —— 事件照樣落地，
  只是歸不到某件具名工作，且在視圖裡數得出來。
