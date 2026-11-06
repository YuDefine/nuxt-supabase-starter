# Rule 1 - 先凍結 harness 並證明它分得出差異

- Level: `MUST`
- 先把負責的指標與實驗完整性握在自己手上：指出會移動結果的真實 workload 維度（資料量、歷史、狀態、併發），選一個能重現使用者抱怨的 case；沒有 case 能重現就先修重現，不要 hillclimb。
- 建好量測 harness 後，先在對照的真實 workload 上確認目標 case 重現症狀、較簡單的 case 如預期分開；分不開就改 workload 或指標，再凍結。
- 凍結前用 `量測七問.md` 查過 harness，並讓它印出錯誤數與已完成的工作量。
- 凍結後一條可重複的命令印出指標，取樣多到壓過 noise（median of N，不是單次）；改任何東西之前先記下 baseline 與 regression gate（必須持續通過的測試）的綠燈。

## Good Example

- 這個例子是好的，因為先證明 harness 分得出重 case 與輕 case，才凍結。

```md
harness 在 60k 筆 case 重現 90 秒 typecheck，在 5k 筆 case 只要 9 秒；兩者分得開。命令 `./bench.sh`（median of 5）印 `metric=… errors=0 work=60000`，已凍結。
```

## Bad Example

- 這個例子是壞的，因為 harness 沒證明靈敏度，一邊跑一邊改量測方式。

```md
先隨便量一下，邊改程式邊調 harness 的取樣數。
```

# Rule 2 - 停止條件是目標加上次數下限

- Level: `MUST`
- 停止條件寫成可檢查的 predicate：目標值搭配迭代次數下限，避免一次運氣好的早期勝利結束整個 run（例如「至少比 baseline 好 50% 且至少 10 輪」）。
- 使用者給了數字就用他的，沒有就先與他約定。
- **NEVER** 放寬 predicate 來湊達標；便宜的假設還沒試完時**NEVER** 提早收手。卡住就浮出來回報，不要空轉。

## Good Example

- 這個例子是好的，因為目標與次數下限都可檢查。

```md
停止條件：typecheck median ≤ 45 秒，且已跑至少 10 輪。
```

## Bad Example

- 這個例子是壞的，因為只有目標，第一輪運氣好就收工，且事後改成較鬆的目標。

```md
目標 45 秒，第 2 輪量到 44 秒就停；其實平均 60 秒，改成「差不多就好」。
```

# Rule 3 - 假設要指名機制，並依 perf mantras 排序

- Level: `SHOULD`
- 每個假設都指名具體機制（「把 X 移出開機路徑，因為它擋住首次繪製」），不是「試試 memoize」。
- perf 指標的假設依下列順序由便宜到貴排；較前面的就達標就停（只借順序，不借 pstack 該步的 stop rule）：不做、不重做、少做、晚做、偷偷做（不在使用者面前）、並行做、做便宜點。
- 先讀紀錄再提下一個假設，避免重複試過的東西。

## Good Example

- 這個例子是好的，因為假設指名機制且屬於「不重做」。

```md
假設 3：`resolveConfig` 在每個檔案都重做一次，快取一次結果就能省掉 N−1 次（屬「不重做」）。
```

## Bad Example

- 這個例子是壞的，因為沒有機制，也沒有排序依據。

```md
假設 3：試試看加快取。
```

# Rule 4 - 一次一個改動，量完決定保留或回退

- Level: `MUST`
- 每輪一個假設、一個改動；**NEVER** 疊上未測的改動，也**NEVER** 靠讀程式碼宣稱贏了。
- 用凍結的 harness 量改動前後，並跑 regression gate。
- 正確性與簡單性勝過數字：贏了但弄壞行為就回退，簡化後數字不變就保留。
- 每輪都在決策紀錄記一列，保留與回退都記；每個保留的修正一個 commit，只 stage 你改的檔。
- 每輪結束時在下一輪之前檢查一次。

決策區塊（predicate 的 `route` 取自 `scripts/summarize-runs.mjs` 的輸出，欄位定義見 SKILL.md Phase 2）：

評估：first-match；以上皆非 → K*
| id | predicate | 動作 |
| --- | --- | --- |
| K1 | regression gate 紅，或行為被弄壞 | 完整回退，紀錄 verdict=reverted |
| K2 | `route` 為 `need-more-runs` | 補跑到每側 ≥ 5 次再判，不進下一個假設 |
| K3 | `route` 為 `no-measurable-difference`、改動是簡化（刪碼、減依賴或減步驟，行為不變）且 gate 綠 | 保留、commit（簡化本身就是收益），紀錄 verdict=kept |
| K4 | `route` 為 `no-measurable-difference`（非簡化） | 完整回退（「可能有幫助」的小改動不保留），紀錄 verdict=reverted |
| K5 | `route` 為 `faster`（`--b` 為改動後；方向已由 `--higher-is-better` 決定）且 gate 綠 | 保留、commit、紀錄 verdict=kept |
| K6 | `route` 為 `slower` | 完整回退，紀錄 verdict=reverted |
| K* | 其他值、欄位缺、script exit 2 | STOP，回報原始輸出 |

## Good Example

- 這個例子是好的，因為保留與回退都由 route 與 gate 決定，且都有紀錄。

```md
假設 2：開 incremental。route=no-measurable-difference，gate 綠，改動不是簡化 → 依 K4 回退，決策紀錄 verdict=reverted。
```

## Bad Example

- 這個例子是壞的，因為在 noise 內的改動被留下，還一次疊了兩個。

```md
開 incremental 又改 tsconfig target，差不多快了一點點，先都留著。
```

# Rule 5 - 越過第一個平台期再結論

- Level: `SHOULD`
- 卡住（連續數次被回退）時：換類別、把幾個差一點的組合起來、重讀原始碼，或試更激進的做法，再結論這座山爬完了。
- 沒到停止條件但剩下的點子都很邊緣、不值得它的成本時才收手，並把原因寫進回報。

## Good Example

- 這個例子是好的，因為卡住後先換類別再判斷。

```md
連續 4 輪回退後，從「快取」換成「晚做」（延後載入）重新列 3 個假設，再繼續。
```

## Bad Example

- 這個例子是壞的，因為卡兩輪就宣告完成。

```md
連續 2 輪沒進展，應該到頂了，收工。
```
