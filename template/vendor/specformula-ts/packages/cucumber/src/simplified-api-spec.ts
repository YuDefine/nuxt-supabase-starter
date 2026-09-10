// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/cucumber/src/simplified-api-spec.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/cucumber/src/simplified-api-spec.ts
import type { ApiOperation, ApiResponse, ApiSchema } from '@specformula/core';
import { ApiSpec as ApiSpecModel, expectJsonObject, expectJsonObjectArray, parseJsonObject } from '@specformula/core';

function parseSimplifiedSchema(value: unknown): ApiSchema | null {
  if (value == null) return null;
  const obj = expectJsonObject(value, 'simplified API spec schema');
  const requiredRaw = obj['required'];
  const required =
    Array.isArray(requiredRaw) && requiredRaw.every((item) => typeof item === 'string')
      ? requiredRaw
      : null;
  const propertiesRaw = obj['properties'];
  let properties: Record<string, ApiSchema> | null = null;
  if (propertiesRaw != null) {
    const props = expectJsonObject(propertiesRaw, 'simplified API spec schema properties');
    properties = {};
    for (const [key, nested] of Object.entries(props)) {
      const parsed = parseSimplifiedSchema(nested);
      if (parsed) properties[key] = parsed;
    }
  }
  return {
    type: typeof obj['type'] === 'string' ? obj['type'] : null,
    ...(obj['nullable'] === true ? { nullable: true } : {}),
    format: typeof obj['format'] === 'string' ? obj['format'] : null,
    description: typeof obj['description'] === 'string' ? obj['description'] : null,
    required,
    properties,
    items: obj['items'] == null ? null : parseSimplifiedSchema(obj['items']),
    enumValues: null,
    example: null,
  };
}

function parseSimplifiedResponse(statusCode: string, value: unknown): ApiResponse {
  const obj = expectJsonObject(value, 'simplified API spec response');
  return {
    statusCode,
    description: typeof obj['description'] === 'string' ? obj['description'] : null,
    schema: parseSimplifiedSchema(obj['schema']),
    contentType: typeof obj['contentType'] === 'string' ? obj['contentType'] : null,
    plainText: obj['plainText'] === true,
  };
}

function parseSimplifiedOperation(value: unknown): ApiOperation {
  const op = expectJsonObject(value, 'simplified API spec operation');
  const parametersRaw = op['parameters'];
  const parameters = parametersRaw == null
    ? null
    : expectJsonObjectArray(parametersRaw, 'simplified API spec parameters').map((p) => ({
        name: p['name'] != null && typeof p['name'] === 'string' ? p['name'] : null,
        in: p['in'] != null && typeof p['in'] === 'string' ? p['in'] : null,
        required: Boolean(p['required'] ?? false),
        schema: null,
        description: null,
      }));

  const responsesRaw = op['responses'];
  let responses: Record<string, ApiResponse> | null = null;
  if (responsesRaw != null) {
    const responseMap = expectJsonObject(responsesRaw, 'simplified API spec responses');
    responses = {};
    for (const [code, nested] of Object.entries(responseMap)) {
      responses[code] = parseSimplifiedResponse(code, nested);
    }
  }

  return {
    method: typeof op['method'] === 'string' ? op['method'] : 'get',
    path: typeof op['path'] === 'string' ? op['path'] : '/',
    summary: typeof op['summary'] === 'string' ? op['summary'] : null,
    description: null,
    operationId: null,
    tags: null,
    parameters,
    requestBody: null,
    responses,
  };
}

export function parseSimplifiedApiSpecJson(source: string): ApiSpecModel {
  try {
    const data = parseJsonObject(source, 'simplified API spec');
    const spec = new ApiSpecModel();
    if (data['operations'] == null) return spec;
    const operations = expectJsonObjectArray(data['operations'], 'simplified API spec operations');
    for (const op of operations) {
      spec.addOperation(parseSimplifiedOperation(op));
    }
    return spec;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('invalid simplified API spec')) {
      throw err;
    }
    throw new Error('invalid simplified API spec');
  }
}
