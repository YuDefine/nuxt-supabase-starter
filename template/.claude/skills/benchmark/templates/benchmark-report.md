# {{CLAIM_TITLE}}

**結論：{{VERDICT}}**（faster／slower／no measurable difference／inconclusive 擇一）

- 數字：{{METRIC_NAME}} {{BEFORE_VALUE}} {{UNIT}} → {{AFTER_VALUE}} {{UNIT}}（{{DELTA_PERCENT}}）
- 跑數與範圍：每側 {{RUN_COUNT}} 次交錯，改動前 median {{BEFORE_MEDIAN}} {{UNIT}}（range {{BEFORE_MIN}}–{{BEFORE_MAX}}），改動後 median {{AFTER_MEDIAN}} {{UNIT}}（range {{AFTER_MIN}}–{{AFTER_MAX}}）
- 資料規模與環境：{{WORKLOAD_AND_MACHINE}}
- Limiter：{{LIMITER_WITH_EVIDENCE}}
- 占端到端：{{END_TO_END_SHARE}}
- 錯誤數與實際完成的工作量：{{ERROR_COUNT_AND_WORK_COUNT}}

## 缺口（verdict 是 inconclusive 時必填）

- {{GAP_DESCRIPTION}}

## 證據

- 原始數字與 profile：{{EVIDENCE_PATH}}
