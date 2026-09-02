<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/commit/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# 0-S Codex Security — 放行條件與額度配置

`gates.md` § 0-S 的延伸檔。**不在 always-load 清單**，觸發 0-S 且拿到非 `0` 的 exit 時才讀。

exit 與 `failure_class` 的對照表在 `gates.md` § 0-S〈Exit 分流〉，本檔不複述。

## 工具故障放行（僅 `tool-failure-no-artifacts` / `tool-timeout`）

工具故障率高時，把它當成對 code 的判決會封鎖**每一個** Tier 3 commit；但沒掃過就是沒掃過。
兩者都要成立，所以放行是**人的決定**，不是 agent 的判斷。

MUST 用 `AskUserQuestion` 二選一，**NEVER** 自行決定放行、**NEVER** 靜默通過：

- **`[1] 停下修工具`**（推薦）：釋放 commit-lock，回報 `failure_class` 與 `output_dir`，本批不 commit。
- **`[2] 授權未掃描落地`**：user 明確承擔風險。放行時 **MUST 同時**做到兩件事，缺一不可：
  1. `HANDOFF.md` 追加一條 `0-S UNSCANNED` 條目：日期、`failure_class`、`output_dir`，以及
     **本批命中 Tier 3 的每一個 path**
  2. 本批**每一個** commit 的 message 帶 trailer `Security-Scan: unscanned (<failure_class>)`

兩個記號的用意不同，所以缺一不可：HANDOFF 讓下一個 session 知道有一批未掃描的敏感變更待補，
commit trailer 讓 `git log` 事後查得出**是哪幾個 commit** 沒過掃描。

### 禁止項

- **NEVER** 把 `[2]` 讀成「掃過了」——Step 7 完成報告的 checks 欄位 MUST 寫
  `0-S 未執行（<failure_class>）`，**NEVER** 寫「0-S 通過」
- **NEVER** 把「使用者沒有回應」讀成 `[2]`
- **NEVER** 對 `coverage-incomplete` 用這條放行路徑——那次掃描**部分跑過**，
  結論是「不完整」而不是「沒發生」，一律停下重跑
- **NEVER** 因為「上次也是工具故障放行的」就省略這一輪的 `AskUserQuestion`

## `--max-cost` 怎麼給（2026-09-02 實測）

preflight 是 **repo 級 inventory**：成本正比於 repo 檔案總數，**與 `--path` 給幾個檔無關，
也不因 `--working-tree` 限縮成 diff 而變小**。實測進度行是
`preflight (working-tree changes) | Files: 0/6,042` —— 分母是整個 repo，不是那次要掃的變更。

所以 `--max-cost` 必須**先足以買下整個 repo 的 preflight**，之後才輪得到掃描目標的大小影響
成本。給不夠的後果不是「掃少一點」，而是**在 preflight 中途 abort、artifacts 一個都不寫**，
也就是 `tool-failure-no-artifacts`；`--headless` 下沒有互動式加預算，撞上限即 abort。

**NEVER** 用「這次只掃一個檔，$3 一定夠」推論額度——2026-09-01 掃單一 SQL 檔配 `--max-cost 3`
同樣死在 preflight。**repo 規模才是分母，掃描範圍不是。**

### 先量地板，再配額度

某個 repo 的 preflight 地板未知時，先跑一次**不設 `--max-cost`** 的 `hook` run 量它，再拿那個
數字當該 repo 所有 path scan 的下限：

```bash
node "$CLADE_ROOT/scripts/security-scan.ts" hook --target <repo> --timeout-sec 900 --max-cost <本次授權上限> --verbose
```

`hook` 不寫 ledger，但 wrapper 會把 scanner 的 stderr tee 到 `<output_dir>/scan.stderr.log`——
地板數字從那裡撈（`Files: N/M` 與 estimated cost 行）。量到之後把數字寫進該 repo 的
`SECURITY.md` § 核心資產與 secret 末尾一行 `<!-- preflight floor: $N (YYYY-MM-DD) -->`，
之後每一次 path / baseline 都用「地板 + 餘裕」。baseline 的 `--max-cost` 同樣依這個量測給，
**NEVER** 沿用別的 repo 的數字。

`--effort` 與 preflight 無關（inventory 不吃 reasoning），只影響掃描段：0-S 的 `path` 預設
`high`，`baseline` 留 `xhigh`。`--workflow-id <id>` 讓第二次 run 重用已完成的 workflow——
量地板之後緊接的 path scan 帶同一個 id，觀察 preflight 是否被重用。

## 憲法存在時掃描怎麼變

| target 狀態 | wrapper 行為 | ledger |
| --- | --- | --- |
| 有 `SECURITY.md` | 自動 `--knowledge-base <target>/SECURITY.md`；finding 對照憲法的不變量判反面證據 | `security_md_sha` = 當前憲法 sha256 |
| 沒有 | stderr 印 `target 無 SECURITY.md（安全憲法）` pointer，照掃、不擋 | `security_md_sha: null` |
| 憲法改了、baseline 沒重跑 | 掃描照跑 | `audit-security-policy.ts` 的 freshness 格報 violation |

ledger 落在 **target 自家** `docs/evidence/security-scan-ledger.jsonl`（`CLADE_SECURITY_SCAN_LEDGER` 覆寫），
row 內只有 repo-relative 資訊；0-S 跑完把它一起 stage。`diff --base <ref>` 補掃一批 commit、
`verify --finding <id>` 對修完的 finding 做唯讀複驗，兩者各寫一筆 `run_kind: diff` / `verify`。

### 診斷：掃描死在哪一階段

`failure_class` 說得出「有沒有產出」，說不出「死在哪」。後者查 Codex 的 state DB
（`$CODEX_SECURITY_STATE_DIR/workbench.sqlite3`，wrapper 會把它指到 clade 私有目錄）：

```bash
sqlite3 "$DB" "select id,status,phase,started_at,seal_manifest_digest is null from scans order by rowid desc limit 10;"
```

`phase` 停在 `preflight` 且 `seal_manifest_digest` 為 NULL、`findings` 0 rows
= 掃描從未進到實際 review，付掉的錢全花在 inventory。這對應上游
[openai/codex-security#73](https://github.com/openai/codex-security/issues/73)
（seal step 失敗、output dir 全空，最小重現是單一 1 行檔案的新 repo）與
[#25](https://github.com/openai/codex-security/issues/25)（預算被 setup 吃光）。

`--auth chatgpt` 下額度耗盡會直接印 `You've hit your usage limit`，那與上述缺陷是兩回事——
前者換時間就能重跑，後者換多少額度都一樣。**NEVER** 把額度耗盡記成 `tool-failure` 的證據。
