# {{CLI_NAME}} CLI 稽核報告

## 摘要

- 對象：`{{CLI_INVOCATION}}`（{{SOURCE_LOCATION}}）
- 規模：{{SCALE}}（{{SCALE_EVIDENCE}}）；使用者：{{AUDIENCE}}
- 判定統計：PASS {{PASS_COUNT}}、PARTIAL {{PARTIAL_COUNT}}、FAIL {{FAIL_COUNT}}、N/A {{NA_COUNT}}、未驗 {{UNVERIFIED_COUNT}}
- 待修：P0 {{P0_COUNT}} 筆、P1 {{P1_COUNT}} 筆、P2 {{P2_COUNT}} 筆
- 最先修：{{TOP_FIX_SUMMARY}}

## 探測範圍

- 執行的探測：`{{PROBE_COMMAND}}`
- 預設動作確認：{{DEFAULT_ACTION_CHECK}}
- 遞迴依據：{{RECURSION_BASIS}}
- 校準：{{CALIBRATION_RESULT}}
- 刻意不執行的命令：{{NOT_EXECUTED_COMMANDS}}

## 發現

<!-- 依 P0 → P1 → P2 排序；同一根因造成的多個 ID 合併成一筆。每筆都要有證據與修法。 -->

### {{FINDING_SEVERITY}}｜{{FINDING_IDS}}：{{FINDING_TITLE}}

- 判定：{{FINDING_VERDICT}}
- 證據：{{FINDING_EVIDENCE}}
- 對 agent 的影響：{{AGENT_IMPACT}}
- 修法：{{FIX}}
- 改後行為：{{FIXED_BEHAVIOR}}

<!-- 嚴重度與判準檔預設不同時，在該筆加一行「嚴重度調整：<原值> → <新值>：<理由>」。 -->

## 全項對照

<!-- 判準檔每個 ID 一列；N/A 的理由寫在證據欄，未驗的列在下一節，不放在本表。 -->

| ID | 判定 | 嚴重度 | 證據 |
| --- | --- | --- | --- |
| {{CRITERION_ID}} | {{CRITERION_VERDICT}} | {{CRITERION_SEVERITY}} | {{CRITERION_EVIDENCE}} |

## 未驗項

| ID | 原因 | 取得證據需要什麼 |
| --- | --- | --- |
| {{UNVERIFIED_ID}} | {{UNVERIFIED_REASON}} | {{EVIDENCE_NEEDED}} |
