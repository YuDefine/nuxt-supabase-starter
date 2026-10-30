
# Security policy（SECURITY.md 安全憲法）

`SECURITY.md` 是這個 repo 安全不變量的 SoT。Claude 安全掃描（`$CLADE_HOME/scripts/security-scan.ts`）在 target 有它時讓 scanner 先讀它、ledger 記 `security_md_sha`；沒有它，掃描只看語法——程式碼裡的「刪除專案」是漏了授權還是正常功能，只有憲法答得出來。

## 五段固定結構（REQUIRED，順序固定）

| 段 | 寫什麼 | 從哪裡盤點 |
| --- | --- | --- |
| `## 攻擊入口` | 對外可達的 API / route 分群，**含每一個未認證入口**（token 連結、webhook、公開表單、kiosk / 裝置端點）逐條列 | `server/api/**`、`server/routes/**` |
| `## 信任邊界` | 請求在哪一層從「外部」變「可信」：middleware 名稱、session 型態、service-role client 准用的範圍 | `server/middleware/**` |
| `## 身分與授權模型` | 第一行明寫 `user-owned` 或 `tenant-scoped`；每層 enforcer（RLS / middleware / handler）各負責什麼 | schema 的擁有者欄位 + RLS policy |
| `## 核心資產與 secret` | 最值錢的資料表，加上所有 secret 的 **key 名**（NEVER 寫值） | `.env.example` |
| `## 安全不變量` | 每條格式 `- INV-n: <NEVER 句> — enforced by: rls\|middleware\|handler\|storage\|queue` | 前四段推出 |

不變量 **MUST ≥ 5 條，每一條都要有 `enforced by`**——沒有執行層的不變量，掃描器找不到反面證據，只能報候選、報不了 finding。

## 條件句

- 這個 repo 沒有 `SECURITY.md` → 先從 `$CLADE_HOME/vendor/snippets/security-policy/` 的範本（`user-owned` 或 `tenant-scoped`）建一份，再動 Tier 3 路徑
- `SECURITY.md` 的任一條不變量改了 → 之前的掃描結果即過期（audit 以 ledger 最近一筆有效掃描的 `security_md_sha` 判），operator 對 Tier 3 路徑以 `node $CLADE_HOME/scripts/security-scan.ts path --path <file> …` 補掃（0-S.3 不在 pre-commit，見 commit gates § 0-S.3），ledger 才出現新 `security_md_sha` 的有效掃描
- consumer 的 `business_activity` 要從 `pre-production` 改成 `active`（改 registry 之前），或 `SECURITY.md` 不變量改了而該 consumer 已 `active` → 上線前觸發點，三步：先跑 `security-evidence map`（唯讀、不耗掃描額度，不必等人）；深度稽核（claude-security Scan codebase）**只登記、不點火**——寫進 plan Open work 並用 `flow ask` 請 Charles 決定發起，登記時附 scope 檔數與額度需求（見 routing table〔`deep-security-audit`〕）；再跑 `audit-security-scan-freshness.ts --consumers <path>` 確認有效掃描沒過期。地圖沒做完，或地圖有 P0／P1 `Unknown` 缺口而 Charles 還沒就深度稽核拍板（發起並做完，或明確不做），**NEVER** 改成 `active`；他拍板不做就把決定寫進 plan，不再擋
- 填 `## 身分與授權模型` 與 `enforced by` → **每一條**授權規則只歸一層，**NEVER** 同一條在 RLS 與 handler 各寫一份（兩份會漂移，掃描器也只對標註的那層找反證）：identity 不是 Supabase Auth（better-auth、nuxt-auth-utils）→ RLS 只有 deny-all，租戶隔離與動作權限都標 `handler`，**NEVER** 標 `rls`；identity 是 Supabase Auth → 租戶隔離標 `rls`，細粒度動作權限仍標 `handler`。tenant-scoped 範本兩種變體都有
- 攻擊入口有機器對機器的 API token（整合方、排程、外部系統呼叫）→ 不變量 **MUST** 含一條 token 保管：每個呼叫方各發一把、DB 只存 sha256 雜湊、可單把撤銷、記 `lastUsedAt`、比對用 constant-time（等長 digest 上 `crypto.timingSafeEqual`）— enforced by: handler。**NEVER** 以一個共用 env secret 當所有呼叫方的 token，也 **NEVER** 用 `===` 比對 secret——共用 secret 外洩時無法只撤銷一方、也查不出是誰在用
- 掃描報告的每一條 finding → 先走 `security-evidence finding`（Severity / Confidence / Coverage / Proof Gap）判讀，再登 TD；wrapper 只掃不修

## 精簡

每段只寫掃描器判斷需要的事實：範例、教學、逐 endpoint 的 handler 描述都不放——掃描器把它整份讀進 prompt，每個字都佔 context。

CI runner 的信任邊界（哪些 job 碰得到持有 production 存取的 runner）不在本憲法的五段裡，判準見 [[self-hosted-runner]] § 10。

機械稽核：`node $CLADE_HOME/scripts/audit-security-policy.ts --consumers <path>`。成因與文章論證：`docs/rule-rationale/security-policy.md`。
