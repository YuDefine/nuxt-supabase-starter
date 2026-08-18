---
description: 拖曳／resize 類 UI 的 commit 時機——拖曳中只動視覺（CSS transform），放開才打 API，失敗 rollback + toast；NEVER 在 pointermove 期間發請求或寫 store
paths: ['**/composables/**rag*.ts', '**/composables/**ove*.ts', '**/composables/**esize*.ts', '**/composables/**ort*.ts', '**/components/**rag*.vue', '**/composables/*schedule*/**', '**/composables/*calendar*/**']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/drag-interaction.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


# 拖曳互動：視覺先行，drop 才 commit

適用於任何 pointer 拖曳改變資料的 UI：calendar 事件搬移、看板卡片跨欄、清單排序、時間軸 resize、檔案樹搬移。

## Iron Law

**拖曳過程中 NEVER 發 API 請求、NEVER 寫進持久化 store。** 一次拖曳產生數十到上百個 `pointermove`，每個都打一次就是把後端當畫布用。

三個階段各自的職責：

| 階段 | 允許做的 | NEVER |
| --- | --- | --- |
| `pointerdown` | 記錄起點、量測幾何（一次）、`setPointerCapture` | 立刻標記為 dragging |
| `pointermove` | 更新 local ref（delta）、CSS transform 位移 | 發請求、寫 store、`getBoundingClientRect` |
| `pointerup` | 計算最終值、打一次 mutation | — |

## 必要的實作細節

### 移動門檻區分 click 與 drag

沒有門檻的話，每次點擊都會被當成零位移的拖曳，popover 打不開。

```ts
const DRAG_THRESHOLD = 5   // px

if (!dragging.value) {
  if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
  dragging.value = true
  suppressed.value = true   // 這次手勢結束後的 click 不該開 popover
}
```

`suppressed` 在 `pointerup` **之後**才解除（`setTimeout(…, 0)`），因為 click 事件在 pointerup 之後才派發。

### 幾何只量一次

`getBoundingClientRect()` 會強制 layout。放在 `pointermove` 裡等於每幀 reflow。

```ts
// pointerdown 時量，整個手勢複用
columnRects = [...grid.querySelectorAll('[data-column]')].map(c => c.getBoundingClientRect())
```

### 日期位移用日曆運算，不用 epoch 加減

```ts
// ✅ wall clock 不變，DST 換日也正確
addMinutes(addDays(date, deltaDays), deltaMinutes)

// ❌ DST 那天會差一小時
new Date(date.getTime() + deltaDays * 86400_000)
```

### Optimistic commit 與 rollback

drop 時先更新 local state（畫面立刻定位），再發請求；失敗回滾**該一筆**的 state 並 toast。

```ts
function mutate(id, apply, request, message) {
  const snapshot = snapshotOf(id)   // 只快照這一筆，不是整份 state
  apply()

  request().catch(() => {
    restore(id, snapshot)
    toast.add({ title: message, color: 'error' })
  })
}
```

**MUST 只快照單一實體**。整份 state 的快照會在回滾時把其他同時在飛的樂觀更新一併還原。

### 三個結束路徑都要處理

`pointerup` 不是唯一的結束方式：

- **Escape**：取消位移但保持 `suppressed`（指標還按著，它的 click 仍不該開 popover）
- **`pointercancel`**：系統中斷（來電、手勢辨識搶走）
- **`blur`**：**在視窗外放開滑鼠時 pointerup 與 pointercancel 都不會來**。漏掉這個，`suppressed` 會永久卡住，該元件從此點不開

```ts
useEventListener('blur', () => {
  if (active || suppressed.value) { reset(); release() }
})
```

### 觸控留給捲動

```ts
if (event.pointerType === 'touch') return
```

觸控裝置上拖曳手勢與捲動衝突。要支援觸控拖曳的話 MUST 走長按啟動，不能直接吃 pointerdown。

### pointer capture vs document listener

| 情境 | 用 |
| --- | --- |
| 目標元素在手勢期間穩定存在 | `setPointerCapture`（乾淨，自動清理） |
| 目標可能被虛擬捲動 recycle、或跨容器移動 | `document.addEventListener`，手勢結束時解除 |

虛擬列表裡用 pointer capture 會在列被回收時靜默斷掉手勢。

## 拖曳中的預覽

位移期間 **MUST** 只動 CSS `transform`，不改 DOM 位置或資料。

跨容器移動（例如月曆 chip 換到別的日期格）要看到「落點預覽」時，作法是：把來源從排版輸入中移除、把預覽項目以目標座標加進去、重跑排版。這樣預覽會**真的排進目標格**並讓其他項目讓位，而不是浮在上面。

大量列表要在觸不到的容器早退，否則每次 pointermove 全部重排：

```ts
const rowPreview = computed(() => {
  const e = preview.value
  return e && e.start < rowEnd && e.end > rowStart ? e : null   // 觸不到 → null，該列不重排
})
```

## 相關

- 排版演算法與 draft 虛擬事件：`vendor/snippets/pure-layout-engine/`
- 大量互動元件的掛載成本：`vendor/snippets/lazy-arming/`
- 錯誤處理與 toast 規範：`rules/core/error-handling.md`
