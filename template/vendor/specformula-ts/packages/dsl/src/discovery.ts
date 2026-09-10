// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/dsl/src/discovery.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/dsl/src/discovery.ts
/**
 * Single source of DSL discovery rules — what counts as a spec / feature file.
 *
 * Mirrors `specformula-python/discovery.py` (ADR-0024 §二 / ADR-0029 /
 * ADR-0035): a DSL spec file is `dsl.yml` *or* any `<domain>.dsl.yml` in the
 * same folder; an ISA catalog file is `isa.yml` *or* `<domain>.isa.yml`;
 * a DSL feature source is any `*.dsl.feature`.
 *
 * Every "which files trigger DSL" decision lives here so the rules can change
 * in one place.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

/** DSL spec discovery globs (ADR-0024 §二 + ADR-0029). */
export const DSL_SPEC_GLOBS = ['dsl.yml', '*.dsl.yml'] as const;

/** ISA catalog discovery globs (ADR-0035 §7, extending ADR-0029 to ISA). */
export const ISA_SPEC_GLOBS = ['isa.yml', '*.isa.yml'] as const;

/** Feature discovery: the suffix recognised as a DSL feature source. */
export const DSL_FEATURE_SUFFIX = '.dsl.feature';

/** True when `name` matches a single glob pattern from a globs list. */
function isSpecFile(name: string, glob: string): boolean {
  // Glob is either a bare name (`dsl.yml` / `isa.yml`) or a `*.`-suffixed one.
  return glob.includes('*') ? name.endsWith(glob.slice(1)) : name === glob;
}

/**
 * Compare two strings by UTF-16 code unit order, mirroring Java
 * `String.compareTo` and Python's codepoint-based `sorted` (identical on
 * BMP). Do NOT use `localeCompare`, which applies locale collation and
 * produces a different (locale-dependent) order for mixed-case names.
 */
function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Non-recursive single-layer listing (ADR-0035: each ancestor-chain layer
 * contributes only its own spec files, sorted by filename). Returns `[]` when
 * `folder` is not an existing directory.
 */
function findSpecsInDir(folder: string, globs: readonly string[]): string[] {
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) return [];
  const out: string[] = [];
  for (const name of fs.readdirSync(folder)) {
    const full = path.join(folder, name);
    if (!fs.statSync(full).isFile()) continue;
    if (globs.some((g) => isSpecFile(name, g))) out.push(full);
  }
  // Python sorts single-layer listings by filename (`.name`), and Java sorts
  // by `String.compareTo` — both code-unit order, not locale collation.
  return out.sort((a, b) => compareCodeUnits(path.basename(a), path.basename(b)));
}

/** Return the DSL spec files directly inside `folder`, name-sorted. */
export function findDslSpecsInDir(folder: string): string[] {
  return findSpecsInDir(folder, DSL_SPEC_GLOBS);
}

/** Return the ISA catalog files directly inside `folder`, name-sorted. */
export function findIsaSpecsInDir(folder: string): string[] {
  return findSpecsInDir(folder, ISA_SPEC_GLOBS);
}

/**
 * Return the ADR-0035 ancestor-chain folders root → … → anchor.
 *
 * `anchor` is a root-relative folder path using `/` separators; `""` means
 * root only. The chain always starts at `baseDir` and accumulates one path per
 * non-empty `/`-segment, inclusive of the anchor itself.
 */
export function ancestorChain(baseDir: string, anchor: string): string[] {
  const chain = [baseDir];
  let acc = baseDir;
  for (const segment of anchor.split('/')) {
    if (segment) {
      acc = path.join(acc, segment);
      chain.push(acc);
    }
  }
  return chain;
}

/**
 * Return every DSL feature source beneath `featuresDir`, path-sorted
 * (recursive match of `*{DSL_FEATURE_SUFFIX}`). Returns `[]` when
 * `featuresDir` is not an existing directory.
 */
export function findDslFeatureFiles(featuresDir: string): string[] {
  if (!fs.existsSync(featuresDir) || !fs.statSync(featuresDir).isDirectory()) return [];
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(DSL_FEATURE_SUFFIX)) {
        out.push(full);
      }
    }
  };
  walk(featuresDir);
  return out.sort();
}
