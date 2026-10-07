
<!-- `\my` 渲染骨架。區段順序、桶名、編號與縮排照 `flow pending` 的輸出，NEVER 重排。某一桶為空時整段省略；`flow pending` exit 2（印 `佇列是空的。`）時改用最下方「全空」那一句，其餘區段全部不出。 -->
<!-- 只有「要我拍板」與「要我驗收」編 Qn，且編號連續跑過兩組；其餘區段一律 bullet，NEVER 加號碼或字母。 -->
<!-- 填位說明：{{FROM_CONVERSATION_MARK}} 本輪 Phase 1 第 4 步新推進的題填「  [本輪從對話撈出]」，其餘填空字串；{{RECOMMENDED_MARK}} 推薦那條填「（推薦）」，其餘填空字串；{{QN}} 從 Q1 起、跨「要我拍板」與「要我驗收」連續遞增；{{REPO_NAME}} 照 flow pending 的 [repo] 前綴（沒有前綴就省略整個 [ ]）；→、答案落到、補充、⚠ 等子行只在 flow pending 有印或需要補上下文時才出。 -->
<!-- {{REPLY_HINT}} 只列真的能一字結案的題（例：`Q1A Q2B Q3通過`）；有答不了的題時另起一句說明哪幾題要先補。 -->

要我拍板（{{RULING_COUNT}}）

Q{{QN}}  [{{REPO_NAME}}] {{QUESTION_ONE_LINE}}  {{AGE}}{{FROM_CONVERSATION_MARK}}
      A. {{OPTION_A_LABEL}}{{RECOMMENDED_MARK}}
      B. {{OPTION_B_LABEL}}
      → {{HUMAN_STEP}}
      答案落到：{{CARRIER}}
      span {{SPAN_ID}}
      補充：{{EXTRA_CONTEXT}}

Q{{QN}}  [{{REPO_NAME}}] {{QUESTION_ONE_LINE}}  {{AGE}}
      ⚠ 沒給選項也沒說要填什麼——這題現在答不了
      要選項：node vendor/scripts/flow/flow.ts ask-options {{SPAN_ID}}
      span {{SPAN_ID}}

要我驗收（{{REVIEW_COUNT}}）

Q{{QN}}  [{{REPO_NAME}}] {{QUESTION_ONE_LINE}}  {{AGE}}
      A. 通過
      B. 退回
      答案落到：{{CARRIER}}
      span {{SPAN_ID}}

要我動手（{{HUMAN_ACTION_COUNT}}）

  - [{{REPO_NAME}}] {{QUESTION_ONE_LINE}}  登記於 {{AGE}} 前{{FROM_CONVERSATION_MARK}}
    → {{HUMAN_ACTION}}
    可回：{{REPLY_WORD_1}}／{{REPLY_WORD_2}}
    span {{SPAN_ID}}

不在本 repo（{{OTHER_REPO_COUNT}}）

  - [{{REPO_NAME}}] {{QUESTION_ONE_LINE}}  登記於 {{AGE}} 前
    → {{HUMAN_ACTION}}

loop 結構性推不動（{{LOOP_STRUCTURAL_COUNT}}）

  - [{{REPO_NAME}}] {{QUESTION_ONE_LINE}}  登記於 {{AGE}} 前
    → {{HUMAN_ACTION}}

未分類（{{UNCLASSIFIED_COUNT}}）

  - [{{REPO_NAME}}] {{QUESTION_ONE_LINE}}  {{AGE}}

卡住、等人動手（{{GATED_COUNT}}）

  - [{{REPO_NAME}}] {{GATE_LABEL}}  {{AGE}}
    → {{GATE_ACTION}}

{{MEASUREMENT_LINE}}

回 {{REPLY_HINT}} 即可結案；「要我動手」帶 `可回：` 的列回那個字即可。

<!-- 全空時整份只輸出下面這一句（取代以上所有區段）： -->
佇列是空的，對話裡也沒有待你決定的事。（{{MEASUREMENT_LINE}}）
