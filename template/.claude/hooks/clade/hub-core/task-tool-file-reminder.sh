#!/usr/bin/env bash
# PreToolUse(TaskCreate) hook — 呼叫 harness 的 TaskCreate 時，若本 session 還沒建 tasks 檔就提醒。
# **warn-only，永不 block。**
#
# 為什麼需要機械提示而不是只寫規約：`TaskCreate` 的系統提醒會在 session 中**反覆**出現
# （"consider using TaskCreate"），而 session-tasks 規約只在冷載時注入一次。兩個機制職責描述
# 重疊（都自稱「本 session 的工作記憶」），但只有一個會持續出聲——注意力競爭下會叫的那個贏。
#
# 實證（2026-08-02 clade session）：同一個 session 內修好 session-tasks 的 paths-gating 死鎖、
# 用 rule-eco-test 實測措辭 4/4 有效、還加了 stop-wip-guard 的今日檔提示，然後在後續兩輪工作裡
# 自己沒建 tasks 檔、改用 TaskCreate 代替。不是忘記規約內容（剛寫完），是注意力被搶走。
#
# 所以這裡的做法是**以 harness 治 harness**：在被搶的那一刻，用 harness 自己的音量把注意力
# 導回檔案。規約那句（rules/core/session-tasks.md）是本 hook 訊息的 SoT，不是主要防線。
#
# 已知 false negative：同日別 session 建的檔會讓本 hook 消音（與 stop-wip-guard 同一取捨——
# 分不出檔案歸屬，寧可漏報也不要對已經合規的 session 嘮叨）。
#
# 非 git repo / 無 tasks 目錄權限 → 靜默 exit 0。
#
# 出口是 JSON stdout 的 `hookSpecificOutput.additionalContext`，**不是** stderr。
# 2026-08-06 work-loop round 31 四通道實測（TD-427 step 1）：PreToolUse 上 stderr、裸 stdout、
# `permissionDecisionReason` 三者都**到不了 agent**，只有 `additionalContext` 會被注入成
# system-reminder。本 hook 的收件人是 agent（見上方 L13「以 harness 治 harness」），走 stderr
# 等於從上線以來一次都沒出過聲。
#
# **NEVER 為了送達改 exit code**：PreToolUse 的 exit 2 是 block，與 L3「warn-only，永不 block」
# 直接衝突。送達問題用通道解，不用 exit code 解。
# **NEVER 補 `permissionDecision`**：帶 `"allow"` 會自動核准該次工具呼叫、繞過 permission 提示。
# 同批實測確認 `additionalContext` 不帶 `permissionDecision` 照樣送達，所以不需要它。

set -euo pipefail
cat > /dev/null

today=$(date +%Y-%m-%d)

# 已有今日 task 檔 → 本 session（或同日別 session）已建檔，不吵
if [ -d tasks ] && compgen -G "tasks/${today}-*.md" > /dev/null 2>&1; then
  exit 0
fi

# 訊息內文不含 `"` 與 `\`，所以直接組 JSON 字串常量（`\n` 逐個顯式寫出），不依賴 jq——
# 本 hook 原本沒有 jq 依賴，為了送達而新增一個外部依賴會換來另一種靜默失效。
msg="⚠️ 本 session 還沒有 tasks 檔（找不到 tasks/${today}-*.md）。\n"
msg="${msg}\n"
msg="${msg}   TaskCreate 管的是**進度呈現**，不是跨 compact 的狀態載體——auto-compact 觸發後\n"
msg="${msg}   task list 與 context 一起消失，留下來的只有檔案。\n"
msg="${msg}\n"
msg="${msg}   per session-tasks：先 Write tasks/${today}-<HHMM>-<slug>.md 再繼續。"

printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"%s"}}\n' "$msg"
exit 0
