# changelog 分類判準

觸發點：`phases/consumer-batch.md` Step B.2.3（主線讀完 release body、為每個 item 標分類時）與 `phases/fleet.md` Step F.2.2（解析 release notes 成結構化 BC 時）。

# Rule 1 - 每個 item 依 release body 標四類之一（可混合），`adaptation` 時抽 BC 結構化資料

- Level: `MUST`

評估：first-match；以上皆非 → L*

| id | 訊號 | 標籤 |
| --- | --- | --- |
| L1 | release body 全是 bug fix / patch notes / perf / internal refactor，無 user-facing API 變更 | `bugfix` |
| L2 | 有 breaking changes / deprecations / renamed APIs / 移除的 API / signature 變更 / config schema 變更 | `adaptation` |
| L3 | 有重大新 feature（新 component / 新 API / 新 capability），consumer 可能受益 | `feature` |
| L* | changelog 不可得（B.2.1 `source: "none"` 或 B.2.2 fetch 失敗） | `unknown` |

**混合判定**（一個 release 可有多個標籤）：
- BC + feature → 同時標 `adaptation` + `feature`（升版時修 BC，完成後 HANDOFF 記 feature）
- 只有 deprecation（尚未 remove）→ `adaptation`（趁這次改掉，不等到 remove 才爆）
- 小 feature（如新增一個 option、default off、不影響現有行為）→ 仍歸 `bugfix`（不值得 HANDOFF entry）
- 重大 feature 但無 BC → 純 `feature`（升版走 bugfix 路徑，HANDOFF 記 feature）

**`adaptation` 時提取 BC 結構化資料**（Phase F 的 F.2.2 用同一份 schema）：

```jsonc
{
  "breaking_changes": [
    {
      "category": "rename | removal | signature | config-schema | peer-bump",
      "description": "<一句話人話>",
      "affected_apis": ["<symbol>"],
      "before": "<code snippet>",
      "after": "<code snippet>"
    }
  ],
  "deprecations": [{ "api": "<name>", "replacement": "<name>" }]
}
```

- `affected_apis` 必須是**可搜尋符號**（函式名 / component 名 / config key），不要寫人話
- `before` / `after` 是可貼上的 code snippet，給 pi 看

**`feature` 時提取 feature 摘要**：

```jsonc
{
  "notable_features": [
    { "description": "<feature 描述>", "opt_in": true }
  ]
}
```

**解析守則**：

- `category` 必填，五選一，不確定用 `signature`；Phase T 另有 `toolchain-config`（`affected_apis` 填設定 key 名，如 `onlyBuiltDependencies`，交給 Step T.3 比對，**NEVER** 送 codebase-memory-mcp）
- `affected_apis` 必須是可搜尋符號；`before` / `after` **MUST** 是可貼上的 code snippet
- 沒有 BC → `breaking_changes: []`，走 Step F.4.5 無 BC fast path

## Good Example

- 這個例子是好的，因為 deprecation 尚未 remove 也標 `adaptation`，趁這次改掉。

```text
release body：「`useFoo` deprecated, use `useBar`」→ adaptation，deprecations: [{api: useFoo, replacement: useBar}]
```

## Bad Example

- 這個例子是壞的，因為 `affected_apis` 寫人話，callsite 掃不到。

```text
affected_apis: ["表單驗證相關的 API"]
```

# Rule 2 - 第五類 `deprecated`：套件本身被棄用或改名，換套件交 user 選

- Level: `MUST`

`inventory.py` 的 `isDeprecated: true`（G13），或 npm registry 的 deprecation 訊息指向新名字：

評估：first-match；以上皆非 → P*

| id | 情況 | 處置 |
| --- | --- | --- |
| P1 | deprecation 訊息指名替代套件（改名、搬 scope） | 計畫表標 `deprecated`，列出替代套件；換套件是新增＋移除兩件事，移除照 `rules/依賴變更判準.md` Rule 2，**MUST 交 user 選**才排進 Phase C |
| P2 | 只說「不再維護」、沒有替代 | 標 `deprecated`、不升；計畫表列出，交 user 決定留著、換掉或另開 `/work-route` |
| P3 | 套件仍有新版，只是舊 major EOL | 不屬本類；照 Rule 1 依 release body 分類 |
| P* | 以上皆非（deprecation 訊息看不懂） | 標 `deprecated`、不升，計畫表附原訊息交 user |

**NEVER** 主線自己挑替代套件直接換。

## Good Example

- 這個例子是好的，因為換套件交 user 選。

```text
isDeprecated: true，訊息「moved to @scope/new」→ 計畫表 deprecated 列 → user 選「換」→ Phase C 新增 @scope/new、移除舊名
```

## Bad Example

- 這個例子是壞的，因為主線自己決定換。

```text
isDeprecated: true → 主線直接 pnpm remove old && pnpm add new
```

# Rule 3 - 安全通報與回退的 target 不由 changelog 決定

- Level: `MUST`

| 理由 | target | 准入依據（取代 BC clause） |
| --- | --- | --- |
| `security` | `inventory.py --audit` 該組的最高 patched 下限；直接依賴改 `package.json`，transitive 依賴改 `pnpm-workspace.yaml` 的 `overrides:`（同 `rules/依賴變更判準.md` Rule 1 的同步要求） | advisory id（GHSA／CVE），寫進計畫表證據欄 |
| `security` 且 `unpatched: true`（`patched_versions` 為 null 或 `<0.0.0`） | 沒有可升的版本 | 計畫表列「無修補」，**MUST 交 user**：移除、換套件或接受風險 |
| `rollback` | 上一個好版（使用者指定，或計畫檔／lockfile 歷史裡的前一版） | 上游 issue／advisory URL，寫進計畫表證據欄 |

這兩類仍走 Phase C 的 first-pass → research → 交 user 鏈；分類欄照 Rule 1 讀目標版的 release body，讀不到就 `unknown`。

## Good Example

- 這個例子是好的，因為 transitive 依賴用 overrides 釘到修補版，advisory id 記進證據欄。

```text
--audit：semver <7.5.2（GHSA-c2qf-…，transitive）→ overrides: semver ^7.5.2 → 計畫表證據欄 GHSA-c2qf-…
```

## Bad Example

- 這個例子是壞的，因為無修補的通報被靜默略過。

```text
--audit：foo unpatched → 計畫表不列，「沒有可升的」
```
