
# Rule 1 - `bp-scan.ts --changed-only` 的兩類輸出可靠度不同，MUST 分開處置

- Level: `MUST`
- 輸出分兩類：

| 類別 | 可靠度 | 怎麼處理 |
| --- | --- | --- |
| 未登記／無入向引用的新資產 | 機械精確 | 直接補登記或補引用 |
| 主題詞命中的既有條目 | 有偽陽性 | 人工看一眼「這條是不是已經涵蓋我要做的事」 |

- **NEVER** 把第二類的命中講成「確定重複」——它是檢索提示，不是語意重複偵測。
- 看過第二類後判定「這是一條既有資產沒涵蓋的新最佳實踐」時，回到 record 流程判落點，不在 check 裡直接落地。

## Good Example

- 這個例子是好的，因為兩類各自處置，第二類只當提示。

```md
- 新資產 vendor/snippets/foo/README.md 無入向引用 → 已在 rules/core/foo.md 補 pointer
- 主題詞命中 docs/conventions/propagate.md：看過，它講的是 dry-run，不涵蓋這次的 clean-tree 檢查 → 回 record 判落點
```

## Bad Example

- 這個例子是壞的，因為主題詞命中被當成確定重複，直接放棄。

```md
bp-scan 說 propagate 已有條目 → 確定重複，不用登記
```
