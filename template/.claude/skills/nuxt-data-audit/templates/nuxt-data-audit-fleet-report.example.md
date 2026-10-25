
# nuxt-data-audit fleet 報告（範例：3 個 consumer）

```markdown
## nuxt-data-audit fleet report（2026-10-22）

| Consumer | Grade | Stack | E1 | E2 | E3 | E4 | E5 | E6 | E7 | E8 | E9 | E10 | E11 | E12 | E13 | E14 | E15 | E16 | E17 | E18 | E19 |
|----------|-------|-------|----|----|----|----|----|----|----|----|----|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|
| order-hub | C | Colada | pass | pass | fail | pass | partial | N/A | N/A | N/A | fail | pass | N/A | partial | pass | pass | N/A | pass | N/A | pass | pass |
| hr-portal | B | Colada | pass | pass | pass | pass | partial | N/A | N/A | partial | pass | pass | N/A | partial | pass | pass | N/A | fail | N/A | pass | pass |
| site-cms | incomplete | useFetch | pass | fail | pass | pass | pass | pass | pass | pass | N/A | N/A | pass | pass | pass | pass | pass | pass | pass | unknown | pass |

### Fleet-wide gaps（priority order）
1. E12 error handling — 1/3 consumers pass
2. E5 pick／transform — 1/3 consumers pass
3. E3 重複請求 — 2/3 consumers pass

### 未完成項
- site-cms E18：自訂 $api interceptor 是否保留 signal 尚未查清（composables/api.ts:14）
```
