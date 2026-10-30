
<!-- `/my` 渲染骨架，分兩段：〈分組總覽〉是 Phase 2 第 2 步的輸出，〈單組討論〉是 Phase 3 第 2 步每一組的輸出。兩段不會出現在同一則回應裡，除非全部只成一組（見 `rules/分組討論判準.md` Rule 2）。 -->
<!-- 題號 {{QN}} 照該次 `flow pending` 的 Qn，NEVER 為分組重編；只有「要我拍板」與「要我驗收」的題有 Qn，動手組與狀態組一律 bullet、NEVER 加號碼或字母（`rules/QnX渲染判準.md` Rule 1、3）。 -->
<!-- 填位說明：{{GROUP_LABEL}} 組代號（A、B、C…）；{{GROUP_NAME}} 依 `rules/分組討論判準.md` Rule 2 的分組軸命名；{{GROUP_DECIDES}} 一句話說這組在決定什麼；{{REPO_NAME}} 照 flow pending 的 [repo] 前綴（沒有就省略整個 [ ]，跨機的 [<repo>@<機器>] 原樣保留）；{{QUESTION_SHORT}} 題目濃縮成一行；{{RECOMMENDATION_SHORT}} 推薦選項濃縮（沒有選項的題不寫「建議 …」，整段改成「⚠ 沒給選項也沒說要填什麼——這題現在答不了」，`rules/QnX渲染判準.md` Rule 5）；{{FROM_CONVERSATION_MARK}} 本輪 Phase 1 第 4 步新推進的題填「  [本輪從對話撈出]」，其餘填空字串；{{RECOMMENDED_MARK}} 推薦那條填「（推薦）」，其餘填空字串。 -->
<!-- flow pending 印的「span」與「答案落到」行是給 agent 對應答案用的，不渲染。 -->
<!-- {{DISMISS_COUNT}} 建議寫掉組的條數，題與列分開數：只有題寫「N 題」，混有動手列或狀態列寫「N 題、M 件」，只有列寫「M 件」；{{BUCKET_LABEL}} 寫掉的列原本所在的桶名（要我動手、卡住、等人動手…）。動手列與狀態列寫掉時維持 bullet、NEVER 補編 Q（`rules/分組討論判準.md` Rule 1）。 -->
<!-- {{STATUS_COUNT_CLAUSE}} 狀態組有列時填「，另有 N 件狀態列」，沒有填空字串；{{STATUS_BUCKET_NAME}} 照 flow pending 的桶名（不在本 repo／loop 結構性推不動／未分類／卡住、等人動手），每個非空桶一個小標，`卡住、等人動手` 的列用 flow pending 給的 gate 標籤與動作。 -->
<!-- {{FIRST_GROUP_REPLY_HINT}}／{{GROUP_REPLY_HINT}} 只列真的能一字結案的題；那組有沒選項的題時，{{FIRST_GROUP_UNANSWERABLE_CLAUSE}} 填「；Q{{QN}} 要先補選項」，沒有填空字串（`rules/QnX渲染判準.md` Rule 5）。 -->

<!-- ===== 〈分組總覽〉 ===== -->

{{PEER_WARNING_LINE}}
佇列現在有要你拍板 {{RULING_COUNT}} 題、要你驗收 {{REVIEW_COUNT}} 題、要你動手 {{HUMAN_ACTION_COUNT}} 件{{STATUS_COUNT_CLAUSE}}。{{VERIFICATION_SUMMARY}}以下分成 {{GROUP_COUNT}} 組：

**{{GROUP_LABEL}}. {{GROUP_NAME}}（{{GROUP_ITEM_COUNT}} 題）**
{{GROUP_DECIDES}}，建議{{GROUP_SUGGESTION}}。
- Q{{QN}} [{{REPO_NAME}}] {{QUESTION_SHORT}}：建議 {{RECOMMENDATION_SHORT}}{{FROM_CONVERSATION_MARK}}

**{{GROUP_LABEL}}. 建議寫掉（{{DISMISS_COUNT}}）**
這幾條問的事已經發生或已經答過，你點頭我才寫掉。
- Q{{QN}} [{{REPO_NAME}}] {{QUESTION_SHORT}}：{{DISMISS_EVIDENCE}}
- [{{REPO_NAME}}] {{QUESTION_ONE_LINE}}（{{BUCKET_LABEL}}）：{{DISMISS_EVIDENCE}}

**{{GROUP_LABEL}}. 動手組，要你到場或動帳號（{{GROUP_ITEM_COUNT}} 件）**
- [{{REPO_NAME}}] {{QUESTION_ONE_LINE}}  登記於 {{AGE}} 前
  現況：{{CURRENT_STATE_FACT}}

**{{GROUP_LABEL}}. 狀態組，不用回答、知道就好（{{GROUP_ITEM_COUNT}} 件）**
{{STATUS_BUCKET_NAME}}：
- [{{REPO_NAME}}] {{QUESTION_ONE_LINE}}  {{AGE}}
  → {{HUMAN_ACTION}}

{{MEASUREMENT_LINE}}

建議從 **{{FIRST_GROUP_LABEL}} 組**開始：{{FIRST_GROUP_REASON}}。{{FIRST_GROUP_LABEL}} 組可以直接回「{{FIRST_GROUP_REPLY_HINT}}」{{FIRST_GROUP_UNANSWERABLE_CLAUSE}}，也可以逐題問我細節。你要從哪組開始？

<!-- 全空時整份只輸出下面這一句（取代以上所有區段）： -->
佇列是空的，對話裡也沒有待你決定的事。（{{MEASUREMENT_LINE}}）

<!-- ===== 〈單組討論〉 ===== -->
<!-- 每題一個區塊；選項文字照 flow pending，後果接在破折號後面。review 題的選項固定是「通過／退回」；沒選項的題改用下方第二個區塊；動手組的列保留 bullet 與「可回：」。 -->

**第 {{GROUP_LABEL}} 組：{{GROUP_NAME}}（{{GROUP_ITEM_COUNT}} 題）**

**Q{{QN}} [{{REPO_NAME}}] {{QUESTION_ONE_LINE}}**
現況：
- {{CURRENT_STATE_FACT}}
  - **A. {{OPTION_A_LABEL}}{{RECOMMENDED_MARK}}**：{{OPTION_A_CONSEQUENCE}}
  - B. {{OPTION_B_LABEL}}：{{OPTION_B_CONSEQUENCE}}
我的看法：{{RECOMMENDATION_REASON}}

**Q{{QN}} [{{REPO_NAME}}] {{QUESTION_ONE_LINE}}**
現況：
- {{CURRENT_STATE_FACT}}
這題佇列上沒有選項，我已請出題者補（`flow ask-options`），補上之前先不答。

- [{{REPO_NAME}}] {{QUESTION_ONE_LINE}}
  現況：{{CURRENT_STATE_FACT}}
  → {{HUMAN_ACTION}}
  可回：{{REPLY_WORD_1}}／{{REPLY_WORD_2}}

可以一次回，例如「{{GROUP_REPLY_HINT}}」；有要細談的就單獨問那一題。

<!-- 落答回報（Phase 3 第 7 步）： -->
第 {{GROUP_LABEL}} 組落了 {{ANSWERED_QN_LIST}}，重跑佇列確認已消失，現在剩 {{REMAINING_COUNT}} 題。{{FOLLOWUP_HANDOFF_LINE}}接下來是第 {{NEXT_GROUP_LABEL}} 組，{{NEXT_GROUP_PREP}}。
