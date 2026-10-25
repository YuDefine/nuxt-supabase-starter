# SSR 與尺寸判準

> 讀取時機：`nuxt-charts` SKILL.md Phase 4 step 3，圖表元件已落進 repo、要檢查 SSR 處理與高度時。

以下依 `nuxt-charts` 3.1.0 套件內容（2026-10-22 查證）：module 以 `mode: 'client'` 註冊除 `DottedMap`、`TopoJSONMap` 以外的所有圖表元件，server 端不渲染它們；兩個地圖元件在 SSR 就輸出 SVG。多數圖表元件的 `height` 是必填的數字（px）。升版後以新版套件實況為準並回頭改本段。

# Rule 1 - v3 圖表不靠 `<ClientOnly>` 處理 SSR

- Level: `SHOULD`
- v3 已把圖表註冊成 client 元件，新寫的圖表**不需要**再包 `<ClientOnly>`、也不需要改成 `.client.vue` 檔名；不要照 v2 時代的範例加這層。
- 付費 block 自帶的 `<ClientOnly>` 可以保留，不必為了符合本規則拆掉。
- 需要在載入前顯示佔位時才用 `<ClientOnly>` 的 `#fallback`，而且佔位高度照 Rule 2 與圖表相同。

## Good Example

- 這個例子是好的，因為直接放圖表元件，靠 module 的 client 註冊處理 SSR。

```vue
<div class="h-80">
  <AreaChart :data="revenue" :categories="categories" :height="320" x-axis="month" />
</div>
```

## Bad Example

- 這個例子是壞的，因為照 v2 習慣多包一層，又沒有給 fallback 高度，載入前版面塌成 0 高。

```vue
<ClientOnly>
  <AreaChart :data="revenue" :categories="categories" :height="320" />
</ClientOnly>
```

# Rule 2 - 每張圖給固定高度，容器先保留同樣的高度

- Level: `MUST`
- 每個圖表元件都傳數字 `:height`（px），**NEVER** 省略或想靠父容器撐高；寬度跟著容器走。
- 圖表外層容器 **MUST** 先佔住同樣的高度（固定高度 class 或 `min-height`），因為 server 輸出與 client 掛載前圖表位置是空的，容器沒佔高就會在掛載後把下方內容往下推。
- 同一列並排的圖用同一個高度，窄螢幕改直排時高度不變。

## Good Example

- 這個例子是好的，因為元件高度與容器高度一致，掛載前後版面不跳。

```vue
<div class="min-h-[320px]">
  <BarChart :data="orders" :categories="categories" :y-axis="['count']" x-axis="week" :height="320" />
</div>
```

## Bad Example

- 這個例子是壞的，因為容器沒有高度、元件也沒傳 `height`，掛載後整頁往下跳。

```vue
<div>
  <BarChart :data="orders" :categories="categories" :y-axis="['count']" x-axis="week" />
</div>
```
