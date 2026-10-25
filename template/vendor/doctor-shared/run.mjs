#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/doctor-shared/run.mjs · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/doctor-shared/run.mjs
// Project-local Doctor CLI adapter: legacy releases use `scan`, current releases use [path].
// Current releases only read `--config <path>` / repo-root doctor.config.json (never nuxt.config.ts),
// so this adapter hands the clade preset to the CLI explicitly. See README.md § CLI 設定.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// vite-doctor 0.1.0 只在 `basename(process.argv[1])` 是 cli.mjs／cli.ts 時才跑：npm／bun 的 symlink bin
// 叫 `vite-doctor`，直接執行會零輸出、exit 0（--help 也是）。pnpm 的 shell shim 不受影響。
// 所以 symlink 一律解到真實路徑，用 node 直接跑 cli.mjs。
const shim = join(process.cwd(), 'node_modules', '.bin', 'vite-doctor')
let [binary, ...binaryArgs] = [shim]
try {
  const real = realpathSync(shim)
  if (/^cli\.[mc]?[jt]s$/.test(basename(real))) [binary, ...binaryArgs] = [process.execPath, real]
} catch {
  // 缺少 binary：下面的 --help 探測會回報
}
const help = spawnSync(binary, [...binaryArgs, '--help'], { encoding: 'utf8', timeout: 10_000 })
if (help.error || help.status !== 0) {
  process.stderr.write(
    `[doctor] Cannot inspect project-local vite-doctor: ${help.error?.message ?? help.stderr}\n`,
  )
  process.exit(help.status || 1)
}
const legacy = /vite-doctor\s+scan(?:\s|$)|^\s*scan(?:\s|$)/m.test(help.stdout)
if (!legacy && !/vite-doctor\s+\[path\]/.test(help.stdout)) {
  process.stderr.write('[doctor] Unsupported vite-doctor CLI; expected scan or [path] usage.\n')
  process.exit(1)
}

// Legacy `scan` CLIs print `--config  Unsupported in vite-doctor.` (no `<path>`); only pass it when advertised.
const supportsConfig = !legacy && /--config\s+<path>/.test(help.stdout)
const passthrough = process.argv.slice(2)
const callerOwnsConfig = passthrough.some(
  (arg) => arg === '--config' || arg.startsWith('--config='),
)
const CONSUMER_CONFIGS = ['ts', 'mts', 'mjs', 'js', 'cjs'].map((ext) => `doctor.config.${ext}`)
const consumerConfig = CONSUMER_CONFIGS.find((name) => existsSync(join(process.cwd(), name)))
const presetConfig = join(dirname(fileURLToPath(import.meta.url)), 'preset.ts')

// Precedence: caller's own --config > consumer doctor.config.{ts,…} (full replace; spread `doctorCliConfig` to keep the
// baseline) > consumer doctor.config.json (layered ON the preset: its rules override, exclude appends, other keys such as suppressions come from the JSON;
// the CLI would otherwise auto-read the JSON alone and silently drop the baseline) > clade preset.
const jsonConfig = join(process.cwd(), 'doctor.config.json')
const hasJson = existsSync(jsonConfig)
let configArgs = []
if (supportsConfig && !callerOwnsConfig) {
  if (consumerConfig) {
    if (hasJson) {
      process.stderr.write(
        `[doctor] ${consumerConfig} wins; doctor.config.json is ignored (the CLI reads one config).\n`,
      )
    }
    if (
      !/doctor-shared\/preset|doctorCliConfig/.test(
        readFileSync(join(process.cwd(), consumerConfig), 'utf8'),
      )
    ) {
      process.stderr.write(
        `[doctor] ${consumerConfig} does not import the clade preset; the CLI runs on its built-in defaults.\n`,
      )
    }
    configArgs = ['--config', consumerConfig]
  } else if (hasJson) {
    // Fixed, gitignored path (overwritten each run): nothing to clean up if the run is interrupted.
    const layerDir = join(process.cwd(), 'node_modules', '.cache', 'doctor-shared')
    mkdirSync(layerDir, { recursive: true })
    const layered = join(layerDir, 'doctor.config.mts')
    writeFileSync(
      layered,
      `import { readFileSync } from 'node:fs'
import preset from ${JSON.stringify(presetConfig)}
const local = JSON.parse(readFileSync(${JSON.stringify(jsonConfig)}, 'utf8'))
export default {
  ...preset,
  ...local,
  rules: { ...preset.rules, ...local.rules },
  exclude: [...preset.exclude, ...[].concat(local.exclude ?? [])],
}
`,
    )
    configArgs = ['--config', layered]
  } else {
    configArgs = ['--config', presetConfig]
  }
}

const result = spawnSync(
  binary,
  [
    ...binaryArgs,
    ...(legacy ? ['scan'] : []),
    '.',
    '--max-warnings',
    '0',
    ...configArgs,
    ...passthrough,
  ],
  { stdio: 'inherit' },
)
if (result.error) process.stderr.write(`[doctor] ${result.error.message}\n`)
if (result.signal) process.kill(process.pid, result.signal)
process.exit(result.status ?? 1)
