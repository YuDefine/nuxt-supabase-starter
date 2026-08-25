<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/work-loop/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# state 寫入 —— 五道保護與 STATE_* token 處置

SKILL.md Step 7.3 留的是一條判讀規則（非 `STATE_OK` 即停）。本檔收的是**收到某個 token 之後**
才需要的東西：每道保護擋掉什麼、每個 token 怎麼處置、`.bak` 的救援契約。

**NEVER 憑印象在 token 之間選處置**——`STATE_CORRUPT_REFUSED`（正本壞了、不動它）與
`STATE_ROUND_REGRESS`（patch 算錯、確認過才加 flag）的方向相反。

## 五道保護

- 新內容寫進同目錄 temp 後**讀回來 parse 一次**才換正本（rename 要原子就必須同目錄）
- `.bak` 先寫 temp 再 rename —— `cp` 中途失敗不會把既有備份截斷。漏掉這道的長相是：`.bak` 寫壞、正本照換、還印 `STATE_OK`，兩份一起沒了
- 換檔用 `rename(2)`（即 `mv -T` 語義）：`state.json.bak` 若是**目錄**（前一次救援留下的、或誰手滑 mkdir 的）直接失敗，**NEVER** 把備份搬進那個目錄還回成功。實測（2026-08-12）：無 `-T` 時該情境回 `STATE_OK` 而備份根本不存在
- `round` 不得倒退 —— 倒退代表本輪讀到的是舊 state 或 patch 算錯，續寫會靜默吃掉中間輪次的 bookkeeping。確認過是刻意的才加 `--allow-round-regress`
- retention pass（`--no-retention` 關閉）—— 契約見 Step 1 § Retention。archive **先**落地才換正本，所以被移出正本的內容不會兩邊都不在

**stderr 的 `STATE_ARCHIVE_FAILED` / `STATE_OVERSIZE` 都不是失敗 token**（stdout 仍是 `STATE_OK`、exit 0），**NEVER** 因為看到它們就中止本輪 bookkeeping：

- `STATE_ARCHIVE_FAILED: <原因>` —— 本輪不 rotate、state **照原樣完整**寫入。正本是完好的，停下來只會製造 `state.round` < HANDOFF 的落差。記進 `sessionNote` 讓下一輪知道 archive 落點有問題，然後**照常收尾**
- `STATE_OVERSIZE: …｜前三大：<欄位=bytes>` —— 被點名的欄位是自創欄位（無 reader 契約），處置見 Step 1 § Retention：**當輪**收斂掉它

**現有 `state.json` parse 不過時它回 `STATE_CORRUPT_REFUSED` 並且不動正本**，**NEVER** 當成 `{}` 從頭寫 —— 那會讓 `round` 從 0 重來且每個欄位看起來都合法（處置走 Step 1 § `STATE_CORRUPT` 的還原程序）。

**看到 `STATE_WRITE_FAILED` / `STATE_BACKUP_FAILED` / `STATE_ROUND_REGRESS` / `STATE_CORRUPT_REFUSED` MUST 立刻停止本輪 bookkeeping**（`STATE_OK` 以外的每一個都是）：四者都保證正本仍是上一輪的完好版本，照 7.2 Iron Law 的無害方向倒（`state.round` < HANDOFF，下一輪冪等重做）。`STATE_BACKUP_FAILED` 額外意味著磁碟或權限有問題，**MUST** 在 `sessionNote` 記一筆再重試。**NEVER** 因為「內容應該沒問題」跳過驗證，也 **NEVER** 在失敗後改用直接覆寫繞過。

## `.bak` 的救援契約

**`.bak` 只保留上一輪的完好版本，NEVER 累積多份帶時間戳的副本**——救援時要能一眼看出該還原哪一個。
且 **NEVER 把寫壞的檔存成 `.bak-<ts>`**：那個名字會讓還原程序把屍體當備份撿起來（2026-08-12 <consumer-b>
實際留過一份，已改名 `state.json.corrupt-<ts>`）。
