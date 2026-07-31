/**
 * clade fleet 統一的 commit message 規約（golden path）。
 *
 * 由 clade 中央倉散播到每個 consumer 的 `commitlint.config.ts`。
 * **NEVER 在 consumer 端直接編輯**——改這裡再 propagate，否則下次散播會被覆蓋。
 *
 * 格式：`<emoji> <type>[(<scope>)]: <subject>`，scope 選填。
 * 例：`🐛 fix: 修正字型 weight 缺失`、`📝 docs(handoff): 更新交接狀態`
 *
 * 生效前提：consumer 需有 `.husky/commit-msg` 執行 `pnpm commitlint --edit "$1"`。
 * 缺 hook 時本設定完全不會被執行（commit message 規約形同不存在）。
 *
 * 不標註 UserConfig 型別是刻意的——那需要 `@commitlint/types` 依賴，
 * 而 fleet 內多數 consumer 只裝了 cli + config-conventional。
 *
 * 但 plugin rule 的 callback 參數 **MUST** 各自帶 inline 結構型別：本檔會落在 consumer
 * repo root，凡是 `noImplicitAny` 涵蓋 root `.ts` 的 consumer，未標註的解構參數會直接
 * 報 TS7031 讓對方的 typecheck 紅燈（<consumer-a> 2026-07-31 實證）。clade 自己沒有 typecheck
 * script，所以這類缺陷在中央倉測不出來，只會在散播後於 consumer 端炸。
 */
export default {
  extends: ['@commitlint/config-conventional'],

  // 自訂解析器：支援 "✨ feat: message" 這種 emoji 前綴格式。
  // conventional 預設的 headerPattern 不接受 type 內含 emoji 與空白。
  // scope 以 `(...)` 選填，對齊 conventional commits——headerPattern 不接受 scope
  // 時，`📝 docs(handoff): ...` 整個 header 會解析失敗，commitlint 報的卻是
  // `subject may not be empty`，訊息與真因對不上、極難自行定位。
  parserPreset: {
    parserOpts: {
      headerPattern:
        /^(✨ feat|🐛 fix|🧹 chore|🔨 refactor|🧪 test|🎨 style|📝 docs|📦 build|👷 ci|⏪ revert|🚀 deploy|🎉 init)(?:\(([^)]+)\))?: (.+)$/,
      headerCorrespondence: ['type', 'scope', 'subject'],
    },
  },

  plugins: [
    {
      rules: {
        // headerPattern 不匹配時 parser 對 type/scope/subject 三者全回 null，
        // 於是每條 subject-* 規則都拿到空字串各自報錯，卻沒有任何一條說出真因
        // （見 pitfall-commitlint-emoji-type-mismatch-reports-subject-empty）。
        // 用「type 解析不出來」當 predicate 補一條會說實話的診斷。
        'header-emoji-type-match': ({
          type,
          header,
        }: {
          type?: string | null
          header?: string | null
        }) => [
          type !== null && type !== undefined,
          `header 不符合 "<emoji> <type>[(<scope>)]: <subject>" 格式（實際收到：${header}）。\n` +
            'emoji 與 type 是一對一綁定，配錯（📝 chore）、用未列出的 emoji（🗃️ docs）或漏 emoji（chore:）\n' +
            '都會讓 header 整個解析失敗，連帶讓 subject-* 規則誤報 subject 為空——那不是 subject 的問題。\n' +
            '合法配對：✨ feat / 🐛 fix / 🧹 chore / 🔨 refactor / 🧪 test / 🎨 style / 📝 docs / 📦 build / 👷 ci / ⏪ revert / 🚀 deploy / 🎉 init',
        ],
      },
    },
  ],

  rules: {
    'header-emoji-type-match': [2, 'always'],
    // 允許的 commit 類型（emoji 為型別的一部分，不可省略）
    'type-enum': [
      2,
      'always',
      [
        '✨ feat',
        '🐛 fix',
        '🧹 chore',
        '🔨 refactor',
        '🧪 test',
        '🎨 style',
        '📝 docs',
        '📦 build',
        '👷 ci',
        '⏪ revert',
        '🚀 deploy',
        '🎉 init',
      ],
    ],
    // type 含 emoji 與空白，conventional 的大小寫規則不適用
    'type-case': [0],
    // type 是否存在改由 type-enum 判定
    'type-empty': [0],
    // scope 選填且允許自由格式（handoff / security / tooling…），不限大小寫
    'scope-case': [0],
    // 中文無大小寫概念
    'subject-case': [0],
  },
}
