---
name: security-evidence
description: >-
  Use when 要判一則 Codex Security finding 是真漏洞還是假警報（finding mode），或上線前要分清 repo /
  staging / production 各層還缺哪些安全證據（map mode）。NOT for 修 code、跑掃描、寫 SECURITY.md。
metadata:
  clade:
    permission_tier: read
effort: high
---

<!-- clade-skill-scope: both -->

# security-evidence

判一則 Codex Security finding 是真漏洞還是假警報（finding mode），或在上線前把 repo／staging／production／第三方／營運各層還缺哪些安全證據攤開（map mode）。本 skill 只產出判讀、驗證計畫與 TD 登記，不改 code、不跑掃描、不碰 production。

# SOP

## Phase 1 -- 判定 mode 並備齊判讀依據

1. THINK 先讀取 `rules/mode判定判準.md`，依使用者帶進來的材料判 `finding` 或 `map`；多則 finding 時列出各則標題與位置，問先處理哪一則。
2. READ 讀取 target 的 `SECURITY.md`（沒有就先告知 Confidence 會被壓低）、finding 原文（`<output_dir>/findings.json` 該條與 `report.md` 對應段）與 `coverage.json` 的 Coverage；讀 code 只讀被點名的檔與它的直接 caller／callee。

## Phase 2 -- finding：分小步取得 context

1. READ 向使用者要完整 finding 原文（summary、檔案與行號、attack path、validation notes、Severity、Confidence、remediation、Coverage），不接受只有標題的轉述；缺段就逐項列出缺什麼並等回覆。
2. READ 確認產生這則 finding 的 repository、commit 或 branch 與掃描範圍；有 repo 存取權就唯讀查證被點名的檔，沒有就告知 code 主張只能標 `Report-Supplied`；target 不明確時等回覆。
3. WRITE 用白話重述要審的安全主張（攻擊者、需要的存取、動作、失效的控制、拿到的敏感結果、具體影響），請使用者確認這就是要審的主張後再往下。
4. READ 只問會改變 verdict 的最少外部事實（production RLS、storage 權限、IAM、路由暴露、feature flag、部署拓樸、webhook 設定、路徑是否可達），不問 secret 值；拿不到的記為 Proof Gap。
5. READ 問使用者要不要唯讀驗證計畫；要的話確認允許的環境與禁止的動作，沒有明確授權 production 測試時只規劃 staging 或檢視型驗證。

## Phase 3 -- finding：判讀與產出 review

1. THINK 先讀取 `rules/finding證據判讀判準.md`，逐一走完十個判讀維度，分開判 Severity 與 Confidence，給出三選一的 verdict；verdict 為 `needs more validation` 時規劃先解決影響最大 Proof Gap 的最小安全一步。
2. WRITE 先讀取 `templates/finding-evidence-review.md` 與 `templates/finding-evidence-review.example.md`，依骨架產出一份 review，附上檔案行號並為每筆證據標來源狀態，請使用者修正產品或部署事實；修正一輪後整份重出。

## Phase 4 -- map：一層一批取得 context

1. READ 取得既有安全脈絡：`SECURITY.md`、掃描 Coverage、重要 findings、既有 finding review 與驗證結果；都沒有就照樣往下，Repository 層 Coverage 記為 `Unknown`。等回覆再往下。
2. READ 取得部署範圍：產品跑在哪、有哪些環境，實際存在的資料庫、object storage、金流、AI、queue、email、身分驗證、analytics、背景 worker，以及系統能造成的外部副作用（花錢、發訊息、改客戶狀態、發佈、刪除、部署）。等回覆再往下。
3. READ 有 repo 存取權就唯讀盤點安全相關 code 與設定並記檔案行號，沒有就請使用者貼片段並標為使用者提供；把盤點結果給使用者修正。
4. READ 確認 staging 驗證能力：staging 是否有接近 production 的身分驗證、DB policy、storage 權限、queue、金流 sandbox 與第三方測試環境，哪些測試安全且被允許，哪些 production 特性 staging 無法重現。等回覆再往下。
5. READ 在不取得 secret 值的前提下蒐集 production 控制證據：誰能進雲端、DB、storage、部署、金流、AI 後台；row policy 與 storage 權限是否啟用、怎麼不露憑證地證明；secret 歸屬與汰換、log、告警、備份還原、事故聯絡人、網域保護、第三方設定；有會寫外部系統或花錢的 agent 時，問最小權限、核准邊界、花費上限與停止機制。等回覆再往下。
6. READ 對每一個未知或未通過的檢查問誰能處理、何時完成；沒有 owner 就記 `Owner Missing`，不自行指派。等回覆再往下。
7. WRITE 以 Repository／Staging／Production／Third Party／Operations 五層寫出範圍摘要，請使用者確認後才產出地圖。

## Phase 5 -- map：判讀與產出證據地圖

1. THINK 先讀取 `rules/production證據地圖判準.md`，把證據分五層、每條規則記七欄並標四值狀態、依 P0／P1／P2 排序（同級內最便宜就能下定論的在前），給出帶範圍的 verdict。
2. WRITE 先讀取 `templates/production-security-evidence-map.md` 與 `templates/production-security-evidence-map.example.md`，依骨架產出整份地圖，請使用者修正 owner、期限與環境假設；修正一輪後整份重出。

## Phase 6 -- 依 verdict 登記

1. WRITE 若 finding verdict 為 `accept` 或 `needs more validation`，或 map 有 P0／P1 項目，先讀取 `templates/security-finding-TD.md` 與 `templates/security-finding-TD.example.md`，每項登一條：repo 有 `specs/truth/work-lifecycle.md` 的寫進承載它的 plan Open work，未遷移 consumer 才登 TD（自家 `docs/tech-debt.md`）；`### 自驗` 寫 Proof Gap 的取得方式與修完後的 `security-scan.ts verify` 指令。
2. WRITE 若 finding verdict 為 `unsupported`，只把結論寫進本次 review 報告，不開 TD、不改 code。


