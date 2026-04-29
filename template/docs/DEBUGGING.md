---
audience: both
applies-to: post-scaffold
related:
  - TROUBLESHOOTING.md
  - FAQ.md
ai-lookup: 方法論教學型 doc，含 4 個典型 debug 場景。AI 應先讀使用者描述的錯誤訊息，跳到對應段落（測試失敗 / API 錯誤 / 慢查詢 / UI 狀態）取得「怎麼讀 + 修復」步驟
---

# 除錯指南

遇到問題時，這份指南教你怎麼看懂錯誤、找到原因、修復問題。

> AI agent：本檔依「錯誤類型」分節，每節結構為「典型輸出 → 怎麼讀 → 修復」。對症狀型問題（port 佔用 / supabase start 失敗等）先看 [TROUBLESHOOTING.md](TROUBLESHOOTING.md)；本檔處理需要分析的場景。

---

## 1. 讀懂 Vitest 測試失敗

### 典型失敗輸出

```bash
$ pnpm test

 FAIL  test/unit/bookmarks/index.post.test.ts > POST /api/v1/bookmarks > 成功建立書籤
AssertionError: expected 401 to be 201

 ❯ test/unit/bookmarks/index.post.test.ts:25:31
     23|   const res = await handler(event)
     24|
     25|   expect(res.statusCode).toBe(201)
       |                         ^
     26|   expect(res.data.title).toBe('Test')
     27| })
```

### 怎麼讀

| 行                                      | 意義                         |
| --------------------------------------- | ---------------------------- |
| `FAIL test/unit/.../index.post.test.ts` | 哪個測試檔案失敗             |
| `> 成功建立書籤`                        | 哪個測試案例失敗             |
| `expected 401 to be 201`                | 實際值 vs 預期值             |
| `index.post.test.ts:25:31`              | 失敗的確切位置（檔案:行:列） |

### 常見原因與修復

| 狀況                   | 原因             | 修復                      |
| ---------------------- | ---------------- | ------------------------- |
| 預期 201 得到 401      | Mock auth 沒設定 | 加入 `vi.mock()` 模擬認證 |
| 預期 200 得到 500      | 資料庫 mock 失敗 | 檢查 Supabase client mock |
| 測試通過但 coverage 低 | 缺少邊界測試     | 加入 error case 測試      |

### 實用指令

```bash
# 只跑特定測試檔案
vp test test/unit/bookmarks/index.post.test.ts

# Watch 模式（存檔自動重跑）
vp test --watch test/unit/bookmarks/

# 看詳細輸出
vp test --reporter=verbose
```

---

## 2. 除錯 Server API 端點

### 症狀：API 回傳非預期的狀態碼

```bash
$ curl -s http://localhost:3000/api/v1/bookmarks | jq .
{
  "statusCode": 500,
  "statusMessage": "Internal Server Error",
  "message": "relation \"public.bookmarks\" does not exist"
}
```

### 怎麼讀

| 欄位                          | 意義                                       |
| ----------------------------- | ------------------------------------------ |
| `statusCode: 500`             | Server 內部錯誤（不是你的 request 有問題） |
| `relation ... does not exist` | 資料表不存在（migration 沒跑）             |

### 逐步除錯

1. **確認資料表存在**：

```bash
# 開啟 Supabase Studio
# http://localhost:54323 → Table Editor
# 或用 SQL：
pnpm db:reset  # 重新套用所有 migration
```

2. **確認 API handler 邏輯**：

```bash
# 檢查 server/api/v1/bookmarks/index.get.ts
# 確認 Supabase client 呼叫正確
```

3. **看 Nuxt server log**：

```bash
# pnpm dev 的終端機會顯示完整 stack trace
# 找到 "at" 開頭的行 — 那是錯誤發生的位置
```

### 常見 API 錯誤

| 狀態碼 | 常見原因              | 修復                                  |
| ------ | --------------------- | ------------------------------------- |
| 401    | 未登入或 session 過期 | 確認 request 帶有 auth cookie         |
| 403    | RLS 政策阻擋          | 檢查 RLS 是否有 `service_role` bypass |
| 404    | 路由不存在            | 確認檔案名稱符合 Nuxt 路由規則        |
| 500    | Server 端錯誤         | 看終端機 log 的 stack trace           |

---

## 3. 分析慢查詢（EXPLAIN ANALYZE）

### 什麼時候用

當頁面載入超過 1 秒，或 API 回應時間異常時。

### 怎麼用

在 Supabase Studio（`http://localhost:54323`）的 SQL Editor 執行：

```sql
EXPLAIN ANALYZE
SELECT * FROM public.profiles
WHERE user_id = 'some-uuid';
```

### 讀懂輸出

```
Seq Scan on profiles  (cost=0.00..25.00 rows=1 width=200) (actual time=0.150..12.300 rows=1 loops=1)
  Filter: (user_id = 'some-uuid'::uuid)
  Rows Removed by Filter: 999
Planning Time: 0.100 ms
Execution Time: 12.450 ms
```

| 關鍵字                        | 意義                 | 好/壞             |
| ----------------------------- | -------------------- | ----------------- |
| `Seq Scan`                    | 全表掃描（逐筆檢查） | 慢                |
| `Index Scan`                  | 走索引查找           | 快                |
| `Rows Removed by Filter: 999` | 掃了 999 筆沒用的    | 浪費              |
| `Execution Time: 12.450 ms`   | 實際執行時間         | 超過 100ms 要注意 |

### 修復：加索引

```bash
-- 建立 migration
supabase migration new add_profiles_user_id_index
```

在 migration 檔案中：

```sql
CREATE INDEX IF NOT EXISTS idx_profiles_user_id
ON public.profiles (user_id);
```

再次 `EXPLAIN ANALYZE` 確認變成 `Index Scan`。

---

## 4. 使用 Vue DevTools 檢查狀態

### 安裝

瀏覽器安裝 [Vue DevTools](https://devtools.vuejs.org/) 擴充功能。

### 檢查 Pinia Store 狀態

1. 開啟 DevTools → Vue 分頁 → Pinia
2. 找到你的 Store（例如 `useUserStore`）
3. 查看目前的 state 值
4. 可以**直接修改** state 來測試 UI 反應

### 檢查元件 Props

1. DevTools → Vue 分頁 → Components
2. 點擊頁面上的元件
3. 右側面板顯示 props、data、computed 的值
4. 確認資料是否正確傳遞

### 常見問題

| 症狀       | 在 DevTools 看           | 修復                   |
| ---------- | ------------------------ | ---------------------- |
| 頁面沒資料 | Pinia store state 是空的 | 確認 query 有被觸發    |
| 資料不更新 | computed 值沒變          | 確認 reactive 物件正確 |
| 元件沒渲染 | props 是 undefined       | 確認父元件有傳值       |

---

## 快速參考

| 問題類型  | 用什麼工具        | 指令 / 動作                  |
| --------- | ----------------- | ---------------------------- |
| 測試失敗  | Vite+             | `vp test --reporter=verbose` |
| API 錯誤  | curl + server log | `curl -s url \| jq .`        |
| 查詢慢    | EXPLAIN ANALYZE   | Supabase Studio SQL Editor   |
| UI 狀態   | Vue DevTools      | 瀏覽器 F12 → Vue 分頁        |
| 型別錯誤  | TypeScript        | `pnpm typecheck`             |
| 格式/lint | OXLint            | `pnpm lint`                  |
