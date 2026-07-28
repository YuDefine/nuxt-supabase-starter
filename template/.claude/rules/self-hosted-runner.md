---
description: Self-hosted GitHub Actions runner 的標籤設計、job 路由契約與職責分工
paths: ['.github/workflows/**', 'registry/consumers.json']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/self-hosted-runner.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


# Self-Hosted Runner 標籤設計與職責分工

**核心命題**：`runs-on` 是**標籤集合的交集查詢**，不是指定機器。任何同時具備該組標籤的 runner 都有資格接手，**誰空著誰接**。因此「哪台機器會執行這個 job」不是由 workflow 決定的，是由**標籤設計**決定的——標籤設計錯了，job 落在哪台是擲骰子，而且**多數時候會抽中對的那台**，於是問題以「偶發 CI 紅燈」的形式間歇出現，每次都被當成環境抖動。

> 本規約與 [[cloudflare-workers]] § 7 互補：該節講 self-hosted runner 的 **CI step 寫法**（cache / secrets），本檔講 **runner 本身的標籤設計與 job 路由**。

## 為什麼這條規約存在

2026-07-28 <consumer-b> 實證：deploy job 寫 `runs-on: [self-hosted, linux, ci-build]`，而 `ci-build` 這個標籤同時掛在兩台 runner 上：

```
gh-runner-<consumer-b>  labels=self-hosted,Linux,X64,ci-build,gh-runner-lxc   ← 有 rsync、有部署金鑰
supabase-runner labels=self-hosted,Linux,X64,supabase,ci-build        ← Supabase 主機，兩者皆無
```

同一天內：14:05 的 deploy 抽中對的 runner → 成功；16:50 的 deploy 抽中 Supabase runner → `rsync: command not found`，exit 127，production 沒更新。**同一份 workflow、同一個 commit 形狀、相反的結果。**

根因不在「那台沒裝 rsync」——一台 Supabase 專用機本來就不需要 rsync。根因是**它對外宣告了自己不具備的能力**。

## MUST

### 1. 標籤只宣告該 runner 真正具備的能力

- **MUST** 每個 custom 標籤對應一個**可驗證的能力或位置**（裝了什麼工具、能連到哪個網段、持有哪把金鑰、跑在哪台主機）
- **MUST** 新增標籤前逐條問：「掛這個標籤之後會落過來的 job，這台**全部**做得到嗎？」做不到就不要掛
- **NEVER** 為了「增加併發容量」把通用建置標籤掛到專用機上——容量換來的是非決定性失敗
- **NEVER** 假設「反正排程通常會挑對」——排程不保證任何順序，只保證資格

### 2. 有主機硬需求的 job MUST 釘到只有合格 runner 才有的標籤

判斷「有主機硬需求」的可觀察條件，命中任一即是：

| 條件 | 例子 |
| --- | --- |
| 需要特定 CLI | `rsync` / `docker` / `psql` / `wrangler` |
| 需要金鑰或憑證檔 | `~/.ssh/<deploy-key>` / kubeconfig |
| 需要特定網段可達 | 內網 LAN IP、Tailscale、VPN-only 主機 |
| 需要本機服務 | `systemctl is-active <svc>` / `curl 127.0.0.1:<port>` / 本機 Docker socket |

- **MUST** 這類 job 的 `runs-on` 帶一個**只有合格 runner 具備**的標籤
- **MUST** 在該 job 的 `runs-on` 上方註解寫明**為什麼**要釘（需要什麼），讓後人知道這不是隨手寫的

### 3. 標籤語意分兩層：能力標籤 vs 位置標籤

- **能力標籤**（`ci-build` / `docker` / `gpu`）：描述「能做什麼」，可以多台共享
- **位置標籤**（`gh-runner-lxc` / `supabase` / `prod-host`）：描述「在哪裡」，通常唯一

- **SHOULD** 優先用**能力標籤**表達需求（`deploy-ct211` 比 `gh-runner-lxc` 更能表達意圖，換機器時不必改 workflow）
- 沒有現成能力標籤時可先用位置標籤釘住，但 **SHOULD** 在 TD 登記「改用能力標籤」

### 4. 職責分工（三類 runner）

自架 runner 的典型分工。**MUST** 讓每一類的標籤集合互不重疊於「有硬需求的能力」：

| 類別 | 職責 | 典型標籤 | 該有什麼 | **NEVER** 給它 |
| --- | --- | --- | --- | --- |
| **建置/測試** | lint、typecheck、test、build | `ci-build` | node/pnpm、足夠 RAM | 生產金鑰、生產網段可達性 |
| **基礎設施本機操作** | DB migration、本機服務健康檢查 | `supabase` / `db-host` | 本機 Docker / psql / systemctl | 通用建置標籤 |
| **部署** | rsync/scp 產物、切 symlink、重啟服務 | `deploy-<target>` | 部署金鑰、目標網段、rsync | 通用建置標籤 |

- **MUST** 部署類 runner 的標籤**不要**與建置類重疊——否則建置 job 會落到持有生產金鑰的機器上，是不必要的暴露面
- **MUST** 基礎設施類 runner **只**掛自己的位置標籤

### 5. 清理（housekeeping）NEVER 擋住部署

部署 step 內的清理動作（保留 N 個 release、刪舊 artifact）**MUST** 容錯：

```bash
# ❌ set -euo pipefail 下，清理失敗 → step fail → 後面的「重啟服務」被 skip
ls -1t | tail -n +6 | xargs -r rm -rf

# ✅ 清理失敗只警告
if ! ls -1t | tail -n +6 | xargs -r rm -rf; then
  echo "::warning::release 清理未完全成功，不影響本次部署"
fi
```

2026-07-28 <consumer-b> 實證：舊 release 目錄屬於早期部署機制的 service user，`deploy` user 刪不掉 → 清理 exit 123 → **檔案已 rsync 就位、symlink 已切換，但重啟 step 被 skip**，production 跑著舊 process 而 CI 顯示紅燈。這種「部署了一半」比乾脆失敗更難察覺。

- **MUST** 部署步驟的順序是「先讓新版本生效，再做清理」，或讓清理獨立成不影響結果的 step
- **MUST** 部署產物目錄的 ownership 一致（都屬部署 user）；換部署機制時 **MUST** 一併處理既有目錄的 ownership

## NEVER

- **NEVER** 用 runner 的**名字**判斷它會不會接某個 job——排程只看標籤，名字純粹給人看
- **NEVER** 在沒有列出所有 runner 標籤的情況下斷言「這個 job 會跑在哪台」
- **NEVER** 把「這次成功了」當成標籤設計正確的證據——非決定性選擇下，成功只代表這次抽中了

## 診斷 SOP

CI job 出現「同樣的 workflow 有時過有時不過」時，**第一件事**是查它實際落在哪台：

```bash
# 這次跑在哪台
gh api repos/<owner>/<repo>/actions/runs/<run-id>/jobs \
  --jq '.jobs[] | "\(.name) | \(.conclusion) | runner=\(.runner_name)"'

# 有哪些 runner、各自帶什麼標籤
gh api repos/<owner>/<repo>/actions/runners \
  --jq '.runners[] | "\(.id) \(.name) labels=\([.labels[]|select(.type=="custom")|.name]|join(","))"'

# 歷史分佈——同一個 job 曾落在哪幾台
for id in $(gh run list --workflow "<name>" --limit 10 --json databaseId --jq '.[].databaseId'); do
  gh api repos/<owner>/<repo>/actions/runs/$id/jobs \
    --jq '.jobs[] | select(.name=="<job>") | "\(.conclusion)@\(.runner_name)"'
done | sort | uniq -c
```

org-level runner 不會出現在 repo-level 清單（需 `admin:org` scope 才查得到），但**會**接 repo 的 job——所以 repo 清單為空**不代表**沒有 runner 可用，job 實際跑在哪台仍以 `runner_name` 為準。

### 移除標籤

```bash
gh api -X DELETE repos/<owner>/<repo>/actions/runners/<id>/labels/<label>
```

移除前 **MUST** 用上面的「歷史分佈」確認哪些 job 曾落在該台、移除後還有幾台可接。

## 修復的兩層

撞到這類問題時，**MUST** 兩層都做：

| 層 | 動作 | 保護範圍 |
| --- | --- | --- |
| workflow | 有硬需求的 job 釘唯一標籤 | 只保護那一個 job |
| runner 註冊 | 拔掉不該有的標籤 | **所有** 使用該標籤的 job |

只做第一層是治標——同一個標籤下的其他 job 仍然暴露在同樣的風險裡。
