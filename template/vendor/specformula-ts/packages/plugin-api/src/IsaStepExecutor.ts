// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/plugin-api/src/IsaStepExecutor.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/plugin-api/src/IsaStepExecutor.ts
import type { StepInvocation } from './StepInvocation.js';

/**
 * 一個指令的執行器。由 Instruction.create() 產生，每個 instruction 一個 instance。
 *
 * 與 BDD framework 解耦：不暴露 Cucumber.js / Vitest / SpecFlow 等具體型別。
 * Async 為原生型別，回傳 `Promise<void>` 或同步 `void`。
 */
export interface IsaStepExecutor {
  execute(invocation: StepInvocation): void | Promise<void>;
}
