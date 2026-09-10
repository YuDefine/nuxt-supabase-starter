// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/instruction/ApiCall.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/instruction/ApiCall.ts
import type { HttpClientAdapter, TestRequest, TestResponse } from '../http/HttpClientAdapter.js';
import type { ScenarioContext, LastResponseData } from '../context/ScenarioContext.js';
import type { ApiSpec } from '../spec/model/ApiSpec.js';
import { SymbolResolver } from '../helper/SymbolResolver.js';
import {
  SpecFormulaArgumentError,
  SpecFormulaLookupError,
} from '../error/SpecFormulaError.js';
import { TimeService, DateTimeTZ, DateOnly, TimeOnly } from '../helper/TimeService.js';
import { getNestedValue } from '../helper/utils/nested-path.js';
import { parseColumnPrefix } from '../helper/utils/column-prefix.js';
import { setBracketValue } from '../helper/utils/bracket-path.js';
import { asString } from '../helper/utils/string-coerce.js';

/**
 * Time format options for converting time values in request parameters.
 */
export type TimeFormat = 'ISO' | 'TIMESTAMP' | 'EPOCH' | 'DATE_ONLY' | 'TIME_ONLY';

/**
 * Result of parsing a JSON doc-string with P"/Q"/H" prefixed keys.
 */
export interface ParsedJsonDoc {
  pathParams: Record<string, unknown>;
  queryParams: Record<string, unknown>;
  headers: Record<string, unknown>;
  /** Bare body value (from B: key) — null means no B: present */
  bareBody: unknown;
  hasBareBody: boolean;
  /** Context var extractions: >key -> <path */
  extractions: Array<{ contextKey: string; executionKey: string }>;
  /** Remaining body fields (no prefix) */
  bodyFields: Record<string, unknown>;
}

/**
 * ApiCall — executes HTTP requests based on ApiSpec and DataTable/JSON inputs.
 *
 * Responsibilities:
 *  - Parse P:/Q:/H:/B: column prefixes (DataTable) or P"/Q"/H"/B: key prefixes (JSON)
 *  - Build nested JSON body via dot-notation / array indices
 *  - Resolve $var, @time, ${interpolation} in cell values
 *  - Support WithActor (auth token → Authorization header) and WithoutActor modes
 *  - Execute via HttpClientAdapter
 *  - Store response in ScenarioContext (lastResponse)
 *  - Extract values via >contextKey / <executionKey
 */
export class ApiCall {
  constructor(
    private readonly httpClient: HttpClientAdapter,
    private readonly context: ScenarioContext,
    private readonly timeFormat: TimeFormat = 'ISO',
  ) {}

  /**
   * Execute an API call from a DataTable.
   *
   * @param apiSpec  The ApiSpec to look up the operation by summary
   * @param summary  Operation summary name
   * @param headers  DataTable header row (column names, possibly with P:/Q:/H:/B: prefixes)
   * @param rows     DataTable data rows
   * @param token    Optional auth token (null = WithoutActor)
   */
  async executeFromDataTable(
    apiSpec: ApiSpec,
    summary: string,
    headers: Array<string | null>,
    rows: Array<Array<string | null>>,
    token: string | null,
  ): Promise<TestResponse> {
    const operation = apiSpec.findBySummary(summary);
    if (!operation) {
      throw new SpecFormulaLookupError({
        code: 'EXEC_API_OPERATION_NOT_FOUND',
        details: { summary },
      });
    }

    // Check for B: column presence
    const bColIdx = headers.findIndex((h) => h !== null && parseColumnPrefix(h).prefix === 'B');
    const hasBCol = bColIdx !== -1;

    // If B: is present, ensure no unprefixed body columns exist in the SAME row
    if (hasBCol) {
      const hasUnprefixedBody = headers.some((h) => {
        if (!h) return false;
        const { prefix } = parseColumnPrefix(h);
        // >contextKey is not a body column
        if (h.startsWith('>')) return false;
        return prefix === null;
      });
      if (hasUnprefixedBody) {
        throw new SpecFormulaArgumentError({
          code: 'EXEC_API_BODY_HEADER_CONFLICT',
          details: {},
        });
      }
    }

    // Parse context key columns (>contextKey)
    const resolver = new SymbolResolver(this.context);
    const contextKeyMap = resolver.parseContextKeys(headers);

    // Collect names that have explicit P:/Q:/H: prefixes so unprefixed columns don't auto-route
    const explicitPrefixNames = new Set<string>();
    for (const h of headers) {
      if (!h) continue;
      const { prefix, name } = parseColumnPrefix(h);
      if (prefix === 'P' || prefix === 'Q' || prefix === 'H') {
        explicitPrefixNames.add(name);
      }
    }

    // Use only first data row (DataTable for API call is single-row)
    // But handle empty tables (0 or 1 rows with all-null headers)
    const dataRow = rows.length > 0 ? rows[0] : [];

    // Determine if table is effectively empty
    const nonNullHeaders = headers.filter((h) => h !== null && h.trim() !== '');
    const isEmptyTable = nonNullHeaders.length === 0;

    const pathParams: Record<string, string> = {};
    const queryParams: Record<string, string> = {};
    const requestHeaders: Record<string, string> = {};
    const bodyObj: Record<string, unknown> = {};
    let bareBodyValue: unknown = undefined;
    let hasBareBody = false;

    if (!isEmptyTable) {
      for (let i = 0; i < headers.length; i++) {
        const header = headers[i];
        if (!header || header.trim() === '') continue;

        // Skip >contextKey columns — they are extraction markers
        if (header.startsWith('>')) continue;

        const rawCell = i < dataRow.length ? dataRow[i] : null;

        // Skip extraction marker cells (<executionKey)
        if (rawCell !== null && rawCell !== undefined && String(rawCell).startsWith('<')) continue;

        const { prefix, name } = parseColumnPrefix(header);

        // Resolve the cell value — try time expression first, then symbol resolver
        let resolvedValue: unknown;
        const rawCellStr = rawCell != null ? String(rawCell).trim() : null;
        if (rawCellStr && (rawCellStr.startsWith('@time(') || rawCellStr.startsWith('@date(') || rawCellStr.startsWith('@localtime('))) {
          resolvedValue = TimeService.resolveTimeExpression(rawCellStr, this.context);
        } else {
          resolvedValue = resolver.resolveValue(rawCell);
        }
        if (resolvedValue === null) continue;

        const strValue = this.formatTimeValue(resolvedValue);

        switch (prefix) {
          case 'P':
            pathParams[name] = strValue;
            break;
          case 'Q':
            queryParams[name] = strValue;
            break;
          case 'H':
            requestHeaders[name] = strValue;
            break;
          case 'B':
            // Bare body value — parse as JSON if looks like object/array/boolean/number
            bareBodyValue = this.parseBareBodyValue(strValue);
            hasBareBody = true;
            break;
          default: {
            // No prefix — auto-route only if no explicit P:/Q:/H: column covers this name
            let routedToNonBody = false;
            if (!explicitPrefixNames.has(name)) {
              const paramDef = operation.parameters?.find((p) => p.name === name) ?? null;
              if (paramDef) {
                if (paramDef.in === 'path') {
                  pathParams[name] = strValue;
                  routedToNonBody = true;
                } else if (paramDef.in === 'query') {
                  queryParams[name] = strValue;
                  routedToNonBody = true;
                } else if (paramDef.in === 'header') {
                  requestHeaders[name] = strValue;
                  routedToNonBody = true;
                }
              }
            }
            const shouldKeepOutOfBody =
              routedToNonBody &&
              (operation.method.toUpperCase() === 'GET' || operation.method.toUpperCase() === 'HEAD');
            if (!shouldKeepOutOfBody) {
              const bodyValue = this.convertBodyValue(strValue);
              setBracketValue(bodyObj, name, bodyValue);
            }
            break;
          }
        }
      }
    }

    // Build URL
    let url = operation.path;
    for (const [key, val] of Object.entries(pathParams)) {
      url = url.replace(`{${key}}`, encodeURIComponent(val));
    }

    // Add Authorization header if WithActor
    if (token !== null) {
      requestHeaders['Authorization'] = `Bearer ${token}`;
    }

    // Determine body
    let body: unknown;
    if (hasBareBody) {
      body = bareBodyValue;
    } else {
      body = Object.keys(bodyObj).length > 0 ? bodyObj : undefined;
    }

    const request: TestRequest = {
      method: operation.method,
      url,
      headers: requestHeaders,
      queryParams,
      body,
    };

    const response = await this.httpClient.execute(request);

    // Store response in context
    const lastResponse: LastResponseData = {
      status: response.status,
      headers: response.headers,
      body: response.body,
      rawBody: response.rawBody,
    };
    this.context.setLastResponse(lastResponse);

    // Extract variables from response using >contextKey / <executionKey
    if (contextKeyMap.size > 0) {
      this.extractVariables(contextKeyMap, headers, dataRow, response);
    }

    return response;
  }

  /**
   * Execute an API call from a JSON doc-string.
   * The JSON may contain P"key", Q"key", H"key" prefixed keys,
   * and B: for bare body, >contextKey: <executionKey for variable extraction.
   */
  async executeFromJson(
    apiSpec: ApiSpec,
    summary: string,
    jsonDocString: string,
    token: string | null,
  ): Promise<TestResponse> {
    const operation = apiSpec.findBySummary(summary);
    if (!operation) {
      throw new SpecFormulaLookupError({
        code: 'EXEC_API_OPERATION_NOT_FOUND',
        details: { summary },
      });
    }

    const parsed = this.parseJsonDoc(jsonDocString);

    // If B: and unprefixed body fields both exist — error
    if (parsed.hasBareBody && Object.keys(parsed.bodyFields).length > 0) {
      throw new SpecFormulaArgumentError({
        code: 'EXEC_API_BODY_HEADER_CONFLICT',
        details: {},
      });
    }

    const resolver = new SymbolResolver(this.context);

    // Resolve path params
    const pathParams: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed.pathParams)) {
      const resolved = this.resolveWithTime(resolver, v);
      pathParams[k] = this.formatTimeValue(resolved);
    }

    // Resolve query params
    const queryParams: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed.queryParams)) {
      const resolved = this.resolveWithTime(resolver, v);
      queryParams[k] = this.formatTimeValue(resolved);
    }

    // Resolve headers
    const requestHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed.headers)) {
      const resolved = this.resolveWithTime(resolver, v);
      requestHeaders[k] = this.formatTimeValue(resolved);
    }

    // Build body from body fields (auto-route to path/query based on operation params)
    // Collect names that have explicit P/Q/H prefix so unprefixed fields don't override them
    const jsonExplicitPrefixNames = new Set<string>(
      Object.keys(parsed.pathParams).concat(Object.keys(parsed.queryParams)).concat(Object.keys(parsed.headers))
    );

    const bodyObj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(parsed.bodyFields)) {
      const resolved = this.resolveWithTime(resolver, v);

      // If resolved is already an object/array, use directly (don't stringify/path-route)
      if (resolved !== null && typeof resolved === 'object' && !(resolved instanceof DateTimeTZ) && !(resolved instanceof DateOnly) && !(resolved instanceof TimeOnly)) {
        // Use direct key assignment to preserve literal dot keys from JSON
        bodyObj[k] = this.normalizeBodyValue(resolved);
        continue;
      }

      const strValue = this.formatTimeValue(resolved);

      // Auto-route to path/query only if no explicit P/Q prefix covers this name
      let routedToNonBody = false;
      if (!jsonExplicitPrefixNames.has(k)) {
        const paramDef = operation.parameters?.find((p) => p.name === k) ?? null;
        if (paramDef) {
          if (paramDef.in === 'path') {
            pathParams[k] = strValue;
            routedToNonBody = true;
          } else if (paramDef.in === 'query') {
            queryParams[k] = strValue;
            routedToNonBody = true;
          } else if (paramDef.in === 'header') {
            requestHeaders[k] = strValue;
            routedToNonBody = true;
          }
        }
      }
      const shouldKeepOutOfBody =
        routedToNonBody &&
        (operation.method.toUpperCase() === 'GET' || operation.method.toUpperCase() === 'HEAD');
      if (!shouldKeepOutOfBody) {
        const bodyValue = this.convertBodyValue(strValue);
        // Use direct key for JSON body (keys may have literal dots from JSON syntax)
        bodyObj[k] = bodyValue;
      }
    }

    // Add Authorization header if WithActor
    if (token !== null) {
      requestHeaders['Authorization'] = `Bearer ${token}`;
    }

    // Build URL
    let url = operation.path;
    for (const [key, val] of Object.entries(pathParams)) {
      url = url.replace(`{${key}}`, encodeURIComponent(val));
    }

    // Determine body
    let body: unknown;
    if (parsed.hasBareBody) {
      // Resolve bare body value
      const resolvedBare = this.resolveWithTime(resolver, parsed.bareBody);
      body = this.normalizeBodyValue(resolvedBare);
      // If it's a string that looks like JSON array/object, parse it
      if (typeof body === 'string') {
        const trimmed = (body).trim();
        if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
          try {
            body = JSON.parse(trimmed);
          } catch {
            // keep as string
          }
        }
      }
    } else if (Object.keys(bodyObj).length > 0) {
      body = bodyObj;
    } else {
      body = undefined;
    }

    const request: TestRequest = {
      method: operation.method,
      url,
      headers: requestHeaders,
      queryParams,
      body,
    };

    const response = await this.httpClient.execute(request);

    // Store response in context
    const lastResponse: LastResponseData = {
      status: response.status,
      headers: response.headers,
      body: response.body,
      rawBody: response.rawBody,
    };
    this.context.setLastResponse(lastResponse);

    // Extract variables from response
    if (parsed.extractions.length > 0) {
      for (const { contextKey, executionKey } of parsed.extractions) {
        const value = this.extractFromResponse(executionKey, response);
        if (value !== undefined) {
          this.context.set(contextKey, value);
        }
      }
    }

    return response;
  }

  // ─── Private helpers ──────────────────────────────────────────────────────────

  /**
   * Extract variables from response using DataTable context keys and execution keys.
   */
  private extractVariables(
    contextKeyMap: Map<number, string>,
    headers: Array<string | null>,
    dataRow: Array<string | null>,
    response: TestResponse,
  ): void {
    for (const [colIdx, contextKey] of contextKeyMap.entries()) {
      if (colIdx >= dataRow.length) continue;
      const executionKey = dataRow[colIdx];
      if (!executionKey || !executionKey.startsWith('<')) continue;

      const keyPath = executionKey.slice(1); // strip leading '<'
      const value = this.extractFromResponse(keyPath, response);
      if (value !== undefined) {
        this.context.set(contextKey, value);
      }
    }
  }

  /**
   * Extract a value from the response using an execution key path.
   * Supports:
   *   - <H:HeaderName  — response header
   *   - <H"HeaderName" — response header (JSON DocString syntax)
   *   - <fieldPath     — response body field
   *   - <[0].field     — top-level array element field
   */
  private extractFromResponse(keyPath: string, response: TestResponse): unknown {
    // Header extraction: H:HeaderName or H"HeaderName"
    if (keyPath.startsWith('H:')) {
      const headerName = keyPath.slice(2);
      const headerVal = response.headers[headerName] ?? response.headers[headerName.toLowerCase()];
      if (headerVal === undefined) {
        throw new SpecFormulaLookupError({
          code: 'SYMBOL_VAR_EXECUTION_KEY_NOT_FOUND',
          details: { key: headerName },
        });
      }
      return headerVal;
    }
    if (keyPath.startsWith('H"') && keyPath.endsWith('"')) {
      const headerName = keyPath.slice(2, -1);
      const headerVal = response.headers[headerName] ?? response.headers[headerName.toLowerCase()];
      if (headerVal === undefined) {
        throw new SpecFormulaLookupError({
          code: 'SYMBOL_VAR_EXECUTION_KEY_NOT_FOUND',
          details: { key: headerName },
        });
      }
      return headerVal;
    }
    // B: — bare body extraction
    if (keyPath === 'B:') {
      return response.body;
    }

    // Body field extraction
    const body = response.body;
    if (body === null || body === undefined) return undefined;

    const value = getNestedValue(body, keyPath);
    return value;
  }

  /**
   * Resolve a value, handling @time()/@date()/@localtime() expressions before symbol resolution.
   */
  private resolveWithTime(resolver: SymbolResolver, value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.resolveWithTime(resolver, item));
    }

    if (
      value !== null &&
      typeof value === 'object' &&
      !(value instanceof DateTimeTZ) &&
      !(value instanceof DateOnly) &&
      !(value instanceof TimeOnly)
    ) {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [
          key,
          this.resolveWithTime(resolver, nestedValue),
        ]),
      );
    }

    const strVal = value != null ? asString(value).trim() : null;
    if (strVal && (strVal.startsWith('@time(') || strVal.startsWith('@date(') || strVal.startsWith('@localtime('))) {
      return TimeService.resolveTimeExpression(strVal, this.context);
    }
    return resolver.resolveValue(value);
  }

  /**
   * Format a resolved value to string, applying time format conversion for time types.
   */
  private formatTimeValue(value: unknown): string {
    if (value instanceof DateTimeTZ) {
      return this.convertTimeToFormat(value);
    }
    if (value instanceof DateOnly) {
      return this.convertDateOnlyToFormat(value);
    }
    if (value instanceof TimeOnly) {
      return this.convertTimeOnlyToFormat(value);
    }
    return asString(value ?? '');
  }

  private normalizeBodyValue(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.normalizeBodyValue(item));
    }

    if (
      value !== null &&
      typeof value === 'object' &&
      !(value instanceof DateTimeTZ) &&
      !(value instanceof DateOnly) &&
      !(value instanceof TimeOnly)
    ) {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [
          key,
          this.normalizeBodyValue(nestedValue),
        ]),
      );
    }

    if (value instanceof DateTimeTZ || value instanceof DateOnly || value instanceof TimeOnly) {
      return this.formatTimeValue(value);
    }

    if (typeof value === 'string') {
      return this.convertBodyValue(value);
    }

    return value;
  }

  private convertTimeToFormat(dt: DateTimeTZ): string {
    switch (this.timeFormat) {
      case 'ISO':
        return dt.toString();
      case 'TIMESTAMP':
        return String(dt.toMillis());
      case 'EPOCH':
        return String(Math.floor(dt.toMillis() / 1000));
      case 'DATE_ONLY':
        return dt.dt.toISODate() ?? dt.toString();
      case 'TIME_ONLY': {
        const hh = String(dt.hour).padStart(2, '0');
        const mm = String(dt.minute).padStart(2, '0');
        const ss = String(dt.second).padStart(2, '0');
        return `${hh}:${mm}:${ss}`;
      }
      default:
        throw new SpecFormulaArgumentError({
          code: 'EXEC_API_TIME_FORMAT_UNSUPPORTED',
          details: {
            format: String(this.timeFormat),
            allowed: 'ISO, TIMESTAMP, EPOCH, DATE_ONLY, TIME_ONLY',
          },
        });
    }
  }

  private convertDateOnlyToFormat(d: DateOnly): string {
    switch (this.timeFormat) {
      case 'ISO':
        return d.toString();
      case 'TIMESTAMP':
        return String(d.dt.startOf('day').toMillis());
      case 'EPOCH':
        return String(Math.floor(d.dt.startOf('day').toMillis() / 1000));
      case 'DATE_ONLY':
        return d.toString();
      case 'TIME_ONLY':
        return '00:00:00';
      default:
        throw new SpecFormulaArgumentError({
          code: 'EXEC_API_TIME_FORMAT_UNSUPPORTED',
          details: {
            format: String(this.timeFormat),
            allowed: 'ISO, TIMESTAMP, EPOCH, DATE_ONLY, TIME_ONLY',
          },
        });
    }
  }

  private convertTimeOnlyToFormat(t: TimeOnly): string {
    switch (this.timeFormat) {
      case 'ISO':
        return t.toString();
      case 'TIMESTAMP':
        return String(t.dt.toMillis());
      case 'EPOCH':
        return String(Math.floor(t.dt.toMillis() / 1000));
      case 'DATE_ONLY':
        return t.dt.toISODate() ?? t.toString();
      case 'TIME_ONLY': {
        const hh = String(t.hour).padStart(2, '0');
        const mm = String(t.minute).padStart(2, '0');
        const ss = String(t.second).padStart(2, '0');
        return `${hh}:${mm}:${ss}`;
      }
      default:
        throw new SpecFormulaArgumentError({
          code: 'EXEC_API_TIME_FORMAT_UNSUPPORTED',
          details: {
            format: String(this.timeFormat),
            allowed: 'ISO, TIMESTAMP, EPOCH, DATE_ONLY, TIME_ONLY',
          },
        });
    }
  }

  /**
   * Parse a bare body value string into its JS type.
   * JSON arrays/objects are parsed; booleans recognized; otherwise string.
   */
  private parseBareBodyValue(value: string): unknown {
    const trimmed = value.trim();
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    if (trimmed === 'null') return null;
    if (!isNaN(Number(trimmed)) && trimmed !== '') return Number(trimmed);
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        return JSON.parse(trimmed);
      } catch {
        // return as string
      }
    }
    return trimmed;
  }

  /**
   * Convert a string body value to its appropriate JS type.
   * Numbers, booleans, JSON arrays/objects are converted.
   */
  private convertBodyValue(value: string): unknown {
    const trimmed = value.trim();
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    if (trimmed === 'null') return null;
    if (!isNaN(Number(trimmed)) && trimmed !== '') return Number(trimmed);
    // Try JSON parse for arrays/objects
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        return JSON.parse(trimmed);
      } catch {
        // return as string
      }
    }
    return trimmed;
  }

  /**
   * Parse a JSON doc-string that may contain special non-standard keys:
   *   P"key": value       → path param
   *   Q"key": value       → query param
   *   H"key": value       → header
   *   B: value            → bare body (may be object, array, primitive)
   *   >contextKey: <executionKey  → variable extraction
   *   "normalKey": value  → body field
   *   normalKey: value    → body field (unquoted JSON-like)
   *
   * The doc-string may not be valid JSON; we handle the special syntax manually.
   */
  parseJsonDoc(jsonDocString: string): ParsedJsonDoc {
    const pathParams: Record<string, unknown> = {};
    const queryParams: Record<string, unknown> = {};
    const headers: Record<string, unknown> = {};
    const bodyFields: Record<string, unknown> = {};
    const extractions: Array<{ contextKey: string; executionKey: string }> = [];
    let bareBody: unknown = undefined;
    let hasBareBody = false;

    // Pre-process: handle top-level array (pure JSON array)
    const trimmed = jsonDocString.trim();
    if (trimmed.startsWith('[')) {
      // Pure top-level array — treat as bare body
      try {
        bareBody = JSON.parse(trimmed);
        hasBareBody = true;
        return { pathParams, queryParams, headers, bareBody, hasBareBody, extractions, bodyFields };
      } catch {
        // fall through to line-by-line parsing
      }
    }

    // Parse line by line — each line is "key: value," or "\"key\": value,"
    // We use a custom tokenizer to handle the special syntax
    const lines = this.splitJsonDocLines(jsonDocString);

    for (const line of lines) {
      const entry = this.parseJsonDocLine(line);
      if (!entry) continue;

      const { keyType, key, value } = entry;

      switch (keyType) {
        case 'P':
          pathParams[key] = value;
          break;
        case 'Q':
          queryParams[key] = value;
          break;
        case 'H':
          headers[key] = value;
          break;
        case 'B':
          bareBody = value;
          hasBareBody = true;
          break;
        case 'extraction':
          extractions.push({ contextKey: key, executionKey: String(value) });
          break;
        default:
          bodyFields[key] = value;
          break;
      }
    }

    return { pathParams, queryParams, headers, bareBody, hasBareBody, extractions, bodyFields };
  }

  /**
   * Split a JSON-doc-string into lines representing key-value pairs.
   * We strip the outer { } and split by commas at depth 0.
   */
  private splitJsonDocLines(docString: string): string[] {
    const trimmed = docString.trim();
    // Remove outer braces
    if (!trimmed.startsWith('{')) return [];

    // Find the matching closing brace
    let depth = 0;
    let start = -1;
    let end = -1;
    for (let i = 0; i < trimmed.length; i++) {
      if (trimmed[i] === '{') {
        depth++;
        if (depth === 1) start = i + 1;
      } else if (trimmed[i] === '}') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }

    if (start === -1 || end === -1) return [];
    const inner = trimmed.slice(start, end);

    // Split by commas at depth 0 (track parens to handle &constraint(a,b) syntax)
    const entries: string[] = [];
    let current = '';
    depth = 0;
    let parenDepth = 0;
    let inString = false;
    let stringChar = '';

    for (let i = 0; i < inner.length; i++) {
      const c = inner[i];

      if (inString) {
        current += c;
        if (c === stringChar && inner[i - 1] !== '\\') {
          inString = false;
        }
        continue;
      }

      if (c === '"' || c === "'") {
        inString = true;
        stringChar = c;
        current += c;
        continue;
      }

      if (c === '{' || c === '[') {
        depth++;
        current += c;
        continue;
      }

      if (c === '}' || c === ']') {
        depth--;
        current += c;
        continue;
      }

      if (c === '(') {
        parenDepth++;
        current += c;
        continue;
      }

      if (c === ')') {
        parenDepth--;
        current += c;
        continue;
      }

      if (c === ',' && depth === 0 && parenDepth === 0) {
        const trimmedEntry = current.trim();
        if (trimmedEntry) entries.push(trimmedEntry);
        current = '';
        continue;
      }

      current += c;
    }

    const lastEntry = current.trim();
    if (lastEntry) entries.push(lastEntry);

    return entries;
  }

  /**
   * Parse a single JSON doc-string entry line.
   * Returns null if the line cannot be parsed.
   */
  private parseJsonDocLine(
    line: string,
  ): { keyType: string; key: string; value: unknown } | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    // Find the colon separator (key: value)
    // Key may be: "normal", P"key", Q"key", H"key", B, >contextKey, <executionKey, unquoted

    // Try to match key pattern
    // 1) P"key": value
    // 2) Q"key": value
    // 3) H"key": value
    // 4) B: value
    // 5) >contextKey: <executionKey
    // 6) "normal key": value
    // 7) unquotedKey: value

    // P"/Q"/H" prefix keys
    const prefixedMatch = /^([PQH])"([^"]+)"\s*:\s*(.*)$/s.exec(trimmed);
    if (prefixedMatch) {
      const prefix = prefixedMatch[1];
      const key = prefixedMatch[2];
      const rawValue = prefixedMatch[3].trim();
      return { keyType: prefix, key, value: this.parseJsonValue(rawValue) };
    }

    // B: value (bare body)
    const bareBodyMatch = /^B\s*:\s*(.*)$/s.exec(trimmed);
    if (bareBodyMatch) {
      const rawValue = bareBodyMatch[1].trim();
      return { keyType: 'B', key: 'B:', value: this.parseJsonValue(rawValue) };
    }

    // >contextKey: <executionKey
    const extractionMatch = /^>([^\s:]+)\s*:\s*<(.+)$/.exec(trimmed);
    if (extractionMatch) {
      return {
        keyType: 'extraction',
        key: extractionMatch[1],
        value: extractionMatch[2].trim(),
      };
    }

    // "normal key": value
    const quotedKeyMatch = /^"([^"]+)"\s*:\s*(.*)$/s.exec(trimmed);
    if (quotedKeyMatch) {
      const key = quotedKeyMatch[1];
      const rawValue = quotedKeyMatch[2].trim();
      return { keyType: 'body', key, value: this.parseJsonValue(rawValue) };
    }

    // unquoted key: value (e.g., $variable references, special syntax)
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx !== -1) {
      const key = trimmed.slice(0, colonIdx).trim();
      const rawValue = trimmed.slice(colonIdx + 1).trim();
      if (key && !key.includes('"')) {
        return { keyType: 'body', key, value: this.parseJsonValue(rawValue) };
      }
    }

    return null;
  }

  /**
   * Parse a JSON value string. Handles:
   * - Standard JSON values (string, number, boolean, null, object, array)
   * - $variable references (returned as-is for later resolution)
   * - &constraint expressions (returned as-is string)
   * - Unquoted strings that look like variable refs
   */
  private parseJsonValue(rawValue: string): unknown {
    const trimmed = rawValue.replace(/,$/, '').trim(); // strip trailing comma

    // Empty
    if (trimmed === '') return '';

    // null
    if (trimmed === 'null') return null;

    // boolean
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;

    // Number
    if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(trimmed)) {
      return Number(trimmed);
    }

    // JSON string
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return trimmed.slice(1, -1);
      }
    }

    // JSON array or object
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      return this.parseJsonLikeStructuredValue(trimmed);
    }

    // $variable reference or @time expression or &constraint — return as-is string
    return trimmed;
  }

  private parseJsonLikeStructuredValue(trimmed: string): unknown {
    try {
      return JSON.parse(trimmed);
    } catch {
      // fall through
    }

    const placeholders: string[] = [];
    let rewritten = '';
    let inString = false;
    let stringChar = '';

    for (let i = 0; i < trimmed.length; ) {
      const ch = trimmed[i];

      if (inString) {
        rewritten += ch;
        if (ch === stringChar && trimmed[i - 1] !== '\\') {
          inString = false;
        }
        i += 1;
        continue;
      }

      if (ch === '"' || ch === "'") {
        inString = true;
        stringChar = ch;
        rewritten += ch;
        i += 1;
        continue;
      }

      const specialToken = this.readJsonLikeSpecialToken(trimmed, i);
      if (specialToken) {
        const placeholder = `__SF_JSON_EXPR_${placeholders.length}__`;
        placeholders.push(specialToken.token);
        rewritten += JSON.stringify(placeholder);
        i = specialToken.nextIndex;
        continue;
      }

      rewritten += ch;
      i += 1;
    }

    try {
      const parsed: unknown = JSON.parse(rewritten);
      return this.restoreJsonLikePlaceholders(parsed, placeholders);
    } catch {
      return trimmed;
    }
  }

  private readJsonLikeSpecialToken(
    input: string,
    startIndex: number,
  ): { token: string; nextIndex: number } | null {
    const current = input[startIndex];

    if (current === '$') {
      if (input[startIndex + 1] === '{') {
        const endIndex = input.indexOf('}', startIndex + 2);
        if (endIndex !== -1) {
          return {
            token: input.slice(startIndex, endIndex + 1),
            nextIndex: endIndex + 1,
          };
        }
      }

      let endIndex = startIndex + 1;
      while (endIndex < input.length && /[\w.[\]]/.test(input[endIndex])) {
        endIndex += 1;
      }
      if (endIndex > startIndex + 1) {
        return {
          token: input.slice(startIndex, endIndex),
          nextIndex: endIndex,
        };
      }
    }

    if (
      input.startsWith('@time(', startIndex) ||
      input.startsWith('@date(', startIndex) ||
      input.startsWith('@localtime(', startIndex)
    ) {
      let depth = 0;
      for (let i = startIndex; i < input.length; i += 1) {
        if (input[i] === '(') depth += 1;
        if (input[i] === ')') {
          depth -= 1;
          if (depth === 0) {
            return {
              token: input.slice(startIndex, i + 1),
              nextIndex: i + 1,
            };
          }
        }
      }
    }

    return null;
  }

  private restoreJsonLikePlaceholders(value: unknown, placeholders: string[]): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.restoreJsonLikePlaceholders(item, placeholders));
    }

    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [
          key,
          this.restoreJsonLikePlaceholders(nestedValue, placeholders),
        ]),
      );
    }

    if (typeof value === 'string') {
      const match = /^__SF_JSON_EXPR_(\d+)__$/.exec(value);
      if (match) {
        const placeholderIndex = Number(match[1]);
        return placeholders[placeholderIndex] ?? value;
      }
    }

    return value;
  }
}

/**
 * Helper: resolve a time expression string from a cell value.
 * If the cell contains @time()/@date()/@localtime() it gets resolved via TimeService.
 */
export function resolveTimeExpression(
  cellValue: string,
  context: ScenarioContext,
): DateTimeTZ | DateOnly | TimeOnly | null {
  const trimmed = cellValue.trim();
  if (
    trimmed.startsWith('@time(') ||
    trimmed.startsWith('@date(') ||
    trimmed.startsWith('@localtime(')
  ) {
    return TimeService.resolveTimeExpression(trimmed, context);
  }
  return null;
}
