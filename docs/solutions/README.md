# Solutions Knowledge Base

此目錄存放專案開發過程中累積的問題解決經驗。由 Claude 自動萃取和搜索，不需手動維護。

## 目錄結構

| 分類                    | 說明                                        |
| ----------------------- | ------------------------------------------- |
| `build-errors/`         | 建置錯誤（bundler、TypeScript、依賴衝突）   |
| `test-failures/`        | 測試失敗（mock 問題、環境設定、非預期行為） |
| `runtime-errors/`       | 運行時錯誤（undefined、crash、例外處理）    |
| `performance-issues/`   | 效能問題（N+1、記憶體、載入速度）           |
| `database-issues/`      | 資料庫問題（RLS、migration、query 效能）    |
| `security-issues/`      | 安全問題（XSS、CSRF、權限漏洞）             |
| `ui-bugs/`              | UI 問題（樣式、響應式、互動異常）           |
| `integration-issues/`   | 整合問題（第三方 API、跨服務通訊）          |
| `logic-errors/`         | 邏輯錯誤（業務規則、計算錯誤）              |
| `developer-experience/` | 開發體驗（工具設定、workflow 改善）         |
| `workflow-issues/`      | 工作流程問題（CI/CD、部署、環境）           |
| `best-practices/`       | 最佳實踐（pattern 發現、架構決策）          |
| `documentation-gaps/`   | 文件缺口（undocumented behavior、API 差異） |

## 文檔格式

每份文檔以 YAML frontmatter 開頭：

```yaml
---
module: <受影響的模組或元件>
date: YYYY-MM-DD
problem_type: <上表分類名>
component: <具體檔案或功能>
symptoms:
  - <可觀察的症狀 1>
  - <可觀察的症狀 2>
root_cause: <一句話根因>
resolution_type: fix | workaround | configuration | upgrade
severity: low | medium | high | critical
tags:
  - <選用標籤>
---
```

### 內文段落

- **Problem** — 1-2 句問題描述
- **What Didn't Work** — 排查過程中嘗試了什麼無效的方法（幫助未來避免繞路）
- **Solution** — 最終解法，含關鍵程式碼片段
- **Prevention** — 如何預防此問題再次發生

## 自動化流程

此目錄由 Claude 在以下時機自動操作（定義於全域 `~/.claude/CLAUDE.md` Auto-Harness 段落）：

- **搜索**：規劃新功能或修 bug 前，自動搜索相關歷史經驗
- **萃取**：解決非 trivial 問題後，自動寫入新文檔
- **更新**：發現已有相似記錄時，更新既有文檔而非新建
- **與 cq 互補**：cq 是跨專案通用知識，docs/solutions/ 是本專案特有的經驗
