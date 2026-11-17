# Runtime cleanup 與 parent worktree lifecycle（`relay`／`fanout`／`next` 派工共用）

## 4. Runtime cleanup

盤點**本 session 自己啟動**的每一個 background task、subagent、monitor、dev server 與 shell：

評估：first-match；以上皆非 → B*
| id | 狀態 | 動作 |
| --- | --- | --- |
| B1 | 由接手 pane 或其他 session 建立 | 不動 |
| B2 | successor／worker 後續不需要 | 停止 |
| B3 | successor 仍需要 | 保留，逐一記錄用途與對應 pane |
| B* | 無法確認 ownership | 先保留並在 receipt 標明，NEVER 以猜測做破壞性 cleanup |

successor 繼承的是整個位置，所以「接手後仍需要」的範圍比直覺寬，**NEVER** 因為「我要收工了」就一律停掉。無法確認 ownership 時先保留並在 receipt 標明，不以猜測做破壞性 cleanup。

**本 pane 誰來關，依 receipt 分流 —— NEVER 無條件套用其中一條。**

| receipt | 本 pane 的歸宿 |
| --- | --- |
| `relay_dispatched`（Herdr 內交棒，**有** predecessor record） | **由 successor 回收，NEVER 自己關。** successor 讀完 brief、確認繼承後跑 `--reclaim <本 pane> --verified`，那一步同時把 scrollback 落盤存證。本 session 自己 close 就是拿 lifecycle 當 completion，也會毀掉那份 scrollback |
| `dispatched`（create-only，**無** predecessor record） | **MUST 自己收尾關閉。** 沒有任何人會來 reclaim 它 —— 這條路徑不寫 predecessor record（[派工收工訊息判準.md](派工收工訊息判準.md) § 5 的表逐字承認「NEVER 填本 pane id 或 predecessor（沒有）」），所以「等 successor 回收」在這裡等的是一個不存在的角色 |

**create-only 自關不毀證據**：scrollback 由 helper 落在 `~/.cache/clade/dispatch-log/<dispatch_id>.log`，
與 pane 是否存活無關。`relay_dispatched` 那條「自己 close 會毀掉 scrollback」的理由**只對 relay 成立**
（那份存證是 `--reclaim` 那一步寫的），**NEVER** 把它外推到 create-only 來論證不該自關。

> 2026-08-28 實證：user 點名 `ccw` → 依 [派工helper與launcher判準.md](派工helper與launcher判準.md) § 3.1 例外必須走 create-only → 本節原本的無條件措辭
> 讓來源 pane 在收工後繼續留著接收訊息，而規約同時禁止它自己關。**清理責任被指派給一個在該分支
> 上不存在的角色**，pane 因此無限期存活。user 逐字回報：「我希望收工就自己關掉，不要再留下來接收訊息」。

## 4.1 Parent worktree lifecycle

交出 session 位置**不**自動處置 parent cwd。若本 session 位於 linked worktree，MUST 實跑並記錄 `path`、`branch`、`dirty`、`merged_to_main`、`locked`：

評估：first-match；以上皆非 → W*
| id | 狀態 | 動作 |
| --- | --- | --- |
| W1 | workflow 明定 parked | 保留，receipt 寫 `retained: <owner + next landing event>` |
| W2 | 已登記批次、尚未正式落地 | 保留来源與佇列，successor 依 commit skill `batch.md` 接手；換 session 不強制結批 |
| W3 | 已登記批次且正式落地 | 主動跑 `wt-helper batch cleanup`；登記時的落地授權含安全回收，不重問 remove／retain，依結果逐來源記 removed／retained 原因 |
| W4 | clean + 內容已在 main 或 origin/<base>（ancestry merged，或 `wt-helper cleanup <slug> --dry-run` 印 `verdict CLEAN`／`merged=Y`／`mergedPr(origin/<base>)=Y` 任一；「已在 origin/<base>、本機 main 尚未同步」算 `removed` 條件——clade 是 PR 制，origin 是落地權威，本機 main 由 `main-sync` 追上，gate 防的是內容遺失而 server 端已保存）+ 無 unique commit／WIP + 無 parking contract ＋ 無宿主設定引用（`--dry-run` 的 `host-config refs=0`；非 0 時先把 systemd unit／drop-in／crontab 改指 main 或刪掉，沒有 flag 可繞過，TD-1148）＋ 無持有者在世的未過期 claim（`--dry-run` 的 `claim` 行 `holder=alive` 時無 flag 可繞——確認持有者已不在後 `claim-helper.ts drop <id>`；`self`／`dead` 放行，`unknown` 放行但留警告） | **直接**以零 force flag 移除 worktree 與 branch（`wt-helper cleanup <slug>`），receipt 寫 `removed`；**NEVER** 先問 `remove`／`retain`——條件全中就是授權 |
| W5 | 零 force flag 的移除被擋，或 W4 的任一條件判不出 | fail closed 列 blocker；答案前停止收工訊息 |
| W* | dirty、未 fully merged、ownership 不明 | fail closed 列 blocker，**NEVER** 用 `--force` 代替判斷 |

worktree 若 `retained`，brief **MUST** 已寫明它由 successor 接手——否則交出去的位置少了它的工作區。

helper receipt 中的 `retained: false` 只描述 child pane，**NEVER** 拿它代替 parent cwd 的 worktree lifecycle receipt。
