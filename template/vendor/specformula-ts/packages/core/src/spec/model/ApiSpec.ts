// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/spec/model/ApiSpec.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/spec/model/ApiSpec.ts
import type { ApiInfo } from './ApiInfo.js';
import type { ApiOperation } from './ApiOperation.js';
import { SpecFormulaArgumentError } from '../../error/SpecFormulaError.js';

export class ApiSpec {
  openapi: string | null;
  info: ApiInfo | null;
  private operationBySummary: Map<string, ApiOperation> = new Map();

  constructor(openapi: string | null = null, info: ApiInfo | null = null) {
    this.openapi = openapi;
    this.info = info;
  }

  get operations(): ApiOperation[] {
    return Array.from(this.operationBySummary.values());
  }

  setOperations(ops: ApiOperation[]): void {
    this.operationBySummary = new Map();
    for (const op of ops) {
      this.addOperation(op);
    }
  }

  addOperation(op: ApiOperation): void {
    if (op.summary != null) {
      if (this.operationBySummary.has(op.summary)) {
        throw new SpecFormulaArgumentError({
          code: 'SPEC_API_OPERATION_DUPLICATE',
          details: { summary: op.summary },
        });
      }
      this.operationBySummary.set(op.summary, op);
    }
  }

  findBySummary(summary: string): ApiOperation | null {
    return this.operationBySummary.get(summary) ?? null;
  }

  toJSON(): object {
    return {
      openapi: this.openapi,
      info: this.info,
      operations: this.operations,
    };
  }
}
