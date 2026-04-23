---
description: Review tiers 規則——依變更規模與風險決定 self-review、spectra-audit、code-review 的最低要求
globs: ['**/*']
---

# Review Tiers

繁體中文 | [English](./review-tiers.en.md)

變更大小與風險面向，決定 review 的最低強度。

## Tier 定義

- **Tier 1**：小型、低風險、非敏感變更
- **Tier 2**：中型以上功能變更、跨多檔案、行為可能回歸
- **Tier 3**：高風險變更，例如 migration / auth / permission / RLS / raw SQL / billing / security

## 觸發判斷

| 條件                                                                           | Tier |
| ------------------------------------------------------------------------------ | ---- |
| 只改 docs / comments / README                                                  | 1    |
| 小型非敏感重構或功能修補（約 < 50 行）                                         | 1    |
| 功能變更 ≥ 50 行、跨多個模組、可見行為改動                                     | 2    |
| 動到 migration / schema / auth / permission / raw SQL / security-critical code | 3    |

## 最低要求

| Tier | 最低 review 要求                                            |
| ---- | ----------------------------------------------------------- |
| 1    | 作者 inline self-review                                     |
| 2    | `spectra-audit` + code review                               |
| 3    | `spectra-audit` + code review，必要時補手動驗證與更嚴格測試 |

## 額外規則

- Tier 2 / 3 **不應** 只有作者自行口頭確認
- Tier 3 若同時改 schema 與權限 / policy，應在同一批 review 中一起看，避免半套上線
- 若變更雖然很短，但碰到敏感路徑，仍以高 tier 處理

## 禁止事項

- **NEVER** 因為 diff 看起來短就把高風險變更降成 Tier 1
- **NEVER** 跳過 `spectra-audit` 就宣稱 Tier 2 / 3 已完成
- **NEVER** 把「測試有過」當成可取代 review 的理由
