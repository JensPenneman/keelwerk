import { camelFromKebab } from '@keelwerk/core';
import { expectNames } from './expect-names.ts';
import { nameAt } from './name-at.ts';
import type { ScaffoldPlan } from './scaffold-plan.ts';
import type { ScaffoldRequest } from './scaffold-request.ts';

/** `keelwerk new lib <module>.<function>`: `src/lib/<function>.ts`, one pure function (section 23.2). */
export function libTemplate(request: ScaffoldRequest): ScaffoldPlan {
  const file = nameAt(expectNames('lib', request.names, [1], '<module>.<function>'), 0);
  const text = `export function ${camelFromKebab(file)}(value: number): number {
  return value;
}
`;
  return { files: [{ path: `${request.root}/src/lib/${file}.ts`, text }], handEdits: [] };
}
