<!-- 需要保留交接／阻塞診斷時，把這五欄寫進同一個 package；正常接續不用，也不以此結束回合 -->

# work-route 交接紀錄

- 需求類型: {{WORK_KIND}}
- package 或免 package: {{PACKAGE_OR_EXEMPT_REASON}}
- 下一支 skill: {{NEXT_OWNER_AND_ENTRY}}
- 缺少的前提: {{MISSING_PREREQUISITES}}
- UI checkpoint: {{UI_CHECKPOINT}}

<!--
欄位填法：
- 需求類型：`work_kind` 的值（behavior／bug-uncovered／bug-covered／refactor，hotfix 另註）、續跑、research 或狀態查詢。
- package 或免 package：唯一 work id 與路徑，或免 package 的具體理由。
- 下一支 skill：具名 owner、實際公開／內部入口，以及已執行或待解除的動作。
- 缺少的前提：runtime、路徑／決策、已嘗試的修復與結果；全部查驗通過才填「無」。
- UI checkpoint：需要／不需要／沿用證據，並寫原因。
-->
