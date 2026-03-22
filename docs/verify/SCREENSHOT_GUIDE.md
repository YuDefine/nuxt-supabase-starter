# 截圖調試指南（browser-use CLI）

## 概述

使用 `browser-use` CLI 在本地開發時對頁面截圖，用於 UI 調試和 commit 前的視覺檢查。

browser-use 透過背景 daemon 保持瀏覽器開啟，命令間延遲約 50ms。

## 環境需求

- browser-use CLI（`~/.browser-use-env/bin/browser-use`）
- Dev server 運行中（預設 port 3000）
- 測試帳號（`E2E_USER_EMAIL` / `E2E_USER_PASSWORD` 環境變數，或 `.env` 中的值）

## 認證

本專案使用 better-auth，支援 email/password 登入。browser-use 可直接填表登入：

```bash
# 1. 開啟登入頁
browser-use open "http://localhost:3000/auth/login"

# 2. 取得表單元素 index
browser-use state

# 3. 填入帳號密碼
browser-use input <email-index> "test@example.com"
browser-use input <password-index> "password"

# 4. 點擊登入
browser-use click <submit-index>
```

登入後 session 保持有效，可直接訪問所有頁面。

## 截圖流程

```bash
# 導航到目標頁面
browser-use open "http://localhost:3000/target-page"

# 等待頁面就緒（視需要）
browser-use wait text "頁面標題"

# 截圖
browser-use screenshot temp/page-name.png

# 互動截圖
browser-use state                              # 取得元素 index
browser-use click <index>                      # 互動
browser-use screenshot temp/next-state.png     # 截圖

# 完成後清理
browser-use close
```

## 命令速查

| 用途       | 命令                                   |
| ---------- | -------------------------------------- |
| 開啟頁面   | `browser-use open <url>`               |
| 頁面狀態   | `browser-use state`                    |
| 點擊元素   | `browser-use click <index>`            |
| 截圖       | `browser-use screenshot <path>`        |
| 等待文字   | `browser-use wait text "文字"`         |
| 等待元素   | `browser-use wait selector "css"`      |
| 輸入文字   | `browser-use input <index> "文字"`     |
| 按鍵       | `browser-use keys "Enter"`             |
| 捲動       | `browser-use scroll down`              |
| 執行 JS    | `browser-use eval "js code"`           |
| 關閉瀏覽器 | `browser-use close`                    |

## 常見問題

### Session 過期

登入 session 過期後會被導向登入頁。重新執行登入流程即可。

### 瀏覽器無法啟動

```bash
browser-use close          # 清除殘留 session
browser-use doctor         # 檢查安裝狀態
browser-use open <url>     # 重試
```

### Dev Server Stale Cache

Nitro dev server 有時會快取已刪除的檔案引用，導致 500 error。重啟 dev server，或刪除 `.nuxt/` 目錄後重啟。
