// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/instruction/ResponseValidate.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/instruction/ResponseValidate.ts
import type { ScenarioContext, LastResponseData } from '../context/ScenarioContext.js';
import type { ApiSpec } from '../spec/model/ApiSpec.js';
import type { ApiSchema } from '../spec/model/ApiSchema.js';
import { SpecFormulaLookupError } from '../error/SpecFormulaError.js';
import { SymbolResolver } from '../helper/SymbolResolver.js';
import { applyConstraints } from '../helper/ConstraintEngine.js';
import { getBracketValue } from '../helper/utils/bracket-path.js';
import { parseColumnPrefix } from '../helper/utils/column-prefix.js';
import { asString } from '../helper/utils/string-coerce.js';
import { parseJsonString } from '../helper/JsonBoundary.js';

/**
 * Result of a ResponseValidate run.
 */
export interface ValidationResult {
  passed: boolean;
  error: string | null;
}

/**
 * Wraps a string value that came from a quoted JSON string literal.
 * These values must NOT be treated as CAS constraints.
 */
class LiteralString {
  constructor(public readonly value: string) {}
}

/**
 * Compare two numeric strings for numeric equality (handles 1500.0 vs 1500.00).
 */
function numericEqual(a: string, b: string): boolean {
  // Both must parse as finite numbers
  const na = Number(a);
  const nb = Number(b);
  if (!isFinite(na) || !isFinite(nb)) return false;
  // Use string comparison of parsed Bigs to handle precision
  // Parse as decimal strings to avoid float issues
  return decimalEqual(a, b);
}

/**
 * Compare two decimal strings numerically without converting to float.
 * Handles trailing zeros, scientific notation.
 */
function decimalEqual(a: string, b: string): boolean {
  // Normalize: parse and compare
  try {
    const na = parseDecimal(a);
    const nb = parseDecimal(b);
    return na === nb;
  } catch {
    return false;
  }
}

/**
 * Parse a decimal string to a canonical form for comparison.
 * Returns a normalized string like "1500" or "1500.5".
 */
function parseDecimal(s: string): string {
  const trimmed = s.trim();
  // Handle scientific notation
  if (/[eE]/.test(trimmed)) {
    // Convert to fixed-point
    const n = Number(trimmed);
    if (!isFinite(n)) throw new Error('not a number');
    // Use BigInt-like approach: find the actual value
    return normalizeDecimalString(n.toFixed(20));
  }
  // Regular decimal: strip trailing zeros after decimal point
  return normalizeDecimalString(trimmed);
}

function normalizeDecimalString(s: string): string {
  // Remove sign temporarily
  let negative = false;
  let str = s.trim();
  if (str.startsWith('-')) {
    negative = true;
    str = str.slice(1);
  }

  // Split on decimal point
  const dotIdx = str.indexOf('.');
  if (dotIdx === -1) {
    // Integer — strip leading zeros
    const stripped = str.replace(/^0+/, '') || '0';
    return negative ? `-${stripped}` : stripped;
  }

  const intPart = str.slice(0, dotIdx).replace(/^0+/, '') || '0';
  const fracPart = str.slice(dotIdx + 1).replace(/0+$/, ''); // strip trailing zeros

  const result = fracPart ? `${intPart}.${fracPart}` : intPart;
  return negative ? `-${result}` : result;
}

/**
 * ResponseValidate — validates API response against expected values.
 *
 * Supports:
 *  - DataTable format: header row + data row with field paths
 *  - JSON doc-string format: recursive object comparison
 *  - CAS constraints (&eq, &gt, &contains, etc.)
 *  - Variable extraction (>contextKey / <executionKey)
 *  - $variable references in expected values
 *  - Numeric smart comparison (ADR ts-0008)
 *  - Schema validation via ApiSpec
 *  - H: header validation (DataTable) / H"key" (JSON)
 *  - B: bare body validation
 */
export class ResponseValidate {
  constructor(private readonly context: ScenarioContext) {}

  /**
   * Validate from a DataTable.
   *
   * @param apiSpec   ApiSpec for schema validation
   * @param summary   Operation summary
   * @param expectedStatus  Expected HTTP status code
   * @param headers   DataTable header row
   * @param rows      DataTable data rows
   * @param response  The actual response to validate
   */
  validateFromDataTable(
    apiSpec: ApiSpec,
    summary: string,
    expectedStatus: number,
    headers: Array<string | null>,
    rows: Array<Array<string | null>>,
    response: LastResponseData,
  ): ValidationResult {
    // Validate status
    if (response.status !== expectedStatus) {
      return {
        passed: false,
        error: `HTTP 狀態碼不匹配: 預期 ${expectedStatus}, 實際 ${response.status}`,
      };
    }

    // Schema validation if operation has schema defined
    const schemaError = this.validateSchema(apiSpec, summary, expectedStatus, response.body);
    if (schemaError) return { passed: false, error: schemaError };

    // Determine if table is effectively empty
    const nonNullHeaders = headers.filter((h) => h !== null && h.trim() !== '');
    if (nonNullHeaders.length === 0) {
      return { passed: true, error: null };
    }

    const dataRow = rows.length > 0 ? rows[0] : [];
    const resolver = new SymbolResolver(this.context);

    const errors: string[] = [];
    const extractionPairs: Array<{ contextKey: string; executionKey: string }> = [];

    for (let i = 0; i < headers.length; i++) {
      const header = headers[i];
      if (!header || header.trim() === '') continue;

      const cellValue = i < dataRow.length ? dataRow[i] : null;

      // >contextKey column — paired with <executionKey in data row
      if (header.startsWith('>')) {
        const contextKey = header.slice(1);
        if (cellValue && cellValue.startsWith('<')) {
          const executionKey = cellValue.slice(1);
          extractionPairs.push({ contextKey, executionKey });
        }
        continue;
      }

      // Skip extraction cells in data rows without context key header
      if (cellValue !== null && cellValue !== undefined && String(cellValue).startsWith('<')) {
        continue;
      }

      if (cellValue === null || cellValue === undefined) continue;

      const { prefix, name } = parseColumnPrefix(header);

      if (prefix === 'H') {
        // Validate response header
        const actualHeaderVal = response.headers[name] ?? response.headers[name.toLowerCase()];
        const { value: expectedStr, isLiteral } = this.resolveExpectedValueWithFlag(String(cellValue), resolver);
        const err = this.compareFieldValue(name, actualHeaderVal, String(expectedStr), isLiteral);
        if (err) errors.push(err);
      } else if (prefix === 'B') {
        // Validate bare body
        const err = this.compareFieldValue('B:', response.body, String(cellValue), false);
        if (err) errors.push(err);
      } else {
        // Body field path
        const fieldPath = name;
        const actualValue = this.getBodyValue(response.body, fieldPath);
        const { value: expectedStr, isLiteral } = this.resolveExpectedValueWithFlag(String(cellValue), resolver);
        const err = this.compareFieldValue(fieldPath, actualValue, String(expectedStr), isLiteral);
        if (err) errors.push(err);
      }
    }

    if (errors.length > 0) {
      return { passed: false, error: errors.join('; ') };
    }

    // Extract variables after successful validation
    for (const { contextKey, executionKey } of extractionPairs) {
      const value = this.extractFromResponse(executionKey, response);
      if (value !== undefined) {
        this.context.set(contextKey, value);
      }
    }

    return { passed: true, error: null };
  }

  /**
   * Validate from a JSON doc-string.
   * The JSON uses special syntax tokens (&isNotNull, $variable, CAS constraints, >contextKey: <executionKey).
   *
   * For JSON format, the expected doc is compared recursively against the actual response body.
   * Special keys: H"key" (header validation), B: (bare body validation).
   */
  validateFromJson(
    apiSpec: ApiSpec,
    summary: string,
    expectedStatus: number,
    expectedJsonDocString: string,
    response: LastResponseData,
  ): ValidationResult {
    // Validate status
    if (response.status !== expectedStatus) {
      return {
        passed: false,
        error: `HTTP 狀態碼不匹配: 預期 ${expectedStatus}, 實際 ${response.status}`,
      };
    }

    // Schema validation
    const schemaError = this.validateSchema(apiSpec, summary, expectedStatus, response.body);
    if (schemaError) return { passed: false, error: schemaError };

    const resolver = new SymbolResolver(this.context);
    const errors: string[] = [];
    const extractions: Array<{ contextKey: string; executionKey: string }> = [];

    // Parse the expected JSON doc
    const parsed = this.parseExpectedJsonDoc(expectedJsonDocString);

    // Validate headers (H"key")
    for (const [headerName, expectedVal] of Object.entries(parsed.headers)) {
      const actualVal = response.headers[headerName] ?? response.headers[headerName.toLowerCase()];
      const resolvedExpected = this.resolveJsonExpectedValue(expectedVal, resolver);
      const err = this.compareJsonValue(`H:${headerName}`, actualVal, resolvedExpected);
      if (err) errors.push(err);
    }

    // Validate bare body (B:)
    if (parsed.hasBareBody) {
      const resolvedExpected = this.resolveJsonExpectedValue(parsed.bareBody, resolver);
      const err = this.compareJsonValue('B:', response.body, resolvedExpected);
      if (err) errors.push(err);
    }

    // Variable extractions
    for (const { contextKey, executionKey } of parsed.extractions) {
      extractions.push({ contextKey, executionKey });
    }

    // Validate body fields recursively (only if no B: key)
    if (!parsed.hasBareBody) {
      const bodyErrors = this.validateJsonObject(parsed.bodyFields, response.body, resolver, '', extractions);
      errors.push(...bodyErrors);
    }

    if (errors.length > 0) {
      return { passed: false, error: errors.join('; ') };
    }

    // Extract variables after successful validation
    for (const { contextKey, executionKey } of extractions) {
      const value = this.extractFromResponse(executionKey, response);
      if (value !== undefined) {
        this.context.set(contextKey, value);
      }
    }

    return { passed: true, error: null };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────────

  private validateSchema(
    apiSpec: ApiSpec,
    summary: string,
    status: number,
    body: unknown,
  ): string | null {
    const op = apiSpec.findBySummary(summary);
    if (!op?.responses) return null;

    const responseSpec = op.responses[String(status)];
    if (!responseSpec?.schema) return null;

    // Use ajv-like validation (simple built-in)
    return this.validateAgainstSchema(body, responseSpec.schema, '');
  }

  private validateAgainstSchema(
    value: unknown,
    schema: ApiSchema,
    path: string,
  ): string | null {
    if (value === null) {
      return schema.nullable === true
        ? null
        : `型別不符 at '${path || 'root'}': 預期 ${schema.type ?? 'non-null'}, 實際 object (null)`;
    }

    const type = schema.type;

    if (type === 'object') {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return `型別不符 at '${path || 'root'}': 預期 object, 實際 ${typeof value}`;
      }
      const props = schema.properties;
      if (props) {
        const requiredProps = new Set(schema.required ?? []);
        for (const [k, propSchema] of Object.entries(props)) {
          const propPath = path ? `${path}.${k}` : k;
          const hasProp = Object.prototype.hasOwnProperty.call(value, k);
          if (!hasProp) {
            if (requiredProps.has(k)) {
              return `缺少必要欄位 at '${propPath}'`;
            }
            continue;
          }
          const propVal = (value as Record<string, unknown>)[k];
          if (propVal === null && !requiredProps.has(k) && propSchema.nullable !== true) {
            continue;
          }
          const err = this.validateAgainstSchema(propVal, propSchema, propPath);
          if (err) return err;
        }
      }
    } else if (type === 'array') {
      if (!Array.isArray(value)) {
        return `型別不符 at '${path || 'root'}': 預期 array, 實際 ${typeof value}`;
      }
      if (schema.items) {
        for (let index = 0; index < value.length; index += 1) {
          const err = this.validateAgainstSchema(value[index], schema.items, `${path}[${index}]`);
          if (err) return err;
        }
      }
    } else if (type === 'integer') {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        return `型別不符 at '${path || 'root'}': 預期 integer, 實際 ${typeof value} (${JSON.stringify(value)})`;
      }
    } else if (type === 'number') {
      if (typeof value !== 'number') {
        return `型別不符 at '${path || 'root'}': 預期 number, 實際 ${typeof value}`;
      }
    } else if (type === 'string') {
      if (typeof value !== 'string') {
        return `型別不符 at '${path || 'root'}': 預期 string, 實際 ${typeof value}`;
      }
    } else if (type === 'boolean') {
      if (typeof value !== 'boolean') {
        return `型別不符 at '${path || 'root'}': 預期 boolean, 實際 ${typeof value}`;
      }
    }

    return null;
  }

  private getBodyValue(body: unknown, fieldPath: string): unknown {
    if (body === null || body === undefined) return undefined;
    return getBracketValue(body, fieldPath);
  }

  /**
   * Get body value in JSON doc-string mode.
   * Tries direct key access first (for literal-dot keys like "app.version"),
   * then falls back to bracket-path navigation.
   */
  private getJsonBodyValue(body: unknown, key: string): unknown {
    if (body === null || body === undefined) return undefined;
    if (typeof body === 'object' && !Array.isArray(body)) {
      const directVal = (body as Record<string, unknown>)[key];
      if (directVal !== undefined) return directVal;
    }
    return getBracketValue(body, key);
  }

  private resolveExpectedValue(cellValue: string, resolver: SymbolResolver): unknown {
    return this.resolveExpectedValueWithFlag(cellValue, resolver).value;
  }

  private resolveExpectedValueWithFlag(
    cellValue: string,
    resolver: SymbolResolver,
  ): { value: unknown; isLiteral: boolean } {
    // Quoted string — strip quotes, treat as literal (no CAS)
    const trimmed = cellValue.trim();
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      return { value: trimmed.slice(1, -1), isLiteral: true };
    }
    return { value: resolver.resolveValue(cellValue), isLiteral: false };
  }

  private compareFieldValue(
    fieldName: string,
    actualValue: unknown,
    expectedStr: string,
    isLiteral = false,
  ): string | null {
    const trimmed = expectedStr.trim();

    // CAS constraint expression — only if not a literal quoted string
    if (!isLiteral && trimmed.startsWith('&')) {
      const passed = applyConstraints(actualValue, trimmed, this.context);
      if (!passed) {
        return `${fieldName}: CAS 驗證失敗 (${trimmed}), 實際值: ${JSON.stringify(actualValue)}`;
      }
      return null;
    }

    // Numeric comparison: if actual is a number and expected looks like a number
    if (typeof actualValue === 'number' && isFiniteDec(trimmed)) {
      if (!numericEqual(String(actualValue), trimmed)) {
        return `值不匹配 at '${fieldName}': 預期 ${trimmed}, 實際 ${JSON.stringify(actualValue)}`;
      }
      return null;
    }

    // JSON array/object comparison: if expected looks like JSON and actual is object/array
    if ((trimmed.startsWith('[') || trimmed.startsWith('{')) && (typeof actualValue === 'object' || Array.isArray(actualValue))) {
      try {
        const parsedExpected: unknown = JSON.parse(trimmed);
        const actualJson = JSON.stringify(actualValue);
        const expectedJson = JSON.stringify(parsedExpected);
        if (actualJson !== expectedJson) {
          return `值不匹配 at '${fieldName}': 預期 ${expectedJson}, 實際 ${actualJson}`;
        }
        return null;
      } catch {
        // fall through to string comparison
      }
    }

    // String comparison
    const actualStr = actualValue === null || actualValue === undefined
      ? ''
      : asString(actualValue);

    if (actualStr !== trimmed) {
      return `值不匹配 at '${fieldName}': 預期 ${trimmed}, 實際 ${JSON.stringify(actualValue)}`;
    }

    return null;
  }

  /**
   * Resolve an expected JSON value from the parsed doc-string,
   * handling $variable references.
   */
  private resolveJsonExpectedValue(value: unknown, resolver: SymbolResolver): unknown {
    // LiteralString — keep as literal but still allow ${var} interpolation (not CAS)
    if (value instanceof LiteralString) {
      const inner = value.value;
      // ${interpolation} — resolve it but keep as LiteralString to prevent CAS
      if (inner.includes('${')) {
        const resolved = resolver.resolveValue(inner) as string;
        return new LiteralString(typeof resolved === 'string' ? resolved : String(resolved));
      }
      return value; // keep LiteralString wrapper to prevent CAS
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      // $variable reference
      if (trimmed.startsWith('$') && !trimmed.startsWith('${')) {
        return resolver.resolveValue(trimmed);
      }
      // ${interpolation}
      if (trimmed.includes('${')) {
        return resolver.resolveValue(trimmed);
      }
      // CAS or &isNotNull — return as-is for comparison
      if (trimmed.startsWith('&')) {
        return trimmed;
      }
      return value;
    }
    return value;
  }

  /**
   * Compare a single field in JSON mode.
   */
  private compareJsonValue(
    fieldName: string,
    actualValue: unknown,
    expectedValue: unknown,
  ): string | null {
    // LiteralString — unwrap and do plain string comparison (no CAS)
    if (expectedValue instanceof LiteralString) {
      const literalStr = expectedValue.value;
      if (String(actualValue) !== literalStr) {
        return `值不匹配 at '${fieldName}': 預期 "${literalStr}", 實際 ${JSON.stringify(actualValue)}`;
      }
      return null;
    }

    // CAS constraint expression (string starting with &)
    if (typeof expectedValue === 'string' && expectedValue.trim().startsWith('&')) {
      const passed = applyConstraints(actualValue, expectedValue.trim(), this.context);
      if (!passed) {
        return `${fieldName}: CAS 驗證失敗 (${expectedValue}), 實際值: ${JSON.stringify(actualValue)}`;
      }
      return null;
    }

    // Numeric smart comparison
    if (typeof actualValue === 'number' && typeof expectedValue === 'number') {
      if (!numericEqual(String(actualValue), String(expectedValue))) {
        return `值不匹配 at '${fieldName}': 預期 ${JSON.stringify(expectedValue)}, 實際 ${JSON.stringify(actualValue)}`;
      }
      return null;
    }

    // String expected value that looks like a number
    if (typeof actualValue === 'number' && typeof expectedValue === 'string' && isFiniteDec(expectedValue.trim())) {
      if (!numericEqual(String(actualValue), expectedValue.trim())) {
        return `值不匹配 at '${fieldName}': 預期 ${expectedValue}, 實際 ${JSON.stringify(actualValue)}`;
      }
      return null;
    }

    // null comparison
    if (expectedValue === null) {
      if (actualValue !== null && actualValue !== undefined) {
        return `值不匹配 at '${fieldName}': 預期 null, 實際 ${JSON.stringify(actualValue)}`;
      }
      return null;
    }

    // boolean comparison
    if (typeof expectedValue === 'boolean') {
      if (actualValue !== expectedValue) {
        return `值不匹配 at '${fieldName}': 預期 ${expectedValue}, 實際 ${JSON.stringify(actualValue)}`;
      }
      return null;
    }

    // Array comparison
    if (Array.isArray(expectedValue)) {
      if (!Array.isArray(actualValue)) {
        return `值不匹配 at '${fieldName}': 預期 array, 實際 ${JSON.stringify(actualValue)}`;
      }
      if (expectedValue.length !== actualValue.length) {
        return `值不匹配 at '${fieldName}': 預期 ${expectedValue.length} 個元素, 實際 ${actualValue.length} 個元素`;
      }
      for (let i = 0; i < expectedValue.length; i++) {
        const err = this.compareJsonValue(`${fieldName}[${i}]`, actualValue[i], expectedValue[i]);
        if (err) return err;
      }
      return null;
    }

    // Object comparison — when expected is an object, just compare string values
    if (typeof expectedValue === 'object' && expectedValue !== null) {
      // Deep equal for embedded objects
      return this.deepCompareObjects(fieldName, actualValue, expectedValue as Record<string, unknown>);
    }

    // String comparison
    if (asString(actualValue) !== asString(expectedValue)) {
      return `值不匹配 at '${fieldName}': 預期 ${JSON.stringify(expectedValue)}, 實際 ${JSON.stringify(actualValue)}`;
    }

    return null;
  }

  private deepCompareObjects(
    path: string,
    actual: unknown,
    expected: Record<string, unknown>,
  ): string | null {
    if (typeof actual !== 'object' || actual === null || Array.isArray(actual)) {
      return `值不匹配 at '${path}': 預期 object, 實際 ${JSON.stringify(actual)}`;
    }
    const actualObj = actual as Record<string, unknown>;
    for (const [k, v] of Object.entries(expected)) {
      const fieldPath = path ? `${path}.${k}` : k;
      const err = this.compareJsonValue(fieldPath, actualObj[k], v);
      if (err) return err;
    }
    return null;
  }

  /**
   * Recursively validate a JSON object (expected) against actual response body.
   * Handles dot-notation string keys as paths into the actual body.
   * Collects extractions from nested objects via extraction markers (>key: <path).
   */
  private validateJsonObject(
    expected: Record<string, unknown>,
    actual: unknown,
    resolver: SymbolResolver,
    basePath: string,
    extractions?: Array<{ contextKey: string; executionKey: string }>,
  ): string[] {
    const errors: string[] = [];

    for (const [rawKey, rawExpectedVal] of Object.entries(expected)) {
      // Extraction marker — >contextKey: <executionKey (stored from parseExpectedObject)
      if (rawKey.startsWith('>') && typeof rawExpectedVal === 'string' && rawExpectedVal.startsWith('<')) {
        if (extractions) {
          const contextKey = rawKey.slice(1);
          const relativeKey = rawExpectedVal.slice(1);
          // If we're nested under a basePath, prefix the execution key with that path
          const executionKey = basePath ? `${basePath}.${relativeKey}` : relativeKey;
          extractions.push({ contextKey, executionKey });
        }
        continue;
      }

      // Dot-notation key into actual body? Only if key contains '.' or '['
      // For JSON mode, keys may look like "[0].name" (flat dot-notation into top-level array)
      const resolvedExpected = this.resolveJsonExpectedValue(rawExpectedVal, resolver);
      const fieldPath = basePath ? `${basePath}.${rawKey}` : rawKey;

      if (rawExpectedVal instanceof LiteralString) {
        // LiteralString — plain string comparison, no CAS (resolvedExpected has ${var} resolved)
        const actualVal = this.getJsonBodyValue(actual, rawKey);
        const err = this.compareJsonValue(fieldPath, actualVal, resolvedExpected);
        if (err) errors.push(err);
      } else if (typeof rawExpectedVal === 'object' && rawExpectedVal !== null && !Array.isArray(rawExpectedVal)) {
        // Nested object — recurse
        const actualNested = this.getJsonBodyValue(actual, rawKey);
        const nestedErrors = this.validateJsonObject(
          rawExpectedVal as Record<string, unknown>,
          actualNested,
          resolver,
          fieldPath,
          extractions,
        );
        errors.push(...nestedErrors);
      } else if (Array.isArray(rawExpectedVal)) {
        const actualVal = this.getBodyValue(actual, rawKey);
        const err = this.compareJsonValue(fieldPath, actualVal, rawExpectedVal);
        if (err) errors.push(err);
      } else {
        // Try direct key access first (handles literal dot keys like "app.version")
        // Then fall back to path navigation for path expressions
        let actualVal: unknown;
        if (typeof actual === 'object' && actual !== null && !Array.isArray(actual)) {
          const directVal = (actual as Record<string, unknown>)[rawKey];
          if (directVal !== undefined) {
            actualVal = directVal;
          } else if (rawKey.startsWith('[') || rawKey.includes('.')) {
            // Key not found directly, try as path
            actualVal = getBracketValue(actual, rawKey);
          } else {
            actualVal = directVal; // undefined
          }
        } else if (rawKey.startsWith('[')) {
          actualVal = getBracketValue(actual, rawKey);
        } else {
          actualVal = this.getBodyValue(actual, rawKey);
        }
        const err = this.compareJsonValue(fieldPath, actualVal, resolvedExpected);
        if (err) errors.push(err);
      }
    }

    return errors;
  }

  /**
   * Extract a value from the response using an execution key path.
   */
  private extractFromResponse(executionKey: string, response: LastResponseData): unknown {
    // H: prefix — extract from response header
    if (executionKey.startsWith('H:')) {
      const headerName = executionKey.slice(2);
      const headerValue = response.headers[headerName] ?? response.headers[headerName.toLowerCase()];
      if (headerValue === undefined) {
        throw new SpecFormulaLookupError({
          code: 'SYMBOL_VAR_EXECUTION_KEY_NOT_FOUND',
          details: { key: headerName },
        });
      }
      return headerValue;
    }
    // H"name" — JSON doc variant
    if (executionKey.startsWith('H"') && executionKey.endsWith('"')) {
      const headerName = executionKey.slice(2, -1);
      const headerValue = response.headers[headerName] ?? response.headers[headerName.toLowerCase()];
      if (headerValue === undefined) {
        throw new SpecFormulaLookupError({
          code: 'SYMBOL_VAR_EXECUTION_KEY_NOT_FOUND',
          details: { key: headerName },
        });
      }
      return headerValue;
    }
    // B: — bare body
    if (executionKey === 'B:') {
      return response.body;
    }

    // Body field extraction
    const body = response.body;
    if (body === null || body === undefined) return undefined;
    return getBracketValue(body, executionKey);
  }

  /**
   * Parse the expected JSON doc-string for JSON format validation.
   * Handles H"key", B:, >contextKey: <executionKey, and regular body fields.
   */
  parseExpectedJsonDoc(docString: string): {
    headers: Record<string, unknown>;
    bareBody: unknown;
    hasBareBody: boolean;
    extractions: Array<{ contextKey: string; executionKey: string }>;
    bodyFields: Record<string, unknown>;
  } {
    const headers: Record<string, unknown> = {};
    let bareBody: unknown = undefined;
    let hasBareBody = false;
    const extractions: Array<{ contextKey: string; executionKey: string }> = [];
    const bodyFields: Record<string, unknown> = {};

    const trimmed = docString.trim();

    // Top-level array — treat as body (no special keys)
    if (trimmed.startsWith('[')) {
      bareBody = this.parseExpectedArray(trimmed);
      hasBareBody = true;
      return { headers, bareBody, hasBareBody, extractions, bodyFields };
    }

    if (!trimmed.startsWith('{')) {
      return { headers, bareBody, hasBareBody, extractions, bodyFields };
    }

    // Split entries
    const entries = this.splitJsonDocEntries(trimmed);

    for (const entry of entries) {
      const parsed = this.parseExpectedEntry(entry);
      if (!parsed) continue;

      switch (parsed.keyType) {
        case 'H':
          headers[parsed.key] = parsed.value;
          break;
        case 'B':
          bareBody = parsed.value;
          hasBareBody = true;
          break;
        case 'extraction':
          extractions.push({ contextKey: parsed.key, executionKey: String(parsed.value) });
          break;
        default:
          bodyFields[parsed.key] = parsed.value;
          break;
      }
    }

    return { headers, bareBody, hasBareBody, extractions, bodyFields };
  }

  /**
   * Split a JSON object doc-string into top-level key-value entry strings.
   */
  private splitJsonDocEntries(docString: string): string[] {
    const trimmed = docString.trim();
    if (!trimmed.startsWith('{')) return [];

    // Find inner content
    let depth = 0;
    let start = -1;
    let end = -1;
    for (let i = 0; i < trimmed.length; i++) {
      if (trimmed[i] === '{') {
        depth++;
        if (depth === 1) start = i + 1;
      } else if (trimmed[i] === '}') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (start === -1 || end === -1) return [];
    const inner = trimmed.slice(start, end);

    return this.splitAtDepth0Commas(inner);
  }

  private splitAtDepth0Commas(inner: string): string[] {
    const entries: string[] = [];
    let current = '';
    let depth = 0;
    let parenDepth = 0;
    let inString = false;
    let stringChar = '';

    for (let i = 0; i < inner.length; i++) {
      const c = inner[i];
      if (inString) {
        current += c;
        if (c === stringChar && inner[i - 1] !== '\\') inString = false;
        continue;
      }
      if (c === '"' || c === "'") { inString = true; stringChar = c; current += c; continue; }
      if (c === '{' || c === '[') { depth++; current += c; continue; }
      if (c === '}' || c === ']') { depth--; current += c; continue; }
      if (c === '(') { parenDepth++; current += c; continue; }
      if (c === ')') { parenDepth--; current += c; continue; }
      if (c === ',' && depth === 0 && parenDepth === 0) {
        const t = current.trim();
        if (t) entries.push(t);
        current = '';
        continue;
      }
      current += c;
    }
    const last = current.trim();
    if (last) entries.push(last);
    return entries;
  }

  /**
   * Parse a single entry from the expected JSON doc.
   */
  private parseExpectedEntry(
    entry: string,
  ): { keyType: string; key: string; value: unknown } | null {
    const trimmed = entry.trim();
    if (!trimmed) return null;

    // H"key": value
    const hMatch = /^H"([^"]+)"\s*:\s*(.*)$/s.exec(trimmed);
    if (hMatch) {
      return { keyType: 'H', key: hMatch[1], value: this.parseExpectedValue(hMatch[2].trim()) };
    }

    // B: value
    const bMatch = /^B\s*:\s*(.*)$/s.exec(trimmed);
    if (bMatch) {
      return { keyType: 'B', key: 'B:', value: this.parseExpectedValue(bMatch[1].trim()) };
    }

    // >contextKey: <executionKey
    const extractMatch = /^>([^\s:,]+)\s*:\s*<(.+)$/.exec(trimmed);
    if (extractMatch) {
      return {
        keyType: 'extraction',
        key: extractMatch[1],
        value: extractMatch[2].replace(/,$/, '').trim(),
      };
    }

    // "key": value
    const quotedMatch = /^"([^"]+)"\s*:\s*(.*)$/s.exec(trimmed);
    if (quotedMatch) {
      return {
        keyType: 'body',
        key: quotedMatch[1],
        value: this.parseExpectedValue(quotedMatch[2].trim()),
      };
    }

    // Unquoted key: value (e.g., [0].name: "A")
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx !== -1) {
      const key = trimmed.slice(0, colonIdx).trim();
      const rawVal = trimmed.slice(colonIdx + 1).trim();
      if (key && !key.startsWith('"')) {
        return { keyType: 'body', key, value: this.parseExpectedValue(rawVal) };
      }
    }

    return null;
  }

  /**
   * Parse an expected value token from the JSON doc.
   * Handles CAS (&isNotNull, &gt(...)), $variable, JSON values.
   */
  private parseExpectedValue(raw: string): unknown {
    const trimmed = raw.replace(/,$/, '').trim();
    if (!trimmed) return '';

    // null
    if (trimmed === 'null') return null;
    // boolean
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    // number
    if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(trimmed)) return Number(trimmed);
    // JSON quoted string — wrap as LiteralString to prevent CAS interpretation
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      try {
        const inner = parseJsonString(trimmed, 'expected string');
        return new LiteralString(inner);
      } catch {
        return new LiteralString(trimmed.slice(1, -1));
      }
    }
    // JSON array
    if (trimmed.startsWith('[')) {
      return this.parseExpectedArray(trimmed);
    }
    // JSON object — parse recursively so nested CAS / variable refs are preserved
    if (trimmed.startsWith('{')) {
      return this.parseExpectedObject(trimmed);
    }

    // CAS, $variable, unquoted — return as-is string
    return trimmed;
  }

  /**
   * Parse a JSON-like object that may contain non-JSON values (CAS constraints, $variables).
   * Returns an object with body fields and extractions.
   */
  private parseExpectedObject(raw: string): unknown {
    const trimmed = raw.trim();
    if (!trimmed.startsWith('{')) return trimmed;

    const entries = this.splitJsonDocEntries(trimmed);
    const result: Record<string, unknown> = {};
    for (const entry of entries) {
      const parsed = this.parseExpectedEntry(entry);
      if (!parsed) continue;
      if (parsed.keyType === 'body') {
        result[parsed.key] = parsed.value;
      } else if (parsed.keyType === 'extraction') {
        // Store extraction markers as special objects for later processing
        result[`>${parsed.key}`] = `<${String(parsed.value)}`;
      }
    }
    return result;
  }

  private parseExpectedArray(raw: string): unknown[] | string {
    const trimmed = raw.trim();
    if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return trimmed;

    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return [];

    return this.splitAtDepth0Commas(inner).map((entry) => this.parseExpectedValue(entry));
  }
}

function isFiniteDec(s: string): boolean {
  const n = Number(s);
  return isFinite(n) && s.trim() !== '';
}
