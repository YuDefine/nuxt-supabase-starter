# § Skills mode — 第三方 skill 上游偵測、更新與整合評估

偵測 `npx skills add` 裝的第三方 skill（版本記在 `skills-lock.json`、不進版控）與上游的差距，並落地更新。

**不適用**：clade 自家 hub skill（`capabilities/**/skills/`，走 [[clade-publish]]）、consumer 自家 local skill（不在 `skills-lock.json`）、npm 套件升版。

同一支偵測 script 也掛在 `/clade-health skills` 與 `/clade-health full`。

## Step S.1 — 偵測（MUST 從這裡開始，NEVER 憑印象判斷落後與否）

```bash
cd ~/offline/clade
node scripts/audit-skill-freshness.ts --target <runtime-target> # 全 fleet（讀 consumers.local）
node scripts/audit-skill-freshness.ts --repo ~/offline/<consumer> --target <runtime-target> # 單一 repo
node scripts/audit-skill-freshness.ts --source supabase/agent-skills --target <runtime-target> # 單一上游
node scripts/audit-skill-freshness.ts --new-only --target <runtime-target> # 只看上游有、fleet 未裝（附 description）
node scripts/audit-skill-freshness.ts --json --target <runtime-target> # 機器讀
```

`audit-skill-freshness` 只認 `skills-lock.json`；submodule-tracked source（SpecFormula、aixbdd）MUST 另跑 `node scripts/audit-upstream-submodules.ts`（`--only <id>` 只看一個）。清單 SoT 是 `registry/upstream-submodules.json`，新增上游只加 entry，**NEVER** 改 script。

### S.1-submodule — audit 報落後之後（submodule-tracked 上游專用）

`audit-upstream-submodules.ts` 只回答「落後多少、落後的是什麼」；**落地不走 S.2–S.5**（那四步是 `skills-lock` 世界的處置），走 `docs/dev-guide.md` § 6.5 的指令序列：

```bash
cd ~/offline/clade
node scripts/sync-upstream-submodules.ts --dry-run --only <id>   # 唯讀：印落後數與會跑的五步
node scripts/sync-upstream-submodules.ts --only <id>             # 實跑：rebase fork 整合分支 → force-with-lease push → pin → mirror；attended-only
```

跑之前要知道（全文在 § 6.5）：

- `.gitmodules` 的 `url` 指 **fork**（整合分支只在 fork），registry 的 `upstreamRepo` 指**真上游**（落後數對它算）
- patch 只能落在 `integrationBranch`（`clade/main`）；audit 印「pin 另有 N commit 不在上游」而 fork `clade/main` 等於上游舊點 = patch 落錯分支，先照 § 6.5 § fork 分支拓樸修復
- 實跑 **MUST** 在 worktree（會改幾十個 tracked 檔）；先 `git submodule update --init --recursive vendor/<id>`

### `--new-only` 掃的是兩類 source，不是一類

| 段 | 來源 | 意思 |
| --- | --- | --- |
| 已裝上游的新 skill | 各 consumer 的 `skills-lock.json` | 我們已經在用的來源擴充了 —— 高訊號 |
| 候選上游 | `registry/skill-sources.json` 裡 `status: "candidate"` 的條目 | fleet 一支都沒裝過的來源 —— 探索性 |

標記：

- `⚠ fleet 已由 <source> 提供同名` —— 不是新能力，只是換上游拿同一支
- `（該 source 另有 N 支未列入 track 子集，未評估）` —— N 是主動不看的支數
- `⏭ 超過逐支評估承載` —— `track: "all"` 且未裝支數超過門檻，整段沒展開；給它 `track` 子集或 `--changelog <source>` 單獨展開，**NEVER** 當作沒東西

### 加一條候選 entry 的紀律

- `reason` **MUST 是依賴證據**：指名哪個 consumer 的哪個 dep 或 config（例「template 有 better-auth dep」），**NEVER** 寫「看起來有用」
- `track` 必填、無預設：vendor 維護且主題聚焦的 source（`cloudflare/skills`）給 `"all"`；grab-bag（`pproenca/dot-skills` 211 支）給子集陣列。缺 `track` 的 entry 不進掃描

**加 entry 之前 MUST 先實測該 source 的 SKILL.md 支數**：

```bash
n=$(gh api "repos/<owner>/<repo>" --jq .default_branch)
gh api "repos/<owner>/<repo>/git/trees/$n?recursive=1" \
  --jq '[.tree[]|select(.type=="blob")|select(.path|endswith("SKILL.md"))]|length'
```

**NEVER** 用策展 registry 挑了幾支推估 source 規模。

- 子集內容 **MUST** 由 fleet 依賴證據決定，**NEVER** 照抄別人的策展（autoskills 是發現管道不是判準）
- 決定不追的 source **MUST** 以 `status: "deferred"` 留檔並寫不採理由
- 看到 `ℹ 候選 X 已進 fleet lock —— 可從 registry/skill-sources.json 移除` 就刪該條目

**NEVER 用 skill frontmatter 的 `metadata.version` 判斷是否落後。** 上游常只改內文而不 bump version；判準只有內容 hash，那正是 audit script 在算的東西。

## Step S.2 — 判讀各類 status

Script 只呈現事實，處置是主線的工作。**每一類都要處理**，不是只看 `stale`：

| status | 意思 | 處置 |
| --- | --- | --- |
| `current` | 逐檔 blob sha 與上游全等 | 無動作 |
| `stale` | 內容有差異 | → Step S.3 讀變動性質 → Step S.5 更新 |
| `upstream-gone` | 上游查無同名 skill | **先讀 script 給的成因猜測**（合併 / 改名 / 移除），三種處置不同，見下表 |
| `missing` | lock 有記載但 `<skills-root>/` 下不存在 | lock drift：確認是「該裝沒裝」還是「已移除但 lock 沒清」，前者補裝、後者 `npx skills remove <name> --agent <runtime-agent> -y` 清 lock |
| `lock-only` | 上游查無、本地目錄也不在 | 純 lock 殘留：`npx skills remove <name> --agent <runtime-agent> -y`，**事後 MUST 確認 `skills-lock.json` 的條目真的消失**——skills CLI 對目錄已不在的 skill 可能回報成功卻不清 lock，沒消失就手動刪該條目 |
| `projected` | lock 有記載，但目錄由 clade 投影認領（`.clade/projections/*.json`） | lock 條目是殘留：只從 `skills-lock.json` 刪該條目、從 `scripts/install-skills.sh` 拿掉安裝行。**NEVER** `rm -rf` 或 `npx skills remove`——會連 clade 投影一起刪 |
| `unresolved` | source 型態不支援或上游查詢失敗（note 有原因） | 不是 skill 的問題：照 note 排除（`gh auth status`、source 是否改名／轉私有、well-known 網域可否連線）後重跑；排除不了就在報告裡列為未驗證，**NEVER** 讀成 current |

`upstream-gone` 的三種成因與處置：

| script 提示 | 成因 | 處置 |
| --- | --- | --- |
| 「疑似已併入上游 X 的 reference/<name>.md」 | 上游把 N 支獨立 skill 重構成 1 支 + `reference/` | **MUST 刪掉本地同名殘留目錄**（`rm -rf <skills-root>/<name>`）並確認主 skill 是 `current`。殘留目錄是舊版內容，會與新版主 skill 給出互相矛盾的指引 |
| 「上游無同名，疑似改名為：Y」 | 上游改名 | 改 `scripts/install-skills.sh` 的安裝行為新名，重裝後刪舊目錄 |
| 「找不到疑似的改名 / 合併對象」 | 上游移除，或 script 猜不到 | **MUST 人工去上游 repo 確認**再決定刪除或保留。**NEVER** 因為 script 說找不到就直接刪 |

## Step S.3 — 讀上游變動性質（決定要不要跟）

Script 對每個 `stale` 項已附最近 3 筆影響該 skill 目錄的 commit。要完整變動日誌：

```bash
node scripts/audit-skill-freshness.ts --changelog supabase/agent-skills@supabase-postgres-best-practices
node scripts/audit-skill-freshness.ts --changelog antfu/skills      # 整個 repo 層級
```

輸出該目錄 `CHANGELOG.md`、近 10 個 release、近 20 筆 commit。

第三方 skill 變動多是內容改善，預設**跟**。「不跟」要具體理由，且 **MUST** 登一條 `docs/tech-debt.md` TD 記錄刻意留舊版的原因。

## Step S.4 — 整合評估（上游新 skill vs 自家資產）

對「上游有、fleet 未安裝」的**每一支**逐一判斷：

1. 先用 `--new-only` 印的 description 初篩，通過的才讀全文（`gh api repos/<r>/contents/<path> --jq .content | base64 -d`）
2. 三條依序全過才裝，**NEVER** 憑名字或「上游有就全裝」（description 常駐 context）：
   - 該技術真的在用（查 consumer `package.json`）
   - 已裝的 skill 沒覆蓋同主題（已裝 `antfu/skills@vue` 就不裝 `onmax/nuxt-skills@vue`）
   - 不與自家規約打架（plan / commit / code review / worktree / 完成前驗證類幾乎都有自家規約）
3. 裝了之後，自家有沒有 rule / skill 可以退場

第 3 點的判定表——對**每一個**主題相關的自家 skill / rule 檔各出一列，四選一：

| 判定 | 成立條件 | 動作 |
| --- | --- | --- |
| **DELETE** | 內容被上游完全覆蓋，且上游講得一樣好或更好 | 刪源檔 + `scripts/propagate.ts` 讓 consumer 端投影一併消失 |
| **SLIM** | 大部分被覆蓋，剩下是自家特化 | 只留特化段，開頭加一行指向上游 skill |
| **KEEP** | 上游沒碰（self-hosted 拓樸 / 自家 preview env / 業務流程 / 部署形態特化） | 不動 |
| **CONFLICT** | 自家寫的與上游**牴觸**（上游說 A、我們說 not A） | **MUST 停下來讓 user 拍板**，NEVER 主線自行選邊 |

**判 DELETE 前 MUST 反查該檔是不是某條 pitfall 的唯一落地處**：

```bash
rg -l '<主題關鍵字>' ~/offline/clade/docs/pitfalls/
```

命中 pitfall 的段落一律降級為 SLIM 並保留。

## Step S.5 — 落地

### S.5.1 更新已裝的 skill（每一個落後的 repo 都要跑，不是只跑第一個）

**唯一會真的換掉內容的路徑是「先刪本地目錄，再 add」**：

```bash
cd ~/offline/<consumer>
rm -rf <skills-root>/<name>
npx skills add <owner>/<repo>@<name> --agent <runtime-agent> --copy -y
# well-known source（evlog.dev 這類）要用完整 URL，且不支援 @skill 選取：
npx skills add https://www.<domain> --agent <runtime-agent> --copy -y
# lock 條目有 `ref`（釘 tag／branch，例：impeccable 的 skill-v4.3.1）：用 audit 對該項印出的
# /tree/<ref>/<上游 skill 目錄> 指令，NEVER 用 @<name>——那會拉 default branch，解除釘選
npx skills add https://github.com/<owner>/<repo>/tree/<ref>/<skill-dir> --agent <runtime-agent> --copy -y
```

**NEVER 拿來當更新手段**：

| 指令 | 實際行為 |
| --- | --- |
| `pnpm skills:install` / `npx skills add <repo>@<name>`（目錄還在時） | 判定已安裝，**整支跳過**，檔案一個字都不會變 |
| `npx skills update -p -y` | 回報「✓ Updated N skill(s)」但**只改 `skills-lock.json` 的 hash、不換檔案**，反而讓 lock 對不上磁碟內容 |

同一 source 一半以上要更新時可用不帶 `@skill` 的 `npx skills add <owner>/<repo> --agent <runtime-agent> --copy -y`，但它會**裝上該 repo 所有沒選的 skill**，先確認支數。

### S.5.2 新增 skill

**MUST 先改 `scripts/install-skills.sh` 再跑安裝**：它是重建機器的唯一依據，`<skills-root>/` 多半 gitignored。

### S.5.3 清殘留與 lock drift

```bash
cd ~/offline/<consumer>
rm -rf <skills-root>/<被上游合併掉的舊 skill>
npx skills remove <lock 有記載但已不該存在的 skill> --agent <runtime-agent> -y
```

### S.5.4 commit（consumer 端）

consumer 端一律 `git commit --only -- <paths>`（per [[clade-role-and-todo-discipline]] § Ad-hoc commit hard rule）。多數 consumer 的 `<skills-root>/` 是 gitignored，真正要 commit 的通常只有 `scripts/install-skills.sh` 與 `skills-lock.json`：

```bash
git commit --only -m "🧹 chore(skills): sync 第三方 skill 到上游最新" -- scripts/install-skills.sh skills-lock.json
git show --stat HEAD | tail -3
```

### S.5.5 收尾驗證（MUST，NEVER 只憑安裝指令沒報錯就宣告完成）

`npx skills add` 對失敗的 source 仍 exit 0（如 well-known source 少了 `https://www.`），而目錄已被刪。

```bash
cd ~/offline/clade
node scripts/audit-skill-freshness.ts --target <runtime-target>
test -f <skills-root>/<name>/SKILL.md
```

處理過的項目要從 `stale` / `upstream-gone` / `missing` / `lock-only` / `projected` 消失（後兩類消失的判據是 `skills-lock.json` 已無該條目——CLI 報成功不算）。沒消失就是沒修好，回 Step S.2。

## 禁止事項（Skills mode）

- `set -e` 的 install script 中途失敗時，後面的行都沒跑
- **NEVER** 把「上游覆蓋自家 rule」的刪除與 skill 更新混進同一個 commit——前者是標準層改動（走 clade publish / propagate）

## 與 Fleet mode carve-out 的關係

第三方 skill sweep 屬 [[clade-role-and-todo-discipline]] § upstream-driven dep migration carve-out，准入比照 SKILL.md § Fleet mode carve-out 准入（SoT），「一個套件 × 一個 target version」讀作「**一個 source repo × 一次同步**」，多個 source NEVER 混成一個 commit。


Runtime substitutions: each target adapter binds `<runtime-target>` for audit selection and `<runtime-agent>` for the shared `npx skills add` CLI. Do not infer either value from the lock file.
