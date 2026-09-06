# Lessons

跨 session 工作時被糾正後留下的 pattern。只放**流程 / 工作習慣**層級的判準；
技術踩坑走 clade `docs/pitfalls/`，規約層改動走 clade 源檔。

---

## 共用資源的當下讀數，不要以事實形式離開讀取的當下

**發生**：2026-08-19，寫 TD-005 的 durable brief 時，把一次性 `git status` 的結果
（「clade 有 1 個 dirty 檔 + 4 個 active worktree」）當事實寫進 brief 與 tech-debt entry，
用來論證「現在不該從這個 session 動 clade」。

不到一小時後 `clade-3b` 實測回報：HEAD 已經動過，dirty 的是完全不同的 3 個檔。論證本身沒錯
（clade 確實有 in-flight 工作），但**支撐論證的那個數字已經是假的**，而讀 brief 的人會拿它去推論。

**判準**：`git status` / `git worktree list` / `ListAgents` / 埠號佔用 / lock 狀態這類
**全 session 共用資源的當下讀數**，用途是「此刻要不要動手」的一次性判斷。它們可以進入
**對話**（有時間戳、有上下文），但寫進 **durable artifact**（brief / tech-debt entry / HANDOFF /
spec）時 MUST 二選一：

1. 標成「讀取時間 + 用途」，例如「2026-08-19 04:5x 讀，僅用於判斷當下有無 working tree 競用」
2. 或者根本不寫數字，改成「開工前自己實測」+ 要跑哪幾條指令

**NEVER** 讓這種讀數以裸事實的形式出現在 durable 檔案裡。下一個讀者沒有辦法分辨「這是快照」
與「這是不變的事實」，而快照過期時不會有任何 signal。

**同族問題**：拿共用命名空間的快照當歸屬證據（clade 那邊反覆踩到的一類）。
本則若要升級成跨專案 pitfall，落點是 clade `docs/pitfalls/`，需要 clade session。

## 2026-09-06 — 新專案品質入口的驗收邊界

新工具入口暴露的模板既有診斷屬於新專案驗收範圍，不能只交生成器 checkpoint；依授權修完並走正式落地。Codebase index 使用 repo 的 `vendor/scripts/cbm-index.sh`（或已投影入口）保留 provenance 與資源控制。heavy scripts 驗收必須傳附加參數並觀察實際 argv／exit，包含 type-aware `check`。
