// 🔒 LOCKED — managed by clade · Source: vendor/scripts/lib/machine-cpu.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/lib/machine-cpu.ts
// machine-cpu.ts — CPU 計數、PSI 與每核用量的純函式（無 I/O、無 repo 內相依）
//
// 從 `machine-util.ts` 拆出：`herdr-machine.ts`／`herdr-session-handoff.ts` 在 release 清單內，只能相對 import
// 同樣隨 release 出貨的檔；窗長與紀錄那一半依賴 coordinator 內部檔，留在 `machine-util.ts`（它 re-export 本檔）。

/** `/proc/stat` 的 `cpu` 列累計：total＝user..steal 八欄和（guest 已含在 user/nice）、idle＝idle＋iowait。 */
export interface CpuCounters {
  total: number
  idle: number
}

/** 解析 `/proc/stat` 的彙總 `cpu ` 列；不是那一列或欄位不足回 null。 */
export function parseCpuStatLine(line: string): CpuCounters | null {
  const m = /^cpu\s+(.+)$/u.exec(line.trim())
  if (!m) return null
  const f = m[1]!.trim().split(/\s+/u).map(Number)
  if (f.length < 5 || f.some((n) => !Number.isFinite(n))) return null
  const total = f.slice(0, 8).reduce((a, b) => a + b, 0)
  return { total, idle: f[3]! + f[4]! }
}

/**
 * 每核負載達此值即算 CPU 飽和：PSI 會低估（load 33／10 核時 avg300 只有 52），每核負載直接看排隊的
 * runnable 數。2 = 每個核平均有一個在跑、一個在等。只用於 `--machine auto` 放置排序（`herdr-machine.ts`
 * `pressureReasons`，飽和的機器排後面）；**不擋派**——CPU 忙碌只影響放哪台，不影響派不派。
 */
export const SATURATED_LOAD_PER_CORE = 2

/**
 * 記憶體 PSI `some avg60` 達此值即算記憶體壓力（硬上限，比填充線 `fill.memPressureMaxAvg60` 寬）：三成時間有 task
 * 在等換頁就是 swap 抖動，再派可能把機器拖到當機。
 */
export const MEM_PRESSURE_AVG60 = 30

/** PSI 檔（`/proc/pressure/{cpu,memory}`）`some` 列的 `avg60`／`avg300`；讀不到 null。 */
export function parseCpuPsi(text: string, window: 'avg60' | 'avg300' = 'avg300'): number | null {
  const m = new RegExp(`^some\\b.*\\b${window}=([\\d.]+)`, 'mu').exec(text)
  return m ? Number(m[1]) : null
}

/** 每核負載；讀不到 null。 */
export function loadPerCore(m: { load1?: number | null; cores?: number | null }): number | null {
  return typeof m.load1 === 'number' && m.cores ? m.load1 / m.cores : null
}

/**
 * CPU 用量（每核，0–1）：有 `cpu_busy_pct` 用它，沒有才退用 load1／核。填充判定、容量分數與放置排序都看這個。
 */
export function cpuUsePerCore(m: {
  load1?: number | null
  cores?: number | null
  cpu_busy_pct?: number | null
}): number | null {
  return typeof m.cpu_busy_pct === 'number' ? m.cpu_busy_pct / 100 : loadPerCore(m)
}

/** 計數差換成秒（`USER_HZ` 在 Linux 固定 100）：探測內取樣的實際窗長（探測步驟加 2 秒）。 */
export function cpuWindowSeconds(a: CpuCounters, b: CpuCounters, cores: number): number | null {
  return cores > 0 && b.total > a.total ? (b.total - a.total) / (cores * 100) : null
}

/** 兩次計數之間的 busy%（steal 算 busy：VM 被宿主搶走的時間同樣不能用）；計數沒前進或倒退回 null。 */
export function cpuBusyBetween(a: CpuCounters, b: CpuCounters): number | null {
  const dt = b.total - a.total
  const di = b.idle - a.idle
  if (!(dt > 0) || di < 0 || di > dt) return null
  return ((dt - di) / dt) * 100
}
