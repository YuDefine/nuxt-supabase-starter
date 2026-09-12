<!-- Clade native rule; source: rules/core/evlog-triage-reflex.md; edit canonical source -->
<!-- clade-targets: claude,codex,cursor -->
# Prod 症狀 → 先查 evlog

repo 的 resolved manifest `modules.capabilities` 含 `evlog` 時，prod / staging runtime 症狀的**第一個證據動作 MUST 是查 evlog wide event**，先於 grep code。各 runtime adapter 透過 `clade-data` native skill package 交付同一份 investigate 規約；不以任一 legacy rules 目錄的檔案是否存在判定能力。

協定與 recipe：`rules/modules/capabilities/evlog/evlog-investigate.md`。
