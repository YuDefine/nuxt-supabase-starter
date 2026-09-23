#!/usr/bin/env bash
# SessionStart hook — 根分割區（與 /tmp）剩餘空間低於門檻時印一行，正常時完全靜默。
#
# 防的失敗類別：磁碟滿不會以「磁碟滿」出現。2026-09-16 實測 / 剩 1.9G 時，第一個症狀是
# clade publish unit-test gate 跑了 20 分鐘才以 preservation 容量檢查失敗；寫入 ENOSPC 也常
# 表現為 0 byte 檔與下游應用層錯誤。所以要在 session 開頭、任何長任務起跑之前出聲。
#
# /tmp 看的是**有效剩餘**，不是 df：/tmp 是帶 usrquota 的 tmpfs，per-user 硬上限
# （MemTotal 的 40%）低於分割區大小，2026-09-22 df 顯示還剩 4.0G 時 uid 1000 已經全面 EDQUOT，
# 連 Claude Code Bash tool 的輸出檔都建不起來。有效剩餘 = min(df, 配額剩餘)，由
# vendor/scripts/tmp-capacity.ts --brief 算（quotactl_fd，不靠 quota 指令）；它不在或跑不動
# 就退回 df（fail-open）。tmp-capacity.ts 不投影到 consumer（不在 scripts/lib/vendor-targets.ts），
# 所以 project 內沒有時改用 clade home 那份——配額是整台機器 per-uid 共用的，只有 clade home
# 的 session 看得到等於大多數 session 對它盲。內層 timeout（3s）刻意短於 hooks.json 的 5s，
# 慢啟動時 df 退路才來得及跑。
#
# 門檻刻意高於 publish preflight 的 FAIL 線（/ 15G、/tmp 5G）：告警要先於擋路——
# 0-A.1 前 /tmp 預設 3G 曾低於 preflight 的 5G，3–5G 窗口靜默，與「先於擋路」矛盾。
# 只偵測、不清理：/ 的回收由 ~/offline/clade/ops/disk-hygiene.sh（user timer）負責，
# /tmp 的回收由 vendor/scripts/cleanup-stale-tmp.ts（user timer）負責。
# 讀不到 / 解析不了一律靜默（fail-open）：SessionStart 噪音的成本高於漏報一次，
# 而 publish preflight 那一格是 fail-closed 的，兩層不共用失敗方向。
#
# 可覆寫：CLADE_DISK_WARN_ROOT_GB（預設 25）、CLADE_DISK_WARN_TMP_GB（預設 8）、
#         CLADE_DISK_DF（預設 df，測試換 stub）、CLADE_DISK_TMP_CAPACITY（預設
#         $CLAUDE_PROJECT_DIR/vendor/scripts/tmp-capacity.ts，不在則
#         $HOME/offline/clade/vendor/scripts/tmp-capacity.ts；設成空字串就只看 df）

set -uo pipefail
cat > /dev/null

ROOT_GB=${CLADE_DISK_WARN_ROOT_GB:-25}
TMP_GB=${CLADE_DISK_WARN_TMP_GB:-8}
DF=${CLADE_DISK_DF:-df}
if [ -n "${CLADE_DISK_TMP_CAPACITY+set}" ]; then
  TMP_CAPACITY=$CLADE_DISK_TMP_CAPACITY
else
  TMP_CAPACITY="${CLAUDE_PROJECT_DIR:-.}/vendor/scripts/tmp-capacity.ts"
  [ -f "$TMP_CAPACITY" ] || TMP_CAPACITY="$HOME/offline/clade/vendor/scripts/tmp-capacity.ts"
fi

free_gb() {  # $1=mount → 整數 GB；失敗印空
  local kb
  kb=$($DF -Pk "$1" 2>/dev/null | awk 'NR==2 { print $4 }')
  [[ "$kb" =~ ^[0-9]+$ ]] && echo $((kb / 1024 / 1024))
}

# /tmp 的有效剩餘：印 "<GB> <fs|quota>"；tmp-capacity 不可用時印空（呼叫端退回 df）
tmp_effective() {
  [ -n "$TMP_CAPACITY" ] && [ -f "$TMP_CAPACITY" ] && command -v node >/dev/null 2>&1 || return 0
  local out
  out=$(timeout 3 node "$TMP_CAPACITY" /tmp --brief 2>/dev/null) || return 0
  [[ "$out" =~ ^[0-9]+\ (fs|quota)$ ]] && echo "$out"
}

hint='回收純快取（NEVER docker system/volume prune -a）'
[ -f "$HOME/offline/clade/ops/disk-hygiene.sh" ] \
  && hint='回收：bash ~/offline/clade/ops/disk-hygiene.sh run --dry-run 看清單後去掉 --dry-run'

low=""; quota_hint=""
g=$(free_gb /);    [ -n "$g" ] && [ "$g" -lt "$ROOT_GB" ] && low="/ 剩 ${g}G<${ROOT_GB}G"
root_low=$low

eff=$(tmp_effective)
if [ -n "$eff" ]; then
  g=${eff%% *}; bound=${eff##* }
  if [ "$g" -lt "$TMP_GB" ]; then
    if [ "$bound" = quota ]; then
      low="${low:+$low、}/tmp 剩 ${g}G<${TMP_GB}G（per-user 配額，df 看不到）"
      quota_hint='回收：node ~/offline/clade/vendor/scripts/cleanup-stale-tmp.ts --apply；看大戶 node ~/offline/clade/vendor/scripts/tmp-capacity.ts /tmp'
    else
      low="${low:+$low、}/tmp 剩 ${g}G<${TMP_GB}G"
    fi
  fi
else
  g=$(free_gb /tmp); [ -n "$g" ] && [ "$g" -lt "$TMP_GB" ] && low="${low:+$low、}/tmp 剩 ${g}G<${TMP_GB}G"
fi

# 配額 hint 只管 /tmp；/ 也低時兩條都要給，NEVER 用一條蓋掉另一條
if [ -n "$quota_hint" ]; then
  if [ -n "$root_low" ]; then hint="/：${hint}；/tmp ${quota_hint}"; else hint=$quota_hint; fi
fi

[ -n "$low" ] && echo "⚠️ 磁碟低水位：${low}——長任務（publish gate／測試）會中途失敗。${hint}"
exit 0
