---
name: screenshots-archive
description: '將已收錄到 docs/manual-review-archive.md 的 change，把對應截圖資料夾從 screenshots/<env>/<topic>/ 搬到 screenshots/<env>/_archive/YYYY-MM/<topic>/。讓 screenshots/<env>/ 頂層只剩 current pending review。觸發詞：歸檔截圖、sweep screenshots、清掉舊的截圖資料夾、screenshots archive。'
---

# 截圖歸檔（Screenshots Archive）

把已完成人工檢查的截圖資料夾從 `screenshots/<env>/<topic>/` 搬到 `screenshots/<env>/_archive/YYYY-MM/<topic>/`，讓 `ls screenshots/<env>/`（排除 `_archive/`）= 目前 pending review 清單。

## 觸發時機

- 「歸檔截圖」「sweep screenshots」「清掉舊的截圖資料夾」
- 「change X 的截圖歸檔」（指定）
- `/review-archive` 完成後**自動**呼叫（指定 change 模式）
- `/spectra-archive` 完成後**自動**呼叫（指定 change 模式）

## 輸入

- 指定 change：`/screenshots-archive change <change-name>` → 只搬該 change 對應的 topic（review-archive / spectra-archive 自動觸發走此模式）
- 指定 topic：`/screenshots-archive <topic-name>` → 直接搬該 topic（跳過對齊檢查，需 user 確認）
- 未指定：sweep 所有「在 `docs/manual-review-archive.md` 已收錄」且「`screenshots/<env>/<topic>/` 仍存在頂層」的 topic

## 流程

### Step 1: 列出候選 topic

掃所有 environment（不只 local）：

```bash
for env in local staging production; do
  [ -d "screenshots/$env" ] || continue
  for d in "screenshots/$env"/*/; do
    [ -d "$d" ] || continue
    name=$(basename "$d")
    [ "$name" = "_archive" ] && continue
    echo "$env|$name"
  done
done
```

### Step 2: 對齊 manual-review-archive

讀取 `docs/manual-review-archive.md`，抽出每個 `## YYYY-MM-DD — \`<change-name>\`` 標題的 change-name 集合。

#### Mode A — 未指定範圍（sweep all aligned）

對 Step 1 的候選：

- candidate.name ∈ archived_changes → **可 sweep**
- candidate.name ∉ archived_changes → **跳過**，記錄原因「未在 manual-review-archive 找到對應 change」

候選有跳過項目時，回報「N 個 topic 已對齊可 sweep / M 個 topic 未對齊跳過」，列出跳過清單，**不**追問是否強制。

#### Mode B — 指定 change（含 review-archive / spectra-archive 自動觸發）

`/screenshots-archive change <change-name>`：

1. 跨所有 environment 掃 `screenshots/<env>/<change-name>/` 是否存在
2. **找到對應 topic**：直接 sweep（信任 caller — review-archive / spectra-archive 已確認 change 結束；不再對齊 manual-review-archive，避免 spectra-archive 直 archive 路徑被擋）
3. **找不到對應 topic**（topic 名與 change 名不一致 / 已 sweep 過 / 從未拍）：
   - 列 `screenshots/<env>/` 頂層所有候選 topic（排除 `_archive/`）
   - 用 request_user_input 「找不到 `<change-name>` 對應 topic，候選列表：[topic-A, topic-B, ..., 跳過]」
   - user 選 topic → sweep 該 topic；選跳過 → noop 結束
   - 候選列表為空（頂層完全沒 topic）→ 直接 noop 回報「目前 `screenshots/<env>/` 已無 pending topic」

#### Mode C — 指定 topic

`/screenshots-archive <topic-name>` → 用 request_user_input 確認「該 topic 未在 manual-review-archive 對齊，仍要 sweep 嗎？」，**MUST** 等明確 yes 才執行。

### Step 3: 搬到 _archive/YYYY-MM/

```bash
year_month=$(date +%Y-%m)
for env_topic in <to-sweep>; do
  env=${env_topic%|*}
  topic=${env_topic#*|}
  src="screenshots/$env/$topic"
  dest_dir="screenshots/$env/_archive/$year_month"
  dest="$dest_dir/$topic"

  mkdir -p "$dest_dir"

  # 衝突避開（極少見：同 topic 同月已搬過）
  if [ -e "$dest" ]; then
    dest="$dest-$(date +%H%M%S)"
  fi

  # 優先 git mv 保留歷史；fallback mv
  if git ls-files --error-unmatch "$src" >/dev/null 2>&1; then
    git mv "$src" "$dest"
  else
    mv "$src" "$dest"
  fi
done
```

### Step 4: 回報

```
已歸檔 N 個 topic 到 _archive/YYYY-MM/：
  - local/change-A → local/_archive/2026-05/change-A
  - local/change-B → local/_archive/2026-05/change-B
  - staging/change-C → staging/_archive/2026-05/change-C

跳過 M 個（未對齊 docs/manual-review-archive.md）：
  - local/change-pending-X
  - local/change-pending-Y

目前 pending review（screenshots/<env>/ 頂層剩餘）：
  - local/change-pending-X
  - local/change-pending-Y
```

## Guardrails

- **NEVER** 刪除截圖檔案 — 只搬到 `_archive/`，可隨時翻回
- **NEVER** 在沒對齊 `docs/manual-review-archive.md` 的情況下 sweep 未指定範圍（Mode A）的 topic — Mode A 才靠對齊保護；Mode B（指定 change）信任 caller，Mode C（指定 topic）追問強制
- **NEVER** 搬 `screenshots/<env>/_archive/` 內已歸檔的東西（避免雙重歸檔）
- **ALWAYS** 用 `git mv` 保留歷史；非 git 控制檔案才 fallback `mv`
- **ALWAYS** 跨 environment 都掃（local / staging / production），不要只看 local
- **ALWAYS** 回報「目前 pending review」清單，方便 user 確認結果
- **ALWAYS** Mode B 找不到對應 topic 時用 request_user_input 列候選 + 跳過選項，**NEVER** 預設靜默跳過（會讓 user 不知道 sweep 沒生效）

## 為什麼有這個 skill

`screenshots/<env>/` 頂層長期堆積已完成 change 的資料夾，user 要找「目前要做人工檢查的是哪個」會被噪音淹沒。`/screenshots-archive` 跟 `/review-archive` 對齊：人工檢查項目歸檔 → 截圖資料夾也歸檔 → `ls screenshots/<env>/` 直接等於 pending 清單。
