// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/cucumber/src/stepdefinitions/dslOperations.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/cucumber/src/stepdefinitions/dslOperations.ts
/**
 * DSL 讀取 / 預處理的純邏輯（不依賴 @cucumber/cucumber，可被 unit test 直接測試）。
 *
 * 對應 ADR-0024 / ADR-0035。`When dsl 讀取 dsl.yml` 與 `When dsl 執行預處理`
 * 的 step definition 只做 world 收發，實際運算與 temp-dir 清理都在這裡。
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  DslExpander,
  DslPreprocessor,
  DslYmlReader,
  IsaInstructionCatalog,
  findDslFeatureFiles,
  type DslSpec,
} from '@specformula/dsl';

export interface DslWorld {
  /** 所有 yaml 檔（root dsl.yml、子資料夾 dsl.yml / <domain>.dsl.yml / isa.yml）。 */
  _dslFiles?: Array<{ path: string; content: string }>;
  /** root isa.yml 內容。 */
  _dslIsaYml?: string;
  /** root DSL feature 內容。 */
  _dslFeature?: string;
  /** 子資料夾 DSL feature：rel path → content。 */
  _dslFeatureFiles?: Record<string, string>;
  _dslSpec?: DslSpec;
  /** 預處理輸出：rel .isa.feature path → content。 */
  _dslIsaOutputs?: Record<string, string>;
  lastError?: Error;
}

/**
 * `When dsl 讀取 dsl.yml` 的純邏輯：materialize 到 temp dir → readEffectiveSpec，
 * 並以 try/finally 清理 temp dir（issue #450 temp leak 修復）。
 * 回傳 root 錨點（""）的 effective DslSpec。
 */
export function readDslYml(w: DslWorld): DslSpec | undefined {
  const tmpDir = materializeYaml(w);
  try {
    // ADR-0035：root 錨點讀取 = readEffectiveSpec(baseDir, "")，取代舊全域遞迴
    // readFromDir（readAll）。`When dsl 讀取 dsl.yml` 只讀 root 層 dsl.yml/*.dsl.yml。
    return new DslYmlReader().readEffectiveSpec(tmpDir, "") ?? undefined;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** `When dsl 執行預處理` 的純邏輯：materialize → 逐 feature 展開 → 收集輸出 map。 */
export function preprocessDsl(w: DslWorld): Record<string, string> {
  return runPreprocess(w);
}

/** 將所有 yaml 檔（含 isa 子路徑）materialize 到 temp dir，回傳該目錄。 */
function materializeYaml(w: DslWorld): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'specformula-dsl-'));
  for (const file of w._dslFiles ?? []) {
    const target = path.join(tmpDir, file.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.content, 'utf-8');
  }
  return tmpDir;
}

/**
 * ADR-0035 per-feature expander：anchor = feature 自身資料夾（root 為 ""）。
 * 每個 feature 獨立解析 effective DslSpec / ISA catalog，不同 anchor 的 scope
 * 看到不同定義。鏈上無 ISA 檔 → catalog 為 null（lenient pass-through）；
 * 鏈上有任一 ISA 檔 → strict。
 */
function perFeatureExpander(sourceRoot: string, featureFile: string): DslExpander {
  const rel = path.relative(sourceRoot, featureFile);
  const parent = path.dirname(rel);
  const anchor = parent === '.' ? '' : parent.split(path.sep).join('/');
  const spec = new DslYmlReader().readEffectiveSpec(sourceRoot, anchor);
  const catalog = IsaInstructionCatalog.loadEffective(sourceRoot, anchor);
  return new DslExpander(spec, catalog);
}

/** 執行預處理：materialize 全部檔案、逐 feature 展開、收集輸出 map。 */
function runPreprocess(w: DslWorld): Record<string, string> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'specformula-dsl-'));
  try {
    if (w._dslIsaYml) {
      fs.writeFileSync(path.join(tmpDir, 'isa.yml'), w._dslIsaYml, 'utf-8');
    }
    for (const file of w._dslFiles ?? []) {
      const target = path.join(tmpDir, file.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, file.content, 'utf-8');
    }
    if (w._dslFeature) {
      fs.writeFileSync(path.join(tmpDir, 'test.dsl.feature'), w._dslFeature, 'utf-8');
    }
    for (const [relPath, content] of Object.entries(w._dslFeatureFiles ?? {})) {
      const target = path.join(tmpDir, relPath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content, 'utf-8');
    }

    const outputDir = path.join(tmpDir, 'output');
    fs.mkdirSync(outputDir, { recursive: true });

    const outputs: Record<string, string> = {};
    for (const featureFile of findDslFeatureFiles(tmpDir)) {
      const rel = path.relative(tmpDir, featureFile);
      const featureText = fs.readFileSync(featureFile, 'utf-8');
      const expander = perFeatureExpander(tmpDir, featureFile);
      const preprocessor = new DslPreprocessor(expander);
      const isaText = preprocessor.process(featureText);
      const outRel = rel.replace(/\.dsl\.feature$/, '.isa.feature');
      const outPath = path.join(outputDir, outRel);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, isaText, 'utf-8');
      outputs[outRel.split(path.sep).join('/')] = isaText;
    }
    return outputs;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * 對齊 Java 端 DslStepDefinitions.normalizeOutput：
 * 對 pipe table row 做 cell-trim 重組，其他列 stripTrailing。
 * 避免 BDD 期望文字之 column padding 與實作算法不一致時導致誤報。
 */
export function normalizeGherkinOutput(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  for (const line of lines) {
    const trailingStripped = line.replace(/\s+$/, '');
    const leadingStripped = trailingStripped.replace(/^\s+/, '');
    if (leadingStripped.startsWith('|') && leadingStripped.endsWith('|')) {
      const pipeIdx = line.indexOf('|');
      const indent = line.substring(0, pipeIdx);
      const cells = leadingStripped.split('|');
      let normalized = indent + '|';
      for (let i = 1; i < cells.length - 1; i++) {
        normalized += ' ' + cells[i].trim() + ' |';
      }
      out.push(normalized);
    } else {
      out.push(trailingStripped);
    }
  }
  return out.join('\n').replace(/^\s+|\s+$/g, '');
}
