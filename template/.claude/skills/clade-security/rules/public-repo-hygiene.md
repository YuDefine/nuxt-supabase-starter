---
description: 在 PUBLIC repo 的 consumer 寫或改自家 tracked 檔（HANDOFF、tasks、docs、decisions）、接 pre-commit 或 CI hygiene gate 時套用——其他 consumer／客戶代號與個人路徑只准以 placeholder 出現，gate 必須掃整棵 tracked tree
paths: ['.github/workflows/**', '.husky/**', 'HANDOFF.md', 'tasks/**', 'scripts/audit-public-tree-hygiene.ts', 'scripts/public-tree-hygiene-tokens.json']
---
<!-- Clade native rule; source: rules/core/public-repo-hygiene.md; edit canonical source -->

<!-- clade-targets: claude,codex -->

# Public Repo Hygiene（自寫檔的洩漏 gate）

**核心命題**：clade 的 propagate 只消毒「它自己投影進來的檔」。consumer 自己寫、自己 commit 的 tracked 檔（交接檔、tasks、docs、decisions）**沒有任何 sanitize**——PUBLIC repo 會把它們原樣推上公開 GitHub，連同其他客戶的代號與 maintainer 的本機路徑。判定「這個 repo 是不是 PUBLIC」只看 GitHub visibility（`gh repo view`），不看 registry 有沒有宣告。

姊妹機制：`scripts/audit-clade-leak.ts` 掃**投影檔**（清單 runtime 取自 clade registry，只在 clade home 有效）；本規約的 `scripts/audit-public-tree-hygiene.ts` 掃**整棵 tracked tree**，只吃投影進來的 salted hash 清單，所以 public CI（沒有 clade）也跑得動。

## MUST

1. **自寫檔稱呼其他 consumer／客戶一律用 placeholder**（`<consumer-x>`、`<client-x>`），個人路徑寫 `~/` 或 `<home>/`。placeholder 的字母與 fleet 去識別化的慣例對齊即可，不必與 clade 端的編號一致。
2. **每一個 PUBLIC consumer 都 MUST 接兩道 gate**，缺任一道等於沒有 gate：
   - pre-commit：`node scripts/audit-public-tree-hygiene.ts --staged`（掃 index 內的 staged blob，不是 worktree）。
   - CI：一個 job 跑 `node scripts/audit-public-tree-hygiene.ts --tree`（掃全部 `git ls-files`）。**這個 job 不得帶 `paths:` filter**——有 filter 時只有碰到那些路徑的 PR 才掃，其他檔在任何人改到之前永遠不被看見；檢查範圍是整棵 tree，觸發條件就必須是每一次 push／PR。
3. **命中時改檔，NEVER 改清單**。清單是 clade 端 propagate 依 registry 產生的 `scripts/public-tree-hygiene-tokens.json`，手改會在下一輪 propagate 被覆寫；漏判（該擋沒擋）回報 clade 修 registry 的 `sanitization_profile`／`sanitization_aliases`。
4. **NEVER 把命中的文字貼進 PR 描述、CI log、issue 或對話**：PUBLIC repo 的這些面全是公開的。audit 輸出只報 `file:line:col` 與類別，照那個位置去看。
5. **exit 2（hash 清單缺失、毀損、canary 不符、git 列舉失敗）等於 gate 沒有執行**，不是綠燈、也不要 retry：跑 clade propagate 重新投影清單。

## 判定語義（與 clade sanitize 同一份）

| 類別 | 規則 | 例 |
| --- | --- | --- |
| consumer 代號 | 不分大小寫；左右兩側必須是非英數（或行首／行尾）；`_`、`-`、`.` 都算邊界 | `<name>_wt_x`、`gh-runner-<name>` 都中；`x<name>`、`<name>2` 不中 |
| personal | literal substring，區分大小寫，無邊界要求 | maintainer 的 home 路徑前綴、email、網域 |
| forbidden literal | literal substring | 其他 consumer 的完整 `owner/repo` |

另外**檔案路徑本身**也掃（檔名含客戶代號同樣是洩漏）。binary（前 8KB 含 NUL）與 submodule gitlink 跳過，數量印在 `skipped:`。

## REQUIRED 欄位

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | 每一次 commit（pre-commit `--staged`）與每一次 push／PR（CI `--tree`，無 `paths:` filter）；僅 PUBLIC consumer——visibility 以 `gh repo view` 為準 |
| 消費端 | consumer 的 git pre-commit hook 與 CI workflow；寫 HANDOFF／tasks／docs 的 agent 與人。clade 端：`scripts/propagate.ts` consumer-sanitize 階段（產生清單）、`scripts/lib/vendor-targets.ts`（投影 audit 本體） |
| 載入路徑 | consumer：本檔 paths-gated 於 `.github/workflows/**`、`.husky/**`、`HANDOFF.md`、`tasks/**`、audit 與清單檔；gate 失敗時案發點是 audit 輸出本身（它指出 file:line:col 與修法）。clade home 不自動載入 `rules/core/`，clade 端改動入口是 `scripts/lib/public-tree-hygiene-hashes.ts` |

## 已知邊界

- hash 清單**擋明文、不擋字典攻擊**：短而常見的代號可被暴力還原。它的保證是「repo 內沒有可 grep 的客戶名單」，不是機密性。
  - 量級：salt 就寫在清單檔裡、sha256 很快，5 字母代號的全部組合（26⁵ ≈ 1200 萬）單核不到 1 秒就窮舉完。
  - 換慢速 KDF 無效：audit 要對每個字窗位置算 hash，攻擊者猜一次的成本就等於 audit 比對一次的成本；慢到擋得住字典，pre-commit 與 CI 的全樹掃描也慢到不能用。拿掉長度欄位 `l` 同樣無效，短代號照樣窮舉得到，audit 還得多試幾種長度。
  - 真正有效的只有清單不進 public repo（例如 CI 從 secret 取清單），代價是 public fork 的 PR 跑不到 gate，目前不採用。
- consumer 代號的大小寫折疊只做 ASCII。sanitize 的非 unicode regex `i` 仍會折 `é`／`É` 這類對，兩邊只在 ASCII token 上一致，所以 generator 拒收含非 ASCII 字元的 consumer 代號（propagate 在產清單那一步失敗），不靜默漏抓。
- 只掃 tracked 檔與其路徑；git 歷史、PR／issue 文字、untracked 檔不在範圍。歷史洩漏走獨立的 history 清理，不是本 gate 的職責。
