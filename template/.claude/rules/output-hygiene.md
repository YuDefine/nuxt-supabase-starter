---
description: 對外輸出規則——commit/PR/註解/跨團隊訊息要乾淨，不夾帶 Claude 內部過程、放棄選項、被糾正的修補軌跡或事後辯解
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/output-hygiene.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->


# Output Hygiene — 別把內部過程變成讀者的負擔

對外輸出（PR / commit message / code comment / Slack / email / 文件 / 跨團隊訊息 / 設計報告）只該讓讀者最快理解「**現況 + 為什麼**」。

**不**是回放思考歷史、嘗試過又退回來的選項、被糾正後的修補軌跡，或為錯誤決定做事後辯解。

跟 user 在 session 內透明揭露錯誤是必要的（誠實 ≠ 隱瞞），但這份內部歷史**不延伸**到對外文字。兩個場域要分清楚：

| 場域 | 該說什麼 |
| --- | --- |
| Session 對話（向 user 透明） | 完整：「我原本以為 X、被你指出 Y、查證後改 Z」 |
| 對外輸出（讀者沒有 session context） | 只給最終決定 + 必要 context；錯誤過程不外露 |

## 三種最常見的洩漏形式

### 1. 「不選 A」當理由

寫「不選 A / 排除 A / 跳過 A」必須能對應到下列其一，否則是 Claude 內部歷史，刪掉：

- ✅ 對方曾建議或考慮過 A
- ✅ 文件 / 規範 / 業界 default 是 A，需解釋為何偏離
- ✅ 讀者本來就會問「那 A 呢？」（高知名度替代方案）
- ❌ 純粹是 Claude 自己曾選過 A 後被糾正

### 2. 列舉「考慮過但沒選」的選項清單

除非 trade-off 對讀者實際有用（如評估 PR 設計、ADR 文件、技術選型 doc），否則別把比較過的選項寫進去。讀者要的是「決定 + 理由」，不是「Claude 的腦內試算」。

### 3. 「我一開始以為 / 後來發現 / 改成」這類敘事

對讀者無價值的 debug 流水帳。對 user 講可以，對外輸出不該有。

## 範例

被糾正後選 Node 24 的場景：

| 場景 | ❌ Bad | ✅ Good |
| --- | --- | --- |
| 給乙方訊息 | 「Node 22 有 packaging bug、Node 20 已 EOL，所以走 24」 | 「Node 22 有 packaging bug，所以走 24（Active LTS）」 |
| commit message | `Pin NODE_VERSION to 24, not 20 — earlier commit pinned 20, that was wrong, ...` | `Pin NODE_VERSION to 24 — sail 8.3 default Node 22 has nodesource npm packaging bug` |
| code comment | `// Use 24, not 20 (20 was EOL'd 2026-03-24)` | `// Pin to 24: nodesource 22.x npm packaging is broken` |

20 在三個 bad 例子裡都是 Claude 的內部歷史 — 對方沒推薦過 20、未來看 commit log / 程式碼的人也不知道前一版釘錯。把這層辯解寫進去只會讓讀者困惑或察覺 Claude 在自我合理化。

## 送出前自查

搜下列關鍵字，每條問「讀者知道嗎？讀者在乎嗎？」否則刪：

- 中：不選 / 排除 / 跳過 / 也不選 / 不該 / 一開始 / 後來發現 / 改成 / 修正前
- En: `not X` / `instead of` / `earlier` / `was wrong` / `used to` / `originally` / `previously`

## 例外

下列場景**該**保留決策過程，因為讀者需要：

- **ADR / 設計文件**：trade-off 比較是文件本身的價值
- **PR description 的 alternatives considered 段**：reviewer 需要知道為何拒絕替代方案
- **HANDOFF.md / 技術債登記**：未來接手者需要知道走過的死路

判別：讀者場域**主動需要**這些資訊，而不是 Claude 主動塞給沒問的人。
