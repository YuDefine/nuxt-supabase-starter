
# nuxt-data-audit 單一 consumer 報告（樣板）

輸出到對話（或使用者指定的檔案）；只複製 code block 內容。19 列逐項填寫，N/A 與 unknown 寫已查範圍或缺的證據；位置用 `file:line`。

```markdown
## nuxt-data-audit report: {{CONSUMER}}

Grade: {{GRADE}}
Stack: {{STACK}}
Reference rule: {{REFERENCE_RULE_STATUS}}

| # | Check | Score | Detail |
|---|-------|-------|--------|
| E1 | setup 無裸 $fetch | {{E1_SCORE}} | {{E1_DETAIL}} |
| E2 | custom composable useFetch key | {{E2_SCORE}} | {{E2_DETAIL}} |
| E3 | 重複請求處理 | {{E3_SCORE}} | {{E3_DETAIL}} |
| E4 | reference data cache | {{E4_SCORE}} | {{E4_DETAIL}} |
| E5 | 大 payload pick／transform | {{E5_SCORE}} | {{E5_DETAIL}} |
| E6 | Lazy／hydration strategy | {{E6_SCORE}} | {{E6_DETAIL}} |
| E7 | routeRules performance | {{E7_SCORE}} | {{E7_DETAIL}} |
| E8 | NuxtImg | {{E8_SCORE}} | {{E8_DETAIL}} |
| E9 | Colada key factory | {{E9_SCORE}} | {{E9_DETAIL}} |
| E10 | useMutation invalidation | {{E10_SCORE}} | {{E10_DETAIL}} |
| E11 | 跨 request state 污染 | {{E11_SCORE}} | {{E11_DETAIL}} |
| E12 | error handling | {{E12_SCORE}} | {{E12_DETAIL}} |
| E13 | Promise.all | {{E13_SCORE}} | {{E13_DETAIL}} |
| E14 | watch／immediate | {{E14_SCORE}} | {{E14_DETAIL}} |
| E15 | Nitro 快取認證邊界 | {{E15_SCORE}} | {{E15_DETAIL}} |
| E15-performance | edge cache driver | {{E15P_SCORE}} | {{E15P_DETAIL}} |
| E16 | 字型 weight | {{E16_SCORE}} | {{E16_DETAIL}} |
| E17 | routeRules 渲染模式 | {{E17_SCORE}} | {{E17_DETAIL}} |
| E18 | 取消訊號貫通 | {{E18_SCORE}} | {{E18_DETAIL}} |
| E19 | 非冪等寫入防重 | {{E19_SCORE}} | {{E19_DETAIL}} |

### Grade 依據
{{GRADE_REASON}}

### Top 3 Improvements
1. **{{TOP1_ID}} {{TOP1_TITLE}}** — {{TOP1_DETAIL}} [{{TOP1_FILES}}]
2. **{{TOP2_ID}} {{TOP2_TITLE}}** — {{TOP2_DETAIL}} [{{TOP2_FILES}}]
3. **{{TOP3_ID}} {{TOP3_TITLE}}** — {{TOP3_DETAIL}} [{{TOP3_FILES}}]
```
