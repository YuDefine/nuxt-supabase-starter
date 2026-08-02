---
description: Session tasks 的操作細節——何時用 / 不用、模板、升級路徑、與其他真相層的分工、lessons.md 邊界
paths: ['tasks/**']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/session-tasks.operations.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


# Session Tasks — 操作細節

觸發條件、檔名格式、禁令在 always-load 的 [[session-tasks]]（本檔是它的操作展開，首次觸碰 `tasks/**` 後自動載入）。

**核心命題**：spectra change 流程（propose → apply → archive）適合大型結構化變更；ad-hoc 小工作（debug、配置調整、單檔 fix、勘查）需要更輕量的 todo 機制。但若用全域單檔（如 `tasks/todo.md`）作為共享 working memory，multi-session 並行時會 lost update 或互相覆蓋清理結果。以 **per-session 分檔** 解決，並強制升級路徑避免長期堆積。

---

## 何時用 `tasks/`，何時不用

| 工作類型 | 應該放哪 | 理由 |
| --- | --- | --- |
| 大型結構化變更（涉及 spec、跨多檔、跨層、需要 design review） | spectra change（`openspec/changes/`） | 走完整 propose → apply → archive 流程 |
| **Ad-hoc 小工作**（單一 debug、配置調整、單檔 fix、短勘查） | **`tasks/<id>.md`** | 比 spectra 輕一個量級 |
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

`tasks/` **是 tracked**（不進 `.gitignore`）——「刪檔 = git history 留證」的前提就是它被追蹤過。`archive/` 可定期整批刪。

---

## 寫入規約補充

開工建檔、只 `Edit` 自己那檔、session 結束升級或刪 —— 這三條在 [[session-tasks]]，本檔不複述（主檔是 always-load，子檔載入時它必然也在）。這裡只補兩件主檔放不下的：

- **timestamp 與 slug**：timestamp 取**開工當下**（HHMM 解析度足夠；同分撞名極罕見，撞到加 `-2` 後綴即可）；slug 用 kebab-case 描述任務本質（如 `imports-warn-fix`、`handoff-cleanup`）
- **別的 session 的 tasks 檔怎麼處理，看檔名 timestamp 距今幾天**：

  | 檔名 timestamp | 你可以做的 | 你不可以做的 |
  | --- | --- | --- |
  | **≤ 7 天** | 什麼都不做 | `Edit`、`mv`、刪 —— 那個 session 可能還活著 |
  | **> 7 天（無主）** | 整檔 `mv` 到 `tasks/archive/` | `Edit` 內容、代跑升級路徑 |

  7 天 = `audit-stale-tasks.ts` 的 stale 門檻（兩處同源，改要一起改）。超過即視為**無主**：原 session 已被 auto-compact／中斷而不存在，「session 結束時清」對它永遠不會發生，不接管就是永遠沒人接管。

  接管**只歸檔**：升級要判斷未完項該進 HANDOFF 還是 TD，那需要原 session 的 context，代判只會產生內容錯誤的條目；內容明顯是長期債時至多在 `docs/tech-debt.md` 一行登記。

  不設接管條款的代價：無主檔單調累積，2026-08-02 實測全 fleet 38 檔、最舊超過四週。

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

`node scripts/audit-stale-tasks.ts`（clade 端，warn-only）數各 consumer 逾期未歸檔的 task 檔，稽核這條有沒有被跳過。它報 STALE 的那一刻**就是**該檔變成無主可接管的那一刻（同一個 7 天門檻），所以那份清單同時是「誰沒收尾」與「誰可以被別人收尾」。

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

- **`handoff.md`**：「升級路徑」會把 tasks 檔內未完項升到 `HANDOFF.md`；handoff 規約後續處理跨 session 接手
- **`work-claims.md`**：tasks 檔不替代 claim。做 active spectra change 仍 **MUST** 先 `spectra:claim`；tasks 檔只是個人工作記憶
- **`follow-up-register.md`**：tasks 檔內若出現「等待中」「之後再說」性質的項目，升級時要建 TD-NNN entry，不能只留註記在 tasks 檔
- **`scope-discipline.md`**：tasks 檔執行中發現範圍外問題，照樣走「不擴散、必登記、不擅改」三原則，登記到對應位置（不是繼續往自己的 tasks 檔塞）

---

## 必禁事項

- **NEVER** `Edit` 別的 session 的 tasks 檔——不分幾天、不分看起來完成沒有。>7 天的無主檔唯一被授權的動作是整檔 `mv` 到 `archive/`（判準表在 § 寫入規約補充）
- **NEVER** 把長期內容（TD、決策、未來計劃）留在 tasks 檔不升級 —— 該升 HANDOFF / ROADMAP / tech-debt / solutions / decisions
- **NEVER** 用 `tasks/<id>.md` 替代 spectra change 處理大型結構化工作 —— 規模膨脹時改走 `spectra-propose`

---

## 與 `tasks/lessons.md` 的關係

**`tasks/lessons.md` 是 consumer 自家 opt-in 短期 working memory，NOT MUST**。跨 session 但只對當前 consumer 有意義的 lesson **MAY** 用此檔短期記錄；沒這個檔也合法（多數 consumer 不需要）。

完整路線決策見 [`docs/discussions/2026-05-18-lessons-md-path.md`](../../docs/discussions/2026-05-18-lessons-md-path.md)。

### 跟其他 SoT 的邊界

寫到 lessons.md 前，先問「換到另一 project 還適用嗎？」決定該寫哪：

| 條目性質 | 寫到哪 | 觸發 |
| --- | --- | --- |
| **跨 consumer** 共享的根因分析 | clade `docs/pitfalls/`（走 `/oops` Mode B） | root cause + detection + fix + prevention 四項齊備 |
| **跨 conversation / 跨 project** 個人偏好或行為更正 | auto-memory `feedback` type | user 糾正且該 lesson 在任何 project 都適用 |
| **跨 session 但只對當前 consumer** 的 lesson | `tasks/lessons.md`（本檔） | 只對當前 repo 有效；不夠成熟升 pitfall；不適合 auto-memory（換 project 不適用） |
| **consumer 自家業務規約**（演進成穩定規約） | `.claude/rules/local/<topic>.md` | 從 lessons.md 升級；override clade core 須加 [[local-rule-override]] 宣告 |

### 升級路徑（lessons.md → 其他 SoT）

- **熟了升 pitfall**：四項齊備 → `/oops` Mode B → 從 lessons.md 移除
- **熟了升 rules/local/**：演進成穩定 consumer 規約 → 寫 `.claude/rules/local/<topic>.md` → 從 lessons.md 移除
- **發現跨 project 適用 → 升 auto-memory**：改寫成 auto-memory `feedback` type → 從 lessons.md 移除
- **過時**：直接刪行（git history 留證）

### 撞檔與 handoff

- 單檔設計：寫入時機（被糾正後）頻率極低，撞檔機率可忽略；若實務上發現 lessons.md 也有併發問題，再考慮拆 `lessons/<topic>.md`
- `/handoff` **NOT** 強制 sweep lessons.md（避免 ritual）；consumer 自家 session 想做手動觸發即可
- clade 不對 lessons.md 設 audit signal（純 consumer 自治區）

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
