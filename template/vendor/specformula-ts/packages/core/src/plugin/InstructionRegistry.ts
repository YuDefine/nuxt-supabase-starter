// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/plugin/InstructionRegistry.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/plugin/InstructionRegistry.ts
import type { Instruction } from '@specformula/plugin-api';

interface Entry {
  readonly contribution: Instruction;
  readonly isBuiltin: boolean;
}

/**
 * InstructionRegistry — instructionType → Instruction contribution。
 *
 * 衝突規則（ADR-0027 §五）：
 *   - 內建 vs 第三方：第三方覆蓋必須 override_builtin=true
 *   - 第三方 vs 第三方：永遠拋錯
 *   - 內建 vs 內建：拋錯（內建衝突屬框架 bug）
 *
 * 額外檢查：
 *   - instructionType 不可為空
 *   - instructionType !== 'custom'（ADR-0027 §3.1 / §五）— 保留字
 *   - supportedDataFormats 非空集合（ADR-0027 §3.1 / §五）
 */
export class InstructionRegistry {
  private readonly instructions = new Map<string, Entry>();

  register(contribution: Instruction, isBuiltin: boolean, overrideBuiltin: boolean): void {
    const type = contribution.instructionType;
    if (!type || type.trim() === '') {
      throw new Error(`Instruction has blank instructionType`);
    }
    if (type.toLowerCase() === 'custom') {
      throw new Error(
        `Plugin attempts to register reserved instructionType='custom' — ` +
          `'custom' is reserved for ADR-0013 project-side BDD step definition seam`,
      );
    }
    const supported = contribution.supportedDataFormats;
    if (!supported || supported.size === 0) {
      throw new Error(
        `Instruction '${type}' declares empty supportedDataFormats — ` +
          `ADR-0027 §3.1 requires at least one DataFormat`,
      );
    }

    const existing = this.instructions.get(type);
    if (existing) {
      // 內建 vs 第三方：第三方覆蓋必須 overrideBuiltin=true
      if (existing.isBuiltin && !isBuiltin) {
        if (!overrideBuiltin) {
          throw new Error(
            `Instruction '${type}' tries to override builtin without ` +
              `override_builtin: true in plugins.config`,
          );
        }
        this.instructions.set(type, { contribution, isBuiltin });
        return;
      }
      // 第三方 vs 第三方 / 內建 vs 內建：永遠拋錯
      throw new Error(`Duplicate instructionType '${type}'`);
    }
    this.instructions.set(type, { contribution, isBuiltin });
  }

  find(instructionType: string): Instruction | undefined {
    return this.instructions.get(instructionType)?.contribution;
  }

  instructionTypes(): ReadonlySet<string> {
    return new Set(this.instructions.keys());
  }

  size(): number {
    return this.instructions.size;
  }
}
