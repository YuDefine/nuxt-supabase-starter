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
 * 每核負載上限：達此值的機器不再收新件——另一台低於上限就放那台，每台都到上限才排隊（自動加派記
 * `resource-pressure`、`--machine auto` 拒派、預設 auto 留本機，本機到線而 peer 探不到時拒派）。
 * 每核負載高到 brief 送達逾時的程度才擋；開樹的 pnpm／tsc 尖峰只到 1.2 左右，
 * 所以線畫在 3（每核一個在跑、兩個在等），尖峰不會誤擋。CPU 使用率封頂在 1.0，表達不出超載，上限只能看 load1／核。
 * 每核 5 個以上在排隊時，新啟動的 session 會因 identity 偵測逾時而 launch_timeout，所以畫在 3；
 * launch_timeout 比例的節流見 `dispatch-launch-throttle.ts`。
 */
export const LOAD_CAP_PER_CORE = 3

/** 這台是否到了每核負載上限（`LOAD_CAP_PER_CORE`）；讀不到 load1／核數不判。 */
export function overLoadCap(m: { load1?: number | null; cores?: number | null }): boolean {
  const v = loadPerCore(m)
  return v !== null && v >= LOAD_CAP_PER_CORE
}

/**
 * 記憶體 PSI `some avg60` 達此值即算記憶體壓力（硬上限，比填充線 `fill.memPressureMaxAvg60` 寬）：三成時間有 task
 * 在等換頁就是 swap 抖動，再派可能把機器拖到當機。
 */
export const MEM_PRESSURE_AVG60 = 30

/**
 * MemAvailable／MemTotal 達此比例（%）時，記憶體 PSI 高只算「換回尖峰」不算缺記憶體：閒置 session 被喚醒、
 * 冷頁從 swap 換回，PSI 會衝高幾十秒，但 MemAvailable 還有一半，再放一件不會讓機器當掉（zenbook 實例：
 * 可用 16G／30G、swap 6.3/8G，PSI 尖峰把安全線擋死）。25 與 `SWAP_PRESSURE_MEM_AVAILABLE_PCT` 同值；
 * 可用比例低於此值，PSI 照舊算真缺（MemAvailable 硬下限 10% 另有一條，不受本值影響）。
 * 豁免還要 `agent-workloads.slice` 沒逼近上限（`WORKLOAD_SLICE_NEAR_LIMIT_PSI_AVG10`）：agent 跑在 slice 裡，
 * slice 會在 MemoryHigh／MemoryMax 先卡住而整機 MemAvailable 還很高。
 */
export const MEM_PSI_SPIKE_AVAILABLE_PCT = 25

/**
 * `agent-workloads.slice` 記憶體 PSI `some avg10` 達此值就算 slice 逼近上限（貼 MemoryHigh 被節流、或頂著 MemoryMax），
 * 換回尖峰豁免不成立。與單台停收線 `THROUGHPUT_POLICY.fill.stopLine.workloadMemPsiMaxAvg10`（15）同值
 * （`test/coordinator-ready.test.ts` 釘兩者相等）：slice 到停收線的機器本來就不收，豁免不能反過來放行它。
 */
export const WORKLOAD_SLICE_NEAR_LIMIT_PSI_AVG10 = 15

/** 讀 `agent-workloads.slice` 的 `memory.pressure`（探測者自己 uid 的 slice）；沒有該 slice 或讀不到＝空輸出。結尾 `|| true`：探測腳本以它收尾，沒有該 slice 時 `cat` 的非零 exit 會變成整支探測的 exit，peerLoad 把可連線的 peer 判 unreachable、localLoad 掉回 Node load1。程式 NEVER 含單引號（peer 端整段包在 shell 單引號裡）。 */
export const WORKLOAD_MEM_PRESSURE_CMD =
  'cat /sys/fs/cgroup/user.slice/user-$(id -u).slice/user@$(id -u).service/agent.slice/agent-workloads.slice/memory.pressure 2>/dev/null || true'

/**
 * 記憶體 PSI `some avg60` 到線是不是真缺記憶體：PSI ≥ `threshold` 且不是換回尖峰。換回尖峰＝可用比例 ≥
 * `MEM_PSI_SPIKE_AVAILABLE_PCT` **且** slice 記憶體 PSI avg10（`workloadAvg10`）讀得到並低於
 * `WORKLOAD_SLICE_NEAR_LIMIT_PSI_AVG10`。任一讀不到保守照擋（沒有 slice 的機器也照擋，不豁免）。
 */
export function memPsiShortage(
  avg60: number | null | undefined,
  threshold: number,
  availablePct: number | null | undefined,
  workloadAvg10?: number | null,
): boolean {
  if (typeof avg60 !== 'number' || avg60 < threshold) return false
  const hostHasRoom =
    typeof availablePct === 'number' && availablePct >= MEM_PSI_SPIKE_AVAILABLE_PCT
  const sliceHasRoom =
    typeof workloadAvg10 === 'number' && workloadAvg10 < WORKLOAD_SLICE_NEAR_LIMIT_PSI_AVG10
  return !(hostHasRoom && sliceHasRoom)
}

/**
 * 根目錄磁碟用量達此百分比的機器不當派工目標（常態要留在 80% 以下）。placement 把它當第三條
 * 排除線（與 `MEM_PRESSURE_AVG60`、`LOAD_CAP_PER_CORE` 並列），理由寫進 `placement.loads`；兩台都到線時退回本機，不拒派。
 */
export const DISK_FULL_PCT = 80

/** `df -P /` 的輸出（含或不含標題列）→ 用量百分比；解析不出 null（呼叫端當「沒量到」，不排除）。 */
export function parseDfUsedPct(text: string): number | null {
  const lines = text.trim().split('\n')
  const last = lines.at(-1)?.trim() ?? ''
  const m = /\s(\d{1,3})%\s+\//u.exec(last) ?? /\s(\d{1,3})%(?:\s|$)/u.exec(last)
  return m ? Number(m[1]) : null
}

/** 這台磁碟是否到了 `DISK_FULL_PCT`；沒量到不判。 */
export function diskFull(m: { disk_used_pct?: number | null }): boolean {
  return typeof m.disk_used_pct === 'number' && m.disk_used_pct >= DISK_FULL_PCT
}

/** PSI 檔（`/proc/pressure/{cpu,memory}`）`some` 列的 `avg10`／`avg60`／`avg300`；讀不到 null。 */
export function parseCpuPsi(
  text: string,
  window: 'avg10' | 'avg60' | 'avg300' = 'avg300',
): number | null {
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
