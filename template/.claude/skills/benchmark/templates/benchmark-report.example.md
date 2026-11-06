# Export 改 streaming 後的 p50 延遲

**結論：faster**

- 數字：p50 延遲 41 ms → 33 ms（−20%）
- 跑數與範圍：每側 7 次交錯，改動前 median 41 ms（range 39–44），改動後 median 33 ms（range 32–35）
- 資料規模與環境：60k 筆資料集；同一台 8 核機器，load generator 另開一台
- Limiter：單核 JSON parse（`node --cpu-prof` 佔 62%，另一次不報告的 profile 跑出）
- 占端到端：匯出路徑占使用者等待的 85%，端到端 p50 同樣快約 17%
- 錯誤數與實際完成的工作量：0 個失敗；兩側各寫出 60,000 筆，輸出 checksum 一致

## 缺口（verdict 是 inconclusive 時必填）

- 無

## 證據

- 原始數字與 profile：`~/.cache/clade/tmp/bench/export-streaming/`
