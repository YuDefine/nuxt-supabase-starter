// 🔒 LOCKED — managed by clade · Source: vendor/scripts/lib/mutation-probe/spawn-trial.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/lib/mutation-probe/spawn-trial.ts
// CLADE:VENDOR-SCRIPT
//
// mutation-probe/spawn-trial — 執行器共用的「跑一趟」子行程
//
// 契約：specs/truth/contracts/mutation-probe-cli.md § 1（逾時整組 SIGTERM、5 秒後 SIGKILL）、
//       § 工作樹保證（被追蹤的子行程 detached，pgid = pid，SIGINT／SIGTERM 時整組終止）。
// `node-runner.ts` 與 `vitest-runner.ts` 都用這支：detached spawn、`trackGroup` 登記、收 stdout／stderr、
// 逾時整組終止、主行程結束後清掉殘留子孫、等管線關閉（保底 2 秒）。
//
// 由 ~/clade vendor/scripts/lib/ 散播，請勿直接編輯 consumer 副本。

import { spawn } from 'node:child_process'

import { ProbeToolError } from './receipt.ts'
import { terminateGroup } from './worktree-guard.ts'

export interface SpawnTrialInput {
  /** 子行程的 cwd（被測 repo 根）。 */
  cwd: string
  /** `process.execPath` 之後的引數。 */
  args: string[]
  env: NodeJS.ProcessEnv
  timeoutMs: number
  /** 登記 detached 子行程的 pid；回傳取消登記函式（`RunnerOptions.trackGroup`）。 */
  trackGroup: (pid: number) => () => void
}

export interface TrialResult {
  code: number | null
  signal: NodeJS.Signals | null
  timedOut: boolean
  stdout: string
  stderr: string
  ms: number
}

export function spawnTrial(input: SpawnTrialInput): Promise<TrialResult> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now()
    const child = spawn(process.execPath, input.args, {
      cwd: input.cwd,
      env: input.env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const pid = child.pid
    if (pid === undefined) {
      child.once('error', (e) => reject(new ProbeToolError(`起不來 node：${e.message}`)))
      return
    }
    const untrack = input.trackGroup(pid)
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d))
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d))

    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      void terminateGroup(pid)
    }, input.timeoutMs)

    child.once('error', (e) => {
      clearTimeout(timer)
      untrack()
      reject(new ProbeToolError(`起不來 node：${e.message}`))
    })
    child.once('exit', (code, signal) => {
      const ms = Date.now() - t0
      void (async () => {
        // 主行程結束後仍殘留的子孫（測試自己 spawn 的、vitest worker）一併清掉，才不會在下一趟前還吃著
        // CPU／連接埠。
        await terminateGroup(pid, { graceMs: 1000 })
        clearTimeout(timer)
        untrack()
        const finish = () => resolve({ code, signal, timedOut, stdout, stderr, ms })
        // stdio 在群組清完後會關；等 close 以免漏掉輸出尾巴，保底 2 秒（子孫逃出群組仍握著管線時）。
        if (child.stdout.destroyed && child.stderr.destroyed) finish()
        else {
          const guardTimer = setTimeout(finish, 2000)
          child.once('close', () => {
            clearTimeout(guardTimer)
            finish()
          })
        }
      })()
    })
  })
}
