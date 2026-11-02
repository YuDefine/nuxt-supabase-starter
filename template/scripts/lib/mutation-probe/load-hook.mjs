// 🔒 LOCKED — managed by clade · Source: vendor/scripts/lib/mutation-probe/load-hook.mjs · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/lib/mutation-probe/load-hook.mjs
// CLADE:VENDOR-SCRIPT
//
// mutation-probe/load-hook — node-test 執行器的載入時替換 hook
//
// 契約：specs/truth/contracts/mutation-probe-cli.md § 突變的套用機制（node-test）。
// 探針以 `node --import=<本檔 URL> --test …` 執行；`node --test` 為每個測試檔開子行程，`--import`
// 經 execArgv 傳到子行程；探針另把同一個 `--import` 放進 NODE_OPTIONS，連測試自己 spawn 的 node 子孫
// 也拿得到。每個行程都會跑一次本檔、註冊一個 `module.registerHooks` load hook：
// `nextLoad` 回傳後、對 URL 落在目標檔的模組，把第 `occurrence` 個 `from` 換成 `to`（替換發生在
// TS 型別剝除之前，比對的是檔案原文）。突變只存在於記憶體，不寫任何檔案。
//
// 目標檔不是 JS 模組、而是被測試用 `readFileSync` 讀進來的 yml／sql／sh 時，load hook 看不到它
// （D36）。所以同一支檔另外包住 `fs.readFileSync`／`fs.promises.readFile`（實作在 `mutation-core.mjs` 的
// `installFsReadMutation`）：讀的路徑 realpath 後等於目標檔，就在記憶體內替換讀到的內容、同樣記
// `loaded`／`hit`。不是 node:test 專用：vitest 執行器把本檔放進 worker 的 NODE_OPTIONS，只開 fs 這一半。
//
// 設定走環境變數（子行程繼承）：
//   MUTATION_PROBE_SPEC   JSON：{ target（目標檔的 realpath）, from, to, occurrence }；沒設＝基線，不註冊 hook
//   MUTATION_PROBE_REPORT 檔案路徑；每次載入或讀取目標檔追加一行 `loaded`，替換成功再追加一行 `hit`；
//                         本檔在一個行程裡完成安裝時追加一行 `armed`（vitest 執行器靠它判斷攔截有沒有進到 worker）
//   MUTATION_PROBE_FS_ONLY 設 `1`＝只包 fs 讀檔、不註冊 load hook（vitest worker：模組替換歸 vite transform，
//                         兩邊都做會對同一個檔替換兩次）
//
// 回報走檔案而不是契約字面的 stdout 一行 `MUTATION_PROBE_HITS=<n>`：子行程的 stdout 由 node:test 接管，
// 與測試自己的輸出和 reporter 事件混在一起，測試 mock stdout 時會漏；追加寫入一個專屬檔沒有這些問題。
//
// 本檔只准 import node 內建與 `mutation-core.mjs`（零 import 的替換實作，`mutation.ts` 也從它 re-export，
// 語意單一來源）。NEVER import mutation.ts：那會把 mutation.ts／source-assert-detect.ts 在 hook 註冊前
// 載進模組快取，探針之後對這兩個檔做突變時，測試拿到的是快取裡未突變的那份，結果永遠是 survived（not-loaded）。
//
// 由 ~/clade vendor/scripts/lib/ 散播，請勿直接編輯 consumer 副本。

import fs from 'node:fs'
import { registerHooks, syncBuiltinESMExports } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { applyMutation, installFsReadMutation } from './mutation-core.mjs'

// 包 fs 之前先留住原函式：load hook 自己讀 CJS 原始碼、realpath 比對都不該被替換、也不該重複記數。
const readFileSync = fs.readFileSync
const { appendFileSync, realpathSync } = fs

const raw = process.env.MUTATION_PROBE_SPEC
if (raw) {
  const spec = JSON.parse(raw)
  const report = process.env.MUTATION_PROBE_REPORT
  const note = (line) => {
    if (!report) return
    try {
      appendFileSync(report, `${line}\n`)
    } catch {
      // 回報檔寫不進去時探針端會看到 loaded=false；這裡不能讓測試行程因此死掉。
    }
  }

  // 讀檔路徑 → 是不是目標檔。字串／Buffer／URL 才比；relative 以行程 cwd 解析，再 realpath
  // （spec.target 也是 realpath，symlink 路徑與實際路徑才會比對成同一個）。只快取存在的檔。
  const targetCache = new Map()
  // `nextLoad` 內部（預設 loader 讀原始碼）走的也是被包過的 readFileSync：那一次不能替換，否則 load hook
  // 之後拿到的已經是突變後的原文，`from` 對不上（hits=0），`to` 含 `from` 時還會替換兩次。
  let inNextLoad = false
  const isTarget = (input) => {
    if (inNextLoad) return false
    let path
    if (typeof input === 'string') path = input
    else if (input instanceof URL) {
      if (input.protocol !== 'file:') return false
      path = fileURLToPath(input)
    } else if (input instanceof Uint8Array) path = Buffer.from(input).toString()
    else return false
    const abs = resolve(path)
    const cached = targetCache.get(abs)
    if (cached !== undefined) return cached
    let real
    try {
      real = realpathSync(abs)
    } catch {
      return false
    }
    const isIt = real === spec.target
    targetCache.set(abs, isIt)
    return isIt
  }
  installFsReadMutation(fs, spec, { isTarget, note })
  syncBuiltinESMExports()
  note('armed')

  if (process.env.MUTATION_PROBE_FS_ONLY !== '1') {
    registerHooks({
      load(url, context, nextLoad) {
        inNextLoad = true
        let result
        try {
          result = nextLoad(url, context)
        } finally {
          inNextLoad = false
        }
        if (!url.startsWith('file:')) return result
        let path
        try {
          path = fileURLToPath(url.replace(/[?#].*$/, ''))
        } catch {
          return result
        }
        if (path !== spec.target) return result

        note('loaded')
        // CJS 經 require 載入時預設 load 可能不帶 source；自己讀。
        const source = result.source ?? readFileSync(path)
        const text = typeof source === 'string' ? source : Buffer.from(source).toString('utf8')
        const { code, hits } = applyMutation(text, spec)
        if (hits === 0) return result
        note('hit')
        return { ...result, source: code }
      },
    })
  }
}
