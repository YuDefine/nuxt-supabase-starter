// 🔒 LOCKED — managed by clade · Source: vendor/scripts/lib/mutation-probe/mutation-core.mjs · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/lib/mutation-probe/mutation-core.mjs
// CLADE:VENDOR-SCRIPT
//
// mutation-probe/mutation-core — 載入時替換的唯一實作（零 import）
//
// `mutation.ts`（探針端：前置判定、site_scope）與 `load-hook.mjs`（測試行程內的 load hook）共用，
// 兩邊替換語意因此不會分岔。本檔 MUST 零 import：load-hook 在測試行程裡先於 hook 註冊載入它，
// 若它連帶載入產品碼（例如 source-assert-detect.ts），探針之後突變那些檔時，測試拿到的會是模組快取裡
// 未突變的那份，結果永遠是 survived（not-loaded）。
//
// 由 ~/clade vendor/scripts/lib/ 散播，請勿直接編輯 consumer 副本。

/**
 * `from` 在 `source` 內第 `occurrence` 次出現的起點（1 起算）。
 * 出現次數照 `String.prototype.indexOf` 由左到右、**不重疊**計；找不到回 -1。
 * @param {string} source
 * @param {string} from
 * @param {number} occurrence
 * @returns {number}
 */
export function findOccurrence(source, from, occurrence) {
  if (from === '' || occurrence < 1) return -1
  let idx = -1
  let searchFrom = 0
  for (let n = 0; n < occurrence; n++) {
    idx = source.indexOf(from, searchFrom)
    if (idx < 0) return -1
    searchFrom = idx + from.length
  }
  return idx
}

/**
 * 只替換第 `occurrence` 處；`hits` 為 1（有替換）或 0（`from` 沒有那麼多處）。
 * @param {string} source
 * @param {{ from: string, to: string, occurrence: number }} m
 * @returns {{ code: string, hits: number }}
 */
export function applyMutation(source, m) {
  const idx = findOccurrence(source, m.from, m.occurrence)
  if (idx < 0) return { code: source, hits: 0 }
  return { code: source.slice(0, idx) + m.to + source.slice(idx + m.from.length), hits: 1 }
}

/**
 * 在 `fsMod`（`node:fs` 的 module 物件）上包住 `readFileSync` 與 `promises.readFile`：讀的路徑 `isTarget`
 * 判為被突變的檔時，把讀到的內容在記憶體內替換再回傳，磁碟上的檔不動。
 *
 * 為什麼需要：load hook／vite transform 只看得到「被當成模組載入」的檔；測試用 `readFileSync` 讀進來的
 * yml、sql、sh 不經過它們，這類檔的突變永遠套不上（not-loaded 的 survived）。
 *
 * 零 import 的約束照舊（見檔頭）：fs、路徑比對（realpath）、回報都由呼叫端傳進來。
 * - `isTarget(pathLike)`：路徑是否就是目標檔。只收字串／Buffer／URL；fd、FileHandle 回 false。
 * - `note(line)`：每讀到目標檔一次記 `loaded`，替換成功再記 `hit`（與載入時替換同一份回報檔、同格式）。
 * 回傳 restore 函式（還原兩個 reader；測試用，行程內正常不呼叫）。
 * 呼叫端要在包完之後呼叫 `module.syncBuiltinESMExports()`，ESM 的具名 import 才看得到替換後的函式。
 * 限制：只涵蓋這兩個入口（`fs.readFile` callback、`createReadStream`、`FileHandle.readFile` 不包）；
 * Buffer 結果以 utf8 解碼後替換，非 UTF-8 的二進位檔只有在 `from` 命中時才會被改寫。
 * @param {{ readFileSync: Function, promises: { readFile: Function } }} fsMod
 * @param {{ from: string, to: string, occurrence: number }} spec
 * @param {{ isTarget: (p: unknown) => boolean, note: (line: string) => void }} hooks
 * @returns {() => void}
 */
export function installFsReadMutation(fsMod, spec, hooks) {
  const origSync = fsMod.readFileSync
  const origPromise = fsMod.promises.readFile

  const mutateResult = (result) => {
    hooks.note('loaded')
    const isText = typeof result === 'string'
    if (!isText && !(result instanceof Uint8Array)) return result
    const text = isText
      ? result
      : Buffer.from(result.buffer, result.byteOffset, result.byteLength).toString('utf8')
    const { code, hits } = applyMutation(text, spec)
    if (hits === 0) return result
    hooks.note('hit')
    return isText ? code : Buffer.from(code, 'utf8')
  }

  fsMod.readFileSync = function readFileSync(path, ...rest) {
    const result = origSync.call(this, path, ...rest)
    return hooks.isTarget(path) ? mutateResult(result) : result
  }
  fsMod.promises.readFile = async function readFile(path, ...rest) {
    const result = await origPromise.call(this, path, ...rest)
    return hooks.isTarget(path) ? mutateResult(result) : result
  }

  return () => {
    fsMod.readFileSync = origSync
    fsMod.promises.readFile = origPromise
  }
}
