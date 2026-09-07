# clade propagate：failed commit 之後 manifest pair 永久 drift（半邊 rollback）

**狀態**：nuxt-supabase-starter/template 的當次事故已修復並驗證（commit 9b16388a、v1.12.32 已 land）。
本 brief 只留**尚未修的 clade 端潛在缺陷**——落點在 `~/offline/clade`，不在本 repo。

## 缺陷

`scripts/propagate.ts:5543 resetCladePlumbing()`：

```js
const PLUMBING = [CANONICAL_MANIFEST, LEGACY_MANIFEST, '.claude/.hub-state.json']
const dirty = dirtyPathIntersection(PLUMBING, statusEntries)
```

`statusEntries` 來自 `git status`。**全部 11 台 consumer 的 `.clade/manifest.json`（CANONICAL）
都被 gitignore**（本 repo 是 `template/.gitignore:97` 的 `.clade/*`），而 `.claude/hub.json`（LEGACY）
**全部都 tracked**。gitignored 的檔永遠不會出現在 `git status` → 永遠不進 `dirty` → 永遠不被 reset。

後果：任何一次 commit 失敗後的 retry，reset 只把 LEGACY 退回 HEAD、CANONICAL 留在新版本，
兩者 drift。下一次 `sync-rules` 撞上 `scripts/lib/consumer-manifest.ts:226` 的
`manifest compatibility drift` 硬失敗，**且沒有任何官方修復入口**
（`migrate-consumer-manifest.ts:66` 撞到 drift 同樣是 throw）。該台從此每趟 propagate 都 failed，
直到有人手動把 CANONICAL 覆寫回 HEAD 基準。

實測時間軸（2026-09-07 v1.12.32 propagate）：

| 時刻 | 事件 |
| --- | --- |
| 02:44:40.117 | `writeConsumerManifest` 兩檔同時寫成 1.12.32 |
| 02:44:40.426 | `.pi/settings.json` 寫成 v1.12.32 並 staged |
| — | commit 失敗（commitlint 子行程 SIGABRT，另一個獨立問題） |
| 02:45:11.543 | retry 的 `resetCladePlumbing` 把 hub.json 退回 HEAD 1.12.31；manifest.json 因 gitignore 未被 reset，停在 1.12.32 |
| — | `sync-rules` drift 硬失敗 → consumer 判 failed |

`.pi/settings.json` 同樣不在任何 reset classifier 內，所以它以 staged 狀態殘留——那正是
`lint-staged could not find any staged files matching configured tasks` 的另一半。

## 建議修法（尚未實作）

`resetCladePlumbing` 對 CANONICAL_MANIFEST **不能**依賴 `git status`。兩個方向：

- A. 對 CANONICAL 改走 content 比對：讀 `git show HEAD:<LEGACY>`，若與磁碟上的 CANONICAL 不等則直接覆寫。
  對「gitignored canonical」語意正確，不管 consumer 有沒有 tracked 這個檔。
- B. 讓 reset 對 manifest pair 走 `writeConsumerManifest` 的 transaction 路徑而不是逐檔 checkout，
  保證兩檔同進同出。

另外值得補一條 propagate 前置檢查：偵測到 pair drift 時，若其中一邊等於 HEAD 版本，
自動把另一邊拉回而不是 hard-fail——現在唯一出路是人工介入。

## 已知不屬本缺陷

commitlint 的 SIGABRT 是**獨立**問題（見下），與 reset 無關；它只是這次的觸發器。
換成任何其他 commit 失敗原因，drift 一樣會發生。
