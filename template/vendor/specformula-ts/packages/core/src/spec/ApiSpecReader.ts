// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/spec/ApiSpecReader.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/spec/ApiSpecReader.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import yaml from 'js-yaml';
import { ApiSpec } from './model/ApiSpec.js';
import { SpecFormulaLookupError } from '../error/SpecFormulaError.js';
import { isRecord } from '../helper/JsonBoundary.js';
import type { ApiInfo } from './model/ApiInfo.js';
import type { ApiOperation } from './model/ApiOperation.js';
import type { ApiParameter } from './model/ApiParameter.js';
import type { ApiRequestBody } from './model/ApiRequestBody.js';
import type { ApiResponse } from './model/ApiResponse.js';
import type { ApiSchema } from './model/ApiSchema.js';

type JsonNode = Record<string, unknown> | unknown[] | string | number | boolean | null;
type JsonObject = Record<string, unknown>;

const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch']);

export class ApiSpecReader {
  private readonly resourcePath: string;

  constructor(resourcePath: string) {
    this.resourcePath = resourcePath;
  }

  /**
   * Parse an ApiSpec from a YAML or JSON string (for use in step definitions / tests).
   */
  static parseFromString(content: string): ApiSpec {
    const reader = new ApiSpecReader('');
    const trimmed = content.trim();
    let parsed: unknown;
    try {
      parsed = yaml.load(trimmed);
    } catch {
      parsed = JSON.parse(trimmed);
    }
    if (!isRecord(parsed)) {
      throw new Error('API spec root must be an object');
    }
    const allRoots = new Map<string, Record<string, unknown>>();
    allRoots.set('inline', parsed);
    return reader['parseSpec'](parsed, allRoots);
  }

  read(): ApiSpec {
    if (!fs.existsSync(this.resourcePath) || !fs.statSync(this.resourcePath).isDirectory()) {
      throw new SpecFormulaLookupError({
        code: 'SPEC_API_FILES_NOT_FOUND',
        details: { path: this.resourcePath },
      });
    }
    return this.scanDirectory(this.resourcePath);
  }

  private scanDirectory(dirPath: string): ApiSpec {
    const ymlFiles = this.collectYamlFiles(dirPath).sort();

    if (ymlFiles.length === 0) {
      throw new SpecFormulaLookupError({
        code: 'SPEC_API_FILES_NOT_FOUND',
        details: { path: dirPath },
      });
    }

    // Phase 1: Load all YAML roots keyed by relative path
    const allRoots = new Map<string, JsonObject>();
    const uniqueRoots: JsonObject[] = [];

    for (const file of ymlFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const loaded: unknown = yaml.load(content);
      if (!isRecord(loaded)) continue;
      uniqueRoots.push(loaded);

      const relativePath = path.relative(dirPath, file).replace(/\\/g, '/');
      allRoots.set(relativePath, loaded);
      allRoots.set(path.basename(file), loaded);
      allRoots.set('./' + relativePath, loaded);
    }

    // Phase 2: Parse specs (only files with openapi/swagger field)
    let merged: ApiSpec | null = null;
    for (const rootNode of uniqueRoots) {
      if (rootNode['openapi'] == null && rootNode['swagger'] == null) {
        continue;
      }
      const spec = this.parseSpec(rootNode, allRoots);
      if (merged == null) {
        merged = spec;
      } else {
        for (const op of spec.operations) {
          merged.addOperation(op);
        }
      }
    }

    if (merged == null) {
      throw new SpecFormulaLookupError({
        code: 'SPEC_API_FILES_NOT_FOUND',
        details: { path: dirPath },
      });
    }
    return merged;
  }

  private collectYamlFiles(dirPath: string): string[] {
    const results: string[] = [];
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        results.push(...this.collectYamlFiles(full));
      } else if (entry.isFile() && /\.(yml|yaml)$/i.test(entry.name)) {
        results.push(full);
      }
    }
    return results;
  }

  private parseSpec(root: JsonObject, allRoots: Map<string, JsonObject>): ApiSpec {
    const spec = new ApiSpec(
      textOrNull(root, 'openapi'),
      root['info'] != null ? this.parseInfo(root['info'] as JsonObject) : null,
    );

    const operations: ApiOperation[] = [];
    const pathsNode = root['paths'] as JsonObject | undefined;
    if (pathsNode != null) {
      for (const [pathUrl, pathValue] of Object.entries(pathsNode)) {
        let pathNode = pathValue as JsonObject;

        // Resolve path-level $ref
        pathNode = this.resolveRef(pathNode, root, allRoots) as JsonObject;

        for (const [methodKey, opValue] of Object.entries(pathNode)) {
          const method = methodKey.toLowerCase();
          if (!HTTP_METHODS.has(method)) continue;
          const op = this.parseOperation(pathUrl, method, opValue as JsonObject, root, allRoots);
          operations.push(op);
        }
      }
    }

    spec.setOperations(operations);
    return spec;
  }

  private parseInfo(infoNode: JsonObject): ApiInfo {
    return {
      title: textOrNull(infoNode, 'title'),
      version: textOrNull(infoNode, 'version'),
      description: textOrNull(infoNode, 'description'),
    };
  }

  private parseOperation(
    pathUrl: string,
    method: string,
    opNode: JsonObject,
    root: JsonObject,
    allRoots: Map<string, JsonObject>,
  ): ApiOperation {
    // Parameters
    let parameters: ApiParameter[] | null = null;
    const paramsNode = opNode['parameters'] as unknown[] | undefined;
    if (paramsNode != null && Array.isArray(paramsNode)) {
      parameters = paramsNode.map((p) => {
        const resolved = this.resolveRef(p as JsonObject, root, allRoots) as JsonObject;
        const schemaNode = resolved['schema'] as JsonObject | undefined;
        return {
          name: textOrNull(resolved, 'name'),
          in: textOrNull(resolved, 'in'),
          required: !!(resolved['required'] as boolean | undefined),
          schema: schemaNode != null ? this.parseSchema(schemaNode, root, allRoots) : null,
          description: textOrNull(resolved, 'description'),
        } satisfies ApiParameter;
      });
    }

    // RequestBody
    let requestBody: ApiRequestBody | null = null;
    const reqBodyNode = opNode['requestBody'] as JsonObject | undefined;
    if (reqBodyNode != null) {
      const contentType = detectContentType(reqBodyNode);
      const contentSchemaNode = extractSchemaFromContent(reqBodyNode);
      let schema: ApiSchema | null = null;
      if (contentSchemaNode != null) {
        const resolved = this.resolveRef(contentSchemaNode, root, allRoots) as JsonObject;
        schema = this.parseSchema(resolved, root, allRoots);
      }
      requestBody = {
        required: !!(reqBodyNode['required'] as boolean | undefined),
        schema,
        contentType,
      };
    }

    // Responses
    let responses: Record<string, ApiResponse> | null = null;
    const responsesNode = opNode['responses'] as JsonObject | undefined;
    if (responsesNode != null) {
      responses = {};
      for (const [statusCode, respValue] of Object.entries(responsesNode)) {
        const respNode = respValue as JsonObject;
        const ct = detectContentType(respNode);
        const schemaNode = extractSchemaFromContent(respNode);
        let schema: ApiSchema | null = null;
        if (schemaNode != null) {
          const resolved = this.resolveRef(schemaNode, root, allRoots) as JsonObject;
          schema = this.parseSchema(resolved, root, allRoots);
        }
        responses[statusCode] = {
          statusCode,
          description: textOrNull(respNode, 'description'),
          schema,
          contentType: ct,
          plainText: ct === 'text/plain',
        };
      }
    }

    // Tags
    const tagsNode = opNode['tags'] as unknown[] | undefined;
    const tags =
      tagsNode != null && Array.isArray(tagsNode) ? tagsNode.map((t) => String(t)) : null;

    return {
      method,
      path: pathUrl,
      summary: textOrNull(opNode, 'summary'),
      description: textOrNull(opNode, 'description'),
      operationId: textOrNull(opNode, 'operationId'),
      tags,
      parameters,
      requestBody,
      responses,
    };
  }

  private parseSchema(
    schemaNode: JsonObject,
    root: JsonObject,
    allRoots: Map<string, JsonObject>,
  ): ApiSchema {
    const resolved = this.resolveRef(schemaNode, root, allRoots) as JsonObject;

    let properties: Record<string, ApiSchema> | null = null;
    const propsNode = resolved['properties'] as JsonObject | undefined;
    if (propsNode != null) {
      properties = {};
      for (const [k, v] of Object.entries(propsNode)) {
        properties[k] = this.parseSchema(v as JsonObject, root, allRoots);
      }
    }

    let items: ApiSchema | null = null;
    const itemsNode = resolved['items'] as JsonObject | undefined;
    if (itemsNode != null) {
      items = this.parseSchema(itemsNode, root, allRoots);
    }

    const requiredNode = resolved['required'] as unknown[] | undefined;
    const required =
      requiredNode != null && Array.isArray(requiredNode)
        ? requiredNode.map((r) => String(r))
        : null;

    const enumNode = resolved['enum'] as unknown[] | undefined;
    const enumValues =
      enumNode != null && Array.isArray(enumNode) ? enumNode.map((e) => String(e)) : null;

    const exampleRaw = resolved['example'];
    const example =
      exampleRaw != null
        ? typeof exampleRaw === 'string'
          ? exampleRaw
          : JSON.stringify(exampleRaw)
        : null;

    return {
      type: textOrNull(resolved, 'type'),
      ...(resolved['nullable'] === true ? { nullable: true } : {}),
      format: textOrNull(resolved, 'format'),
      description: textOrNull(resolved, 'description'),
      required,
      properties,
      items,
      enumValues,
      example,
    };
  }

  private resolveRef(
    node: JsonNode,
    root: JsonObject,
    allRoots: Map<string, JsonObject>,
    visiting: Set<string> = new Set(),
  ): JsonNode {
    if (node == null || typeof node !== 'object' || Array.isArray(node)) return node;
    const obj = node as JsonObject;
    const ref = obj['$ref'];
    if (ref == null || typeof ref !== 'string') return node;

    if (visiting.has(ref)) return node;
    visiting.add(ref);

    try {
      const resolved = this.doResolveRef(ref, root, allRoots);
      if (resolved == null) return node;
      return this.resolveRef(resolved, root, allRoots, visiting);
    } finally {
      visiting.delete(ref);
    }
  }

  private doResolveRef(
    ref: string,
    root: JsonObject,
    allRoots: Map<string, JsonObject>,
  ): JsonNode | null {
    if (ref.startsWith('#/')) {
      const segments = ref.substring(2).split('/');
      let current: JsonNode = root;
      for (const seg of segments) {
        if (current == null || typeof current !== 'object' || Array.isArray(current)) return null;
        current = (current as JsonObject)[decodeJsonPointer(seg)] as JsonNode;
      }
      return current ?? null;
    } else if (ref.includes('#/')) {
      const hashIdx = ref.indexOf('#/');
      const fileName = ref.substring(0, hashIdx);
      const pointer = ref.substring(hashIdx + 2);
      const otherRoot = allRoots.get(fileName);
      if (otherRoot == null) return null;
      const segments = pointer.split('/');
      let current: JsonNode = otherRoot;
      for (const seg of segments) {
        if (current == null || typeof current !== 'object' || Array.isArray(current)) return null;
        current = (current as JsonObject)[decodeJsonPointer(seg)] as JsonNode;
      }
      return current ?? null;
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function textOrNull(obj: JsonObject, field: string): string | null {
  const v = obj[field];
  return typeof v === 'string' ? v : null;
}

function detectContentType(node: JsonObject): string | null {
  const content = node['content'] as JsonObject | undefined;
  if (content == null) return null;
  const keys = Object.keys(content);
  return keys.length > 0 ? keys[0] : null;
}

function extractSchemaFromContent(node: JsonObject): JsonObject | null {
  const content = node['content'] as JsonObject | undefined;
  if (content == null) return null;
  // Get schema from first content type entry
  const firstKey = Object.keys(content)[0];
  if (firstKey == null) return null;
  const mediaType = content[firstKey] as JsonObject | undefined;
  if (mediaType == null) return null;
  return (mediaType['schema'] as JsonObject | undefined) ?? null;
}

function decodeJsonPointer(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}
