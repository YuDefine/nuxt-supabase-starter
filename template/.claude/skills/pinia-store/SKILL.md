---
name: pinia-store
description: >-
  Use when 新增或修改 Pinia store。NOT for server 端狀態或 API handler（走 server-api），NOT for
  單一元件內的區域狀態（直接用 ref／reactive）。
---


# Pinia Store

標準 setup store、`storeToRefs`、命名 `use<Name>Store` 照 Pinia 官方寫法即可；本 skill 只放與預設不同的慣例。

# SOP

## Phase 1 -- 判定是否需要全域 store

1. READ 讀取任務需求與 `app/stores/` 既有 store。
2. THINK 判定狀態歸屬：單一元件內的狀態用 ref／reactive，server 資料的寫入與授權轉 server-api skill；確認本次是新增、修改，還是補登入後的全域初始化。

## Phase 2 -- 撰寫與自查

1. READ 讀取 `rules/Store慣例判準.md`。
2. WRITE 依已載入規則新增或修改 `app/stores/<name>.ts`；需要登入後自動載入時，依規則建立 `app/plugins/<name>-init.client.ts`。
3. READ 回頭逐條對照已載入規則；不符就修正。
