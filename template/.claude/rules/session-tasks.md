<!--
🔒 LOCKED — managed by clade
Source: rules/core/session-tasks.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->

---
description: Session-scoped 輕量 todo 機制——以 per-session 分檔避免 multi-session 併發 lost update，並定義升級到 HANDOFF / ROADMAP / tech-debt / spectra change 的路徑
globs: ['tasks/**']
---

# Session Tasks

繁體中文 | [English](./session-tasks.en.md)

**核心命題**：spectra change 流程（propose → apply → archive）適合大型結構化變更；ad-hoc 小工作（debug、配置調整、單檔 fix、勘查）需要更輕量的 todo 機制。但若用全域單檔（如 `tasks/todo.md`）作為共享 working memory，multi-session 並行時會 lost update 或互相覆蓋清理結果。本規則以 **per-session 分檔** 解決，並強制升級路徑避免長期堆積。

此規則優先於全域 `~/.claude/CLAUDE.md`「任務管理」段落（若存在）。

---

## 何時用 `tasks/`，何時不用

| 工作類型 | 應該放哪 | 理由 |
| --- | --- | --- |
| 大型結構化變更（涉及 spec、跨多檔、跨層、需要 design review） | spectra change（`openspec/changes/`） | 走完整 propose → apply → archive 流程 |
| **Ad-hoc 小工作**（單一 debug、配置調整、單檔 fix、短勘查） | **`tasks/<id>.md`**（本規則） | 比 spectra 輕一個量級 |
| 跨 session WIP 交接 | `HANDOFF.md` | session 結束時的「信件」 |
| 中長期未來工作（不在當前 change scope） | `openspec/ROADMAP.md` `## Next Moves` | 排優先序的未來 backlog |
| 範圍外技術債 / 未解決項長期追蹤 | `docs/tech-debt.md`（TD-NNN） | 永續 register |
| 不需要追蹤的單一 prompt | 都不需要 | 直接做完即可 |

**判斷準則**：不確定 → 先用 `tasks/<id>.md`；發現規模膨脹（要動 spec、要 design review、要跨多檔） → 升級到 spectra change，刪除原 tasks 檔。

---

## 檔案結構

```
tasks/
  <YYYY-MM-DD-HHMM>-<slug>.md     ← 一 session 一檔，當前進行中
  archive/
    <YYYY-MM-DD-HHMM>-<slug>.md   ← 已完成或已升級的舊檔（git history 已留證，可直接刪）
  lessons.md                        ← 維持單檔（被糾正才寫，撞檔機率極低）
```

**禁止**：`tasks/todo.md` / `tasks/notes.md` / 任何共享單檔。

---

## 寫入規約（4 條，剛好夠用）

1. **開工**：用 `Write` 建 `tasks/<YYYY-MM-DD-HHMM>-<slug>.md`
   - timestamp 取**開工當下**（HHMM 解析度足夠；同分撞名極罕見，撞到加 `-2` 後綴即可）
   - slug 用 kebab-case 描述任務本質（如 `imports-warn-fix`、`handoff-cleanup`）
2. **進行中**：只 `Edit` 自己那檔
3. **session 結束**：對自己那檔的每個未完項做選擇（見下節「升級路徑」），全部處理完後 → `mv` 到 `archive/` 或直接刪
4. **NEVER** 動別的 session 的 tasks 檔（即使檔名顯示「已完成」也不要清，那是該 session 的責任）

**為什麼分檔**：與 `.spectra/claims/*.json`、`openspec/changes/<name>/`、`docs/decisions/YYYY-MM-DD-*.md` 同 pattern——每個 entity 一檔，避免多寫者單檔競態。

---

## 模板

```markdown
# <一句話描述任務>

> Session: <YYYY-MM-DD HH:MM>
> 狀態: in-progress | blocked | done

## Plan

- [ ] step 1
- [ ] step 2

## Notes

（執行中記錄發現、決策、blocker）

## Review

（完成後填：實際做了什麼、有沒有偏離 plan、學到什麼）
```

最簡可只留 `Plan`；`Notes` / `Review` 視任務複雜度補。

---

## 升級路徑（session 結束時必跑）

對自己 tasks 檔的每個未完項做選擇：

| 未完項類型 | 升級到 | 動作 |
| --- | --- | --- |
| 下一 session 要立刻接手 | `HANDOFF.md` 的 `## In Progress` | 寫進去（含 change 名稱、檔案路徑、卡點），符合 `handoff.md` 規約 |
| 等待外部條件（合約、ramp 日期、第三方 API ready） | `docs/tech-debt.md`（TD-NNN） | 建 register entry，符合 `follow-up-register.md` 規約 |
| 未來才做、可排優先序 | `openspec/ROADMAP.md` `## Next Moves` | 加 `- [priority] 描述 — 依賴：xxx` 條目 |
| 規模膨脹了（要動 spec、design review、跨多檔） | 立新 spectra change | 走 `spectra-propose` |
| 純放棄 | 直接刪檔 | git history 留證 |

**升級完成 → 自己的 tasks 檔搬 `archive/` 或直接刪。**

---

## 與其他真相層的分工

| 真相層 | 時間尺度 | 寫入者 | 併發策略 |
| --- | --- | --- | --- |
| `.spectra/claims/*.json` | 即時 ownership | `spectra:claim` script | per-change 一檔 |
| **`tasks/<id>.md`** | **本 session 工作記憶** | **當前 session 自己** | **per-session 一檔** |
| `HANDOFF.md` | 跨 session 交接 | session 結束時自己寫；下一 session 接手後刪對應項 | 串行（接手者讀+刪） |
| `openspec/changes/<name>/tasks.md` | spectra change 任務追蹤 | 該 change 的 owner | per-change 一檔 |
| `openspec/ROADMAP.md` | 中長期 + AUTO 同步 | hook AUTO 區塊 + 使用者 MANUAL 區塊 | AUTO 冪等重算 |
| `docs/tech-debt.md` | 永續追蹤 | 發現技術債時手動 | 單檔但低頻寫 |
| `docs/solutions/`, `docs/decisions/` | 長期知識 | 任務結束時評估 | per-topic 一檔 |

---

## 與其他規則的關係

- **`handoff.md`**：本規則的「升級路徑」會把 tasks 檔內未完項升到 `HANDOFF.md`；handoff 規約後續處理跨 session 接手
- **`work-claims.md`**：tasks 檔不替代 claim。做 active spectra change 仍 **MUST** 先 `spectra:claim`；tasks 檔只是個人工作記憶
- **`follow-up-register.md`**：tasks 檔內若出現「等待中」「之後再說」性質的項目，升級時要建 TD-NNN entry，不能只留註記在 tasks 檔
- **`scope-discipline.md`**：tasks 檔執行中發現範圍外問題，照樣走「不擴散、必登記、不擅改」三原則，登記到對應位置（不是繼續往自己的 tasks 檔塞）

---

## 必禁事項

- **NEVER** 在 `tasks/` 下寫共享單檔（`todo.md`、`notes.md` 等）—— multi-session 並行時會 lost update
- **NEVER** `Edit` 別的 session 的 tasks 檔（即使該檔看起來「已完成」也不要代清，那是原 session 的責任）
- **NEVER** 把長期內容（TD、決策、未來計劃）留在 tasks 檔不升級 —— 該升 HANDOFF / ROADMAP / tech-debt / solutions / decisions
- **NEVER** 用 `tasks/<id>.md` 替代 spectra change 處理大型結構化工作 —— 規模膨脹時改走 `spectra-propose`
- **NEVER** session 結束時放著 tasks 檔不處理 —— 必須走「升級或刪除」二擇一

---

## 與 `tasks/lessons.md` 的關係

`lessons.md` 維持單檔，因為：

- 寫入時機（被糾正後）頻率極低
- 內容是長期累積的個人 lessons，不是 session-scoped working memory
- 撞檔機率可忽略（兩 session 同時被糾正且同時寫 lessons 的機率近零）

若實務上發現 `lessons.md` 也有併發問題，再考慮拆 `lessons/<topic>.md`。預設保持簡單。

---

## 違反時的回報方式

Hook / human review 偵測到違反時，輸出格式統一：

```
[Session Tasks] <檢查名稱> 不通過

問題：<一句話描述>

證據：
  - <檔案路徑 / 具體狀況>

修正方式：
  - <具體步驟，例如「將 tasks/todo.md 的 N 個未完項升到 HANDOFF.md，再刪 todo.md」>
```
