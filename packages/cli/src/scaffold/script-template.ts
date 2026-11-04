import { expectNames } from './expect-names.ts';
import type { ScaffoldPlan } from './scaffold-plan.ts';
import type { ScaffoldRequest } from './scaffold-request.ts';

/** `keelwerk new script <name>`: `scripts/<name>.ts`, one task per file, run with Node (section 23.1). */
export function scriptTemplate(request: ScaffoldRequest): ScaffoldPlan {
  expectNames('script', request.names, [0], '<name>');
  const text = `import { stdout } from 'node:process';

stdout.write('${request.target}\\n');
`;
  return {
    files: [{ path: `scripts/${request.target}.ts`, text }],
    handEdits: [
      {
        file: 'package.json',
        reason: 'a script entry runs the task',
        lines: [`"scripts": { "${request.target}": "node scripts/${request.target}.ts" }`],
      },
    ],
  };
}
