# /dsl-refine 分冊

- ADD `features/backend/dsl.md`（介面根，檔頭六項宣告；目前沒有跨模組句型）。
- ADD `features/backend/profiles/dsl.md`（14 列句型，全部「未實作」）。
- ADD `features/backend/profiles/{get-my-profile,get-profile-by-id,list-profiles}.feature`（全部 `@unverified`）。
- 現況鎖定的 Rule（非期望行為）：種子 id 不符 UUID（Q-profiles-1）、search 萬用字元不跳脫（Q-profiles-3）。
- 沒有 `@code-mismatch`：沒有 runner 實跑，無從判定「規格原意 vs 產品碼」的紅燈；疑點以 Q 註解掛住。
