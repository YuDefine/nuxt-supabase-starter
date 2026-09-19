#!/usr/bin/env bash
# SessionStart hook — 根分割區（與 /tmp）剩餘空間低於門檻時印一行，正常時完全靜默。
#
# 防的失敗類別：磁碟滿不會以「磁碟滿」出現。2026-09-16 實測 / 剩 1.9G 時，第一個症狀是
# clade publish unit-test gate 跑了 20 分鐘才以 preservation 容量檢查失敗；寫入 ENOSPC 也常
# 表現為 0 byte 檔與下游應用層錯誤。所以要在 session 開頭、任何長任務起跑之前出聲。
#
# 門檻刻意高於 publish preflight 的 FAIL 線（/ 15G、/tmp 5G）：告警要先於擋路——
# 0-A.1 前 /tmp 預設 3G 曾低於 preflight 的 5G，3–5G 窗口靜默，與「先於擋路」矛盾。
# 只偵測、不清理：回收由 ~/offline/clade/ops/disk-hygiene.sh（user timer）負責。
# 讀不到 / 解析不了一律靜默（fail-open）：SessionStart 噪音的成本高於漏報一次，
# 而 publish preflight 那一格是 fail-closed 的，兩層不共用失敗方向。
#
# 可覆寫：CLADE_DISK_WARN_ROOT_GB（預設 25）、CLADE_DISK_WARN_TMP_GB（預設 8）、
#         CLADE_DISK_DF（預設 df，測試換 stub）

set -uo pipefail
cat > /dev/null

ROOT_GB=${CLADE_DISK_WARN_ROOT_GB:-25}
TMP_GB=${CLADE_DISK_WARN_TMP_GB:-8}
DF=${CLADE_DISK_DF:-df}

free_gb() {  # $1=mount → 整數 GB；失敗印空
  local kb
  kb=$($DF -Pk "$1" 2>/dev/null | awk 'NR==2 { print $4 }')
  [[ "$kb" =~ ^[0-9]+$ ]] && echo $((kb / 1024 / 1024))
}

hint='回收純快取（NEVER docker system/volume prune -a）'
[ -f "$HOME/offline/clade/ops/disk-hygiene.sh" ] \
  && hint='回收：bash ~/offline/clade/ops/disk-hygiene.sh run --dry-run 看清單後去掉 --dry-run'

low=""
g=$(free_gb /);    [ -n "$g" ] && [ "$g" -lt "$ROOT_GB" ] && low="/ 剩 ${g}G<${ROOT_GB}G"
g=$(free_gb /tmp); [ -n "$g" ] && [ "$g" -lt "$TMP_GB" ] && low="${low:+$low、}/tmp 剩 ${g}G<${TMP_GB}G"

[ -n "$low" ] && echo "⚠️ 磁碟低水位：${low}——長任務（publish gate／測試）會中途失敗。${hint}"
exit 0
