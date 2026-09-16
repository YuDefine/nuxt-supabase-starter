---
description: Self-hosted GitHub Actions runner 的標籤設計、job 路由契約與職責分工
paths: ['.github/workflows/**', 'registry/consumers.json']
---
<!-- Clade native rule; source: rules/core/self-hosted-runner.md; edit canonical source -->
<!-- clade-targets: claude,codex,cursor -->

# Self-Hosted Runner 標籤設計與職責分工

**核心命題**：`runs-on` 是**標籤集合的交集查詢**，不是指定機器。任何同時具備該組標籤的 runner 都有資格接手，**誰空著誰接**。因此「哪台機器會執行這個 job」不是由 workflow 決定的，是由**標籤設計**決定的——標籤設計錯了，job 落在哪台是擲骰子，而且**多數時候會抽中對的那台**，於是問題以「偶發 CI 紅燈」的形式間歇出現，每次都被當成環境抖動。

> 本規約與 [[cloudflare-workers]] § 7 互補：該節講 self-hosted runner 的 **CI step 寫法**（cache / secrets），本檔講 **runner 本身的標籤設計與 job 路由**，以及 § 11 的 **deploy 私鑰在 runner 上的生命週期**。

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
| 需要金鑰或憑證檔 | `$RUNNER_TEMP/<deploy-key>`（由 secret 於 job 內寫入，見 § 11）/ kubeconfig |
| 需要特定 CPU 架構 | 原生模組（`better-sqlite3` / `sharp`）的 build 產物要在 X64 目標主機起得來；`docker exec` 進只在 X64 主機的容器 → 釘 `X64`。同一個 `gh-runner-lxc` / `ci-build` / `supabase` 標籤同時掛在 ARM64 容器池上（<consumer-i> 2026-09 實證，`deploy-production.yml` 兩個 job 各釘一次） |
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
| **部署** | rsync/scp 產物、切 symlink、重啟服務 | `deploy-<target>` | 目標網段、rsync；部署金鑰由 job 從 GitHub Secrets 帶入（§ 11），**NEVER** 常駐 `$HOME` | 通用建置標籤 |

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

### 6. Action 版本釘選要考慮 runner 的 persistence

Persistent runner（LXC / VM，跨 job 保留檔案系統）與 GitHub-hosted runner（每次全新容器）對「會自我更新的 action」反應不同：GitHub-hosted 上自我更新的副作用隨容器一起消失，persistent runner 上會留下來污染下一個 job。

- **MUST** `pnpm/action-setup` 在 self-hosted runner 釘 **v5**。v6 會自我更新 pnpm，在 persistent runner 上把既有安裝改壞。實證：<consumer-j> `5213e8f` 與 co-purchase 同日各自從 v6 回退 v5
- **MUST** 升任何「會在 runner 上安裝/更新工具」的 action 大版之前，先問「這個 action 有沒有自我更新行為？persistent runner 上它留下什麼？」——GitHub-hosted 綠燈**不是** self-hosted 也會綠的證據
- 範本與完整 CI workflow 見 `vendor/snippets/cloudflare-workers/self-hosted-runner-ci.workflow.yml.template`

### 7. 同一台機器上的 runner 共享 home，NEVER 在 job 執行中動共用目錄

多個 ephemeral runner 跑在同一台機器、同一個 user 底下時，`~/setup-pnpm/`、`~/.pnpm-store/`、`~/.cache/` 都是**共享可變狀態**。對它們做 `rm -rf` / 搬移 / 重寫，會直接抽掉其他 runner 正在使用的檔案。

- **NEVER** 在 job 執行期間清理共用目錄。清理只能放在 wrapper 裡、`./run.sh` **之前**（該 runner 的 job 尚未開始），而且要意識到那仍然影響**其他** runner 正在跑的 job
- **MUST** 需要「乾淨環境」時改用 per-runner 的獨立路徑（`~/<repo>-runner/...`），而不是清共用的
- **NEVER** 把「清一下 stale state 應該沒差」當成安全操作

實證（2026-07-28）：為了清 pnpm 的 stale global store，在四個 runner 的 wrapper 各加了一行 `rm -rf ~/setup-pnpm/node_modules`。四個 runner 共用同一個 `~/setup-pnpm/`，propagate 觸發全 fleet 同時跑 workflow 時，A 的 wrapper 清掉目錄、B 正在用的 pnpm 就消失 —— 症狀是 `sh: 1: pnpm: not found`，發生在**巢狀 npm script** 裡（外層還跑得動，內層 `sh -c` 才炸），且時好時壞。原本已經修好的 repo 因此整批回紅。

### 8. Runner auto-update 會破壞 node externals 的 symlink

Actions runner 自我升級時解壓 `externals.*/node*/`，會把 `bin/npm`、`bin/npx`、`bin/corepack` 從 symlink 變成一般檔案（tar 解壓不保留 symlink）。內容一模一樣，但相對路徑解析基準變了：`npm-cli.js` 裡的 `require('../lib/cli.js')` 原本從 `lib/node_modules/npm/bin/` 解析，變成從 `bin/` 解析 —— 於是

```
Error: Cannot find module '../lib/cli.js'
Require stack:
- /home/runner/<repo>-runner/externals.<ver>/node24/bin/npm
```

runner 內建的 npm 就此壞掉，任何**經由它**安裝工具的 action 一起壞。

- **MUST** persistent runner 的 baseline setup 內含 symlink 修復機制（修復腳本 + 定時器 + wrapper 在 `./run.sh` 前呼叫），因為 auto-update 隨時會再發生一次，一次性手修撐不過下次升級
- **MUST** 新增 runner 時把該機制一併裝上，不要只裝在撞到問題的那台
- 判準：runner 內建 npm 是否可用，用 `<runner>/externals.*/node*/bin/npm --version` 直接驗，**不要**靠「workflow 這次過了」推斷 —— 只有走 npm 路徑的 workflow 才會暴露它

### 9. GitHub-hosted 的「跳過下載」建議 NEVER 直接套到 self-hosted

GitHub-hosted runner 每個 job 都是全新容器，所以官方與工具鏈的效能提示預設是「用 runner 預裝的瀏覽器」「用 `actions/cache` 存下載物」。Persistent runner（LXC / VM，per § 6）的前提相反：`$HOME` 跨 job 存活，而 `playwright install`、pnpm store、`hostedtoolcache` 都是**版本目錄命中即 no-op**——第二次之後本來就不下載。把 GitHub-hosted 的建議照搬過來，等於為一個不存在的問題付出成本。

**MUST 先量再改。** 「安裝步驟看起來很慢」的印象不算證據，實際 step 耗時要從 API 取：

```bash
gh api repos/<owner>/<repo>/actions/runs/<run-id>/jobs \
  --jq '.jobs[] | .name as $j | .steps[] | "\($j) | \(.name) | \(.started_at) -> \(.completed_at)"'
```

量到數字之後按 predicate 決定，**每一個**有下載型安裝步驟的 job 各判一次，不是整個 repo 判一次：

| 可觀察 predicate | MUST |
| --- | --- |
| 安裝步驟實測 ≤ 10s | 什麼都不做——快取已在生效 |
| job 帶 `container:`（每 job 全新 rootfs） | 設 `PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright`，並把該路徑從 host mount 進 container |
| runner 每 job 重建檔案系統（K8s pod / 每次重灌的 VM） | 同上；或整個 job 改跑 `mcr.microsoft.com/playwright:v<x.y.z>-noble` image，該 tag **MUST** 逐版對齊 `package.json` 的 `@playwright/test`，否則 Playwright 判定版本不符會再下載一次 |
| 安裝步驟實測 > 30s 但 runner 是 persistent | 先查**快取為何沒命中**（換過 service user、清過 `~/.cache`、Playwright 剛升版），修那個原因 |

- **MUST** 只裝實際會跑的 browser（`npx playwright install chromium`），**NEVER** 裸 `npx playwright install`——三套的首次下載量與耗時都是單套的約三倍，而 CI 通常只跑一個 project
- **NEVER** 為了跳過下載改用 `channel: 'chrome'` / `'msedge'`：自架機沒有預裝瀏覽器，這只是把「命中本機快取」換成「每次現裝系統套件」，且測試用的瀏覽器版本不再跟 Playwright 綁定
- **NEVER** 用 `actions/cache` 存瀏覽器 binary：self-hosted 的 cache 走網路往返，比本機命中慢；persistent runner 上它要保護的東西本來就沒丟
- **NEVER** 為了「乾淨」在 job 裡清 `~/.cache/ms-playwright`——那是共享可變狀態，per § 7

Fleet 實測（2026-07-31 快照，重量方式見上方指令）：<consumer-a> 2s、<consumer-b> 8s（含 `--with-deps`）、<consumer-d> 1s，三者皆 persistent runner 且**未**做任何快取設定；同期 GitHub-hosted 的 <consumer-c> 為 20s。

本證據決定：persistent self-hosted runner 上要不要替下載型工具加一層快取機制——不要加。
本證據不決定：GitHub-hosted runner 上要不要優化——**NEVER** 拿這組數字論證 `ubuntu-latest` 的 job 也不必量、不必改。

### 10. 信任分層：untrusted-execution job NEVER 落在 production-access runner

`runs-on` 決定的不只是「哪台有工具」，還有「哪台會被這段程式碼碰到」。**每一個** job 都要各判一次，判準是 job 做什麼，**不是**誰觸發它——PR、push main、`workflow_run` 一視同仁。

一個 job 命中下列任一，就是 **untrusted-execution job**：

| 可觀察條件 | 例子 |
| --- | --- |
| 安裝依賴 | `vp install` / `pnpm install` / `npm ci` / `npx playwright install` |
| 執行 repo 的應用或測試程式碼 | `vp run test*` / `vp run dev` / cucumber / Playwright |
| 執行 PR 可改寫的 local action | `uses: ./.github/actions/<name>` |

一台 runner 命中下列任一，就是 **production-access runner**：docker socket 能 `docker exec` 進 production 容器、持有 deploy key、能直連 production 網段、`~/.ssh` / `~/.kube` 內有 production 憑證。

- **MUST** untrusted-execution job 的 `runs-on` 只落在 GitHub-hosted（`ubuntu-latest`），或**不具 production 存取**的 self-hosted runner（能力標籤，例如 `supabase-ci`）
- **MUST** production-access runner 只接同時滿足兩條的 job：觸發受限（tag，或 `workflow_dispatch` 加 ref guard；**NEVER** 是 `pull_request` / `pull_request_target` / push branch）、只執行 repo 內的腳本而不安裝依賴（migrate、deploy）
- **MUST** 在 untrusted-execution job 的 `runs-on` 上方留註解，指明它**為什麼不能**用 prod 主機的標籤——77ada28 正是把沒有這行註解的 `ubuntu-latest` 改成了 self-hosted
- **NEVER** 讓位置標籤兼作能力標籤（per § 3）：`supabase` 在 <client-b> fleet 的意思是「production supabase-db 所在主機」，不是「有 docker、可起拋棄式 stack」。沒有不具 production 存取的能力標籤時，job 先用 `ubuntu-latest`，**NEVER** 借 prod 主機的標籤
- **NEVER** 拿 `paths:` 過濾、private repo、org 成員限定當作緩解——下表逐條說明

| 開脫（出處） | 現實 |
| --- | --- |
| 「`supabase-check`（pull_request，限定 paths）」（<consumer-i> `tasks/2026-09-16-runner-isolation-followup.md`，把 paths 當成範圍已受控） | `pull_request` 跑的是 PR merge commit（`GITHUB_SHA`，含 PR 的改動）上的 workflow 檔，`paths:` 與 workflow 內容都是 PR 可改的；而且 paths 命中的那一次，程式碼照樣在 prod 主機上跑 |
| 「PR job 經 Docker 可觸及 supabase-runner 上的 production supabase-db … 依 decision … 接受」（<consumer-i> 77ada28 commit message） | 接受時評估的是「誰能開 PR」。風險不在人：`vp install` 之後整個 app 與全部 transitive deps 的 runtime code 都在那台跑，push main 時同樣發生。org 成員限定縮小的是人，不是供應鏈 |
| 「省 minutes」（77ada28 把 `ubuntu-latest` 搬上 self-hosted 的理由） | 先量觸發頻率再談成本，下方指令 |

量觸發頻率（逐 repo 跑，數字是全歷史 PR 數）：

```bash
gh api "repos/<owner>/<repo>/pulls?state=all&per_page=100" --paginate --jq '.[].number' | wc -l
```

2026-09-16 快照（<client-b>，Free plan、`allow_forking=false`）：<consumer-i> 0、<consumer-e> 1、<consumer-b> 25。

本證據決定：untrusted-execution job 從 prod 主機搬回 GitHub-hosted 時，要不要擔心 minutes——先量，量到近零就不用。
本證據不決定：production-access runner 上要不要跑 untrusted-execution job——**NEVER** 拿「量到的頻率很高、minutes 不夠」論證搬回 prod 主機；不夠時改觸發方式（例如 `workflow_run`）或另建不具 production 存取的 runner。

實證（2026-09-16 <consumer-i> 77ada28 review）：bdd 與 supabase-check 從 `ubuntu-latest` 搬到 `[self-hosted, supabase]`，而 `supabase` 標籤唯一的 X64 runner 就是承載 <consumer-b> / <consumer-e> / <consumer-i> 共用 production Postgres 的主機，同一台的 `migrate-prod.sh` 以 `docker exec -i supabase-db psql` 寫 production。同一時間 <consumer-b> 與 <consumer-e> 的 `supabase-check` 已在 main 上以同一組標籤跑 PR。

機械偵測（warn-only，**每一個** consumer 都掃，不是只掃出事的那台）：

```bash
node $CLADE_HOME/scripts/audit-runner-trust-boundary.ts                  # fleet
node $CLADE_HOME/scripts/audit-runner-trust-boundary.ts --repo <path>    # 單一 repo
```

prod 主機標籤預設 `supabase`；別的 fleet 用不同標籤時，在該 repo `.clade/manifest.json` 宣告 `runners.prodHostLabels`，或跑時帶 `--prod-label <label>`。

### 11. Deploy 私鑰只活在 job 內：寫進 `$RUNNER_TEMP`，`always()` 收尾刪除

**適用 predicate**：job 的 `runs-on` 會落到「runner user 的 `$HOME` 跨 job 存活」的機器——persistent LXC / VM，
或 GitHub 語意上 ephemeral 但同一個 `$HOME` 反覆 `./run.sh` 的 runner（YuDefine CT 102 就是這種）。
**NEVER 用「self-hosted」或「ephemeral」標籤判**——判準是 `$HOME` 存不存活。每 job 全新容器的 runner
（Zenbook ARM64 Docker 池）與 GitHub-hosted 都不在本條射程。

**威脅**：`~/.ssh/<key>` 在 persistent runner 上跨 job 殘留；之後**任何** job（同 repo 的 PR CI、第三方套件的
`postinstall`、供應鏈路徑）跑在同一個 runner user 底下都讀得到它，而 § 7 已說明同一台機器上的多個 runner 槽
**共用同一個 `$HOME`**。runner group 已 `allows_public_repositories=false`，所以射程是 private repo 內的其他
job 與供應鏈，不是 fork PR。

保管處是 GitHub Secrets（[[secret-custody]] 管「值到手時怎麼存」）；本節管**從 Secrets 取出之後在 runner 上的生命週期**。

- **MUST** 私鑰寫進 `$RUNNER_TEMP`，用 `install -m 600 /dev/null <path>` 先建 600 的空檔再 `printf` 進去
  （避免 umask 造成的可讀窗口）
- **MUST** 最後一個 step `if: always()` 刪掉它。GitHub 文件（`docs.github.com/en/actions/reference/workflows-and-actions/variables`，
  2026-09-17 查）對 `RUNNER_TEMP` 的描述逐字是「emptied at the beginning and end of each job. Note that files will not be
  removed if the runner's user account does not have permission to delete them」——job 被 kill 時「結束時清空」不會跑，
  下一個 job 開始前才有第二次。`always()` 刪除是規約，`RUNNER_TEMP` 自動清空是兜底，**兩個都要**
- **MUST** `ssh` / `scp` / `rsync -e ssh` 一律帶 `-o BatchMode=yes -o StrictHostKeyChecking=yes`，host key 用
  `ssh-keyscan -H <host> >> ~/.ssh/known_hosts` 事先釘。`known_hosts` 是唯一允許寫進 `~/.ssh` 的東西——它不是 secret
- **NEVER** `echo "$KEY" > ~/.ssh/<name>`、`cat > ~/.ssh/config`、或任何把 secret 寫進 `$HOME` 的形式。
  「我有 `always()` 刪」不豁免：刪除步驟只保護 job 正常結束的路徑，`$HOME` 內的檔在 runner 被 kill、job timeout、
  或 `rm` 那一步本身失敗時照樣留下；`$RUNNER_TEMP` 在下一個 job 開始前還有一次清空，`$HOME` 沒有
- **NEVER** `StrictHostKeyChecking no` / `UserKnownHostsFile /dev/null`——那把 deploy 私鑰交給任何能回應那個 IP 的機器
- **NEVER** 用 `ssh-agent` 當「不落盤」的替代並就此不清：agent socket 同樣是同 uid 可達，且 agent 行程會活過 job

REQUIRED 的兩個 step（deploy 本體夾中間）：

```yaml
      - name: Materialize deploy key (job-scoped)
        env:
          DEPLOY_KEY: ${{ secrets.<REPO>_DEPLOY_KEY }}
        # 私鑰 NEVER 寫進 ~/.ssh：runner 的 $HOME 跨 job 存活（§ 7），落盤不刪等於留給下一個 job。
        # $RUNNER_TEMP 每個 job 起訖清空，末尾再 always() 刪。
        run: |
          install -m 600 /dev/null "$RUNNER_TEMP/deploy_key"
          printf '%s\n' "$DEPLOY_KEY" > "$RUNNER_TEMP/deploy_key"
          mkdir -p ~/.ssh && chmod 700 ~/.ssh
          ssh-keyscan -H "${{ vars.<REPO>_DEPLOY_HOST }}" >> ~/.ssh/known_hosts 2>/dev/null || true

      # ... rsync / ssh 步驟，每一個都帶：
      #   -i "$RUNNER_TEMP/deploy_key" -o BatchMode=yes -o StrictHostKeyChecking=yes

      - name: Remove deploy key
        if: always()
        run: rm -f "$RUNNER_TEMP/deploy_key"
```

先例：`~/offline/<consumer-i>/.github/workflows/deploy-production.yml`（建與刪兩段齊全）、
`~/offline/<consumer-e>/.github/workflows/deploy.yml`（`SSH_OPTIONS` 陣列寫法值得抄；2026-09-17 audit 顯示**缺** `always()` 刪除步驟）。
可貼範本與 `~/.ssh` 形狀的遷移對照在 `vendor/snippets/deploy-key-custody/README.md`。

機械偵測：`node scripts/audit-ci-workflow-safety.ts --all-consumers`（warn-only；對「寫入 `~/.ssh/` 且 basename 非
`known_hosts`」、「`$RUNNER_TEMP` 私鑰無 `always()` 刪除」、「`StrictHostKeyChecking no`」三種形狀出訊號）。
variant 判定進 `registry/conventions.json` 的 `deploy-key-custody`，由 `convention-conformance-audit --live` 消費。

本證據決定：私鑰在 persistent runner 上該落在哪、活多久。
本證據不決定：同一台機器上**並行**的另一個 runner 槽（同 uid、同 `$HOME`）在 job 進行中能不能讀到 `$RUNNER_TEMP`——能。
`$RUNNER_TEMP` 縮的是**時間窗**（job 存續期間）不是 uid 邊界；要封那一格是 per-runner 獨立 user 或 deploy 專用單槽機
（§ 4「部署 runner NEVER 掛通用建置標籤」正是這個方向），**NEVER** 拿本節論證「已經隔離了」。

### 12. Runner 主機憑證衛生：runner user 碰得到的一切，都等於交給每一個 job

**適用 predicate**：任何 self-hosted runner 主機——和 § 11 一樣，判準是 runner user 的 `$HOME` 跨 job 存活，不看標籤。
§ 10 管「哪種 job 可以落在這台」，§ 11 管 CI 自己帶進來的 deploy 私鑰；本節管**主機上本來就在的東西**：人登入時留下的、
維運時放上去的。只要 job 以 runner user 身分執行，這些東西的讀取權就等同交給每一個 job 的 transitive deps。

- **NEVER** 讓 runner user 的 `$HOME` 留著個人長效憑證：`~/.config/gh/hosts.yml`（`gh auth login`）、`~/.git-credentials`、
  `~/.docker/config.json` 內的 registry token、`~/.npmrc` 的 `_authToken`。在 runner 主機上用過 `gh` / `git push` 之後
  **MUST** `gh auth logout` 並刪掉這些檔——個人 token 的 scope 通常涵蓋你所有的 org，爆炸半徑遠大於這台主機
- **NEVER** 在 runner 主機存放「讓別台機器登入」的私鑰（`~/.ssh/<name>`，`known_hosts` 除外）。要從這台主機連出去的
  長效需求，改成專用 user 或放在目標端的 forced-command key；CI 取用的 deploy key 走 § 11
- **MUST** systemd unit 需要的 token 放進 `EnvironmentFile=` 指向的 root 擁有、`0600` 檔。unit 檔本身 world-readable，
  寫在 `ExecStart`（例：`cloudflared tunnel run --token <T>`）的值 `systemctl cat` 任何 user 都讀得到
- **MUST** production-access runner（§ 10 定義）的 runner user 的 sudoers 收斂成 deploy 實際呼叫的腳本清單，不是 `NOPASSWD: ALL`。
  `docker` group 本身已等同 root，所以這台主機接的 job 清單同時 **MUST** 維持 § 10 的收斂
- **MUST** 在以上任何一項被發現「已暴露過」時輪替該憑證，並照 [[secret-custody]] 把新值存回保管處（Notion secrets 頁的對應列等）。
  只刪檔不輪替 = 假設過去沒有 job 讀過它，這個假設沒有證據能支持

| 開脫 | 現實 |
| --- | --- |
| 「那台是我自己的機器，token 是我登入時留的，不是 CI 的」 | 排程不管 token 是誰留的。job 用的是同一個 uid，`cat ~/.config/gh/hosts.yml` 不需要任何權限提升 |
| 「沒有入侵證據」 | 2026-09 <client-b> 事件實查：sudo 紀錄、持久化、outbound 全乾淨，但**走 docker socket 的動作沒有任何日誌**。沒證據是查不到的上限，不是安全的下限 |
| 「job 已經取消了，程式碼沒跑」 | `cancelled` 只代表最終狀態。取消前已完成的 step（`vp install` 的 install script）照樣跑過；重跑的 attempt 2 也可能在「已取消」的 run 底下重新起跑。以下方 SOP 查 step 級證據 |

實證（2026-09-16 <client-b> `supabase-runner`，承載 production supabase-db 的 VM）：runner user 在 `docker` group 且 `NOPASSWD: ALL`，
可讀 `/opt/supabase/.env`；home 內留有 Charles 的 `gh` OAuth token（`repo`+`workflow`，8 個 org，含 YuDefine/clade admin，現役）、
一把 CI 寫入未清的 deploy 私鑰、runner `.credentials`；cloudflared tunnel token 在 unit 的 `ExecStart`。<consumer-b> e2e 在該主機跑了
318 次（2026-03-12 → 09-14）。事故證據與後續在 `specs/plans/W-2026-09-16-runner-trust-boundary-midterm/plan.md` § Evidence，
盤點全文 `~/offline/<consumer-i>/tasks/2026-09-17-runner-trust-prod-host-exposure-report.md`。

機械偵測：repo 端的 workflow 形狀由 `audit-runner-trust-boundary.ts`（§ 10）與 `audit-ci-workflow-safety.ts`（§ 11）涵蓋；
**主機端沒有自動 gate**，只能用下方 SOP 逐台唯讀盤點，這一段是純參考。

本證據決定：runner 主機上哪些東西必須移走、暴露過的要輪替。
本證據不決定：暴露過的 production secret（JWT secret、DB 密碼）要不要在維護窗口前就輪替——那是 Charles 依證據與停機成本拍板的 incident 決策。

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

### 暴露盤點：某台 runner 上到底跑過什麼

§ 10 / § 12 的違規被發現後，**MUST** 用 step 級證據盤點，**NEVER** 用 run 的 `conclusion` 推論「沒跑」：

```bash
# 1. 所有曾落在該 runner 的 job（逐 run 查；filter=all 才含舊 attempt）
gh api "repos/<owner>/<repo>/actions/runs?per_page=100&created=>=<起始日>" --paginate --jq '.workflow_runs[].id' |
  xargs -P8 -I{} gh api "repos/<owner>/<repo>/actions/runs/{}/jobs?filter=all&per_page=100" \
    --jq '.jobs[]|select(.runner_name=="<runner>")|[.run_id,.run_attempt,.name,.conclusion,.started_at]|@tsv'

# 2. 每個 job 實際跑到哪個 step（cancelled 的 job 前面的 step 可能已 success）
gh api "repos/<owner>/<repo>/actions/runs/<id>/jobs?filter=all" \
  --jq '.jobs[]|select(.runner_name=="<runner>")|[.steps[]|"\(.name)=\(.conclusion)"]'

# 3. 主機端交叉比對（runner 自己的紀錄，不受 GitHub 端狀態延遲影響）
grep -E "Running job|completed with result" ~/actions-runner/_diag/Runner_*.log | tail -30
pgrep -fa Runner.Worker    # 有輸出 = 此刻正在跑 job

# 4. 主機唯讀曝險面（§ 12 清單）
id; sudo -n true && echo NOPASSWD
ls -la ~/.config/gh/hosts.yml ~/.git-credentials ~/.npmrc ~/.docker/config.json ~/.ssh 2>&1
systemctl cat '*' 2>/dev/null | grep -nE -- '--token|TOKEN=' | sed -E 's/(token[= ])[^ ]+/\1<redacted>/I'
```

2026-09-16 實例：一個 brief 記為「已取消」的 run，attempt 2 由人重跑後正在該主機上執行 `vp install`；只有步驟 1 的 `filter=all` 加上步驟 3 的 `pgrep` 抓得到。

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
