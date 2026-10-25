
# nuxt-data-audit fleet 報告（樣板）

輸出到對話；只複製 code block 內容。每個 consumer 一列，Grade 依該 consumer 完整查核計算；欄位不夠寬時 E 欄可分兩張表，但 19 項都要出現。輸出即 baseline，不另存。

```markdown
## nuxt-data-audit fleet report（{{DATE}}）

| Consumer | Grade | Stack | E1 | E2 | E3 | E4 | E5 | E6 | E7 | E8 | E9 | E10 | E11 | E12 | E13 | E14 | E15 | E16 | E17 | E18 | E19 |
|----------|-------|-------|----|----|----|----|----|----|----|----|----|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|
| {{CONSUMER}} | {{GRADE}} | {{STACK}} | {{E1}} | {{E2}} | {{E3}} | {{E4}} | {{E5}} | {{E6}} | {{E7}} | {{E8}} | {{E9}} | {{E10}} | {{E11}} | {{E12}} | {{E13}} | {{E14}} | {{E15}} | {{E16}} | {{E17}} | {{E18}} | {{E19}} |

### Fleet-wide gaps（priority order）
1. {{GAP1_ID}} {{GAP1_TITLE}} — {{GAP1_PASS}}/{{GAP1_APPLICABLE}} consumers pass
2. {{GAP2_ID}} {{GAP2_TITLE}} — {{GAP2_PASS}}/{{GAP2_APPLICABLE}} consumers pass
3. {{GAP3_ID}} {{GAP3_TITLE}} — {{GAP3_PASS}}/{{GAP3_APPLICABLE}} consumers pass

### 未完成項
{{INCOMPLETE_ITEMS}}
```
