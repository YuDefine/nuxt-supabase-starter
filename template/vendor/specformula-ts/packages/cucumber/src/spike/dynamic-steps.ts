// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/cucumber/src/spike/dynamic-steps.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/cucumber/src/spike/dynamic-steps.ts
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { load } from 'js-yaml';
import { Given, Then } from '@cucumber/cucumber';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface Instruction {
  name: string;
  instruction_type: string;
  regex: string;
}

interface IsaFile {
  instructions: Instruction[];
}

// Shared state between steps
let greetingTarget: string | undefined;

// Read and parse mock-isa.yml
const isaPath = join(__dirname, 'mock-isa.yml');
const isaContent = readFileSync(isaPath, 'utf-8');
const isa = load(isaContent) as IsaFile;

// Dynamically register Given steps at module load time
for (const instruction of isa.instructions) {
  if (instruction.instruction_type === 'entity_setup') {
    Given(new RegExp(instruction.regex), function (target: string) {
      greetingTarget = target;
    });
  }
}

// Static Then step to verify the shared state
Then('the greeting target is {string}', function (expected: string) {
  if (greetingTarget !== expected) {
    throw new Error(`Expected greeting target "${expected}" but got "${greetingTarget}"`);
  }
});
