import { camelFromKebab } from '@keelwerk/core';
import { expectNames } from './expect-names.ts';
import { nameAt } from './name-at.ts';
import { renderImports } from './render-imports.ts';
import type { ScaffoldPlan } from './scaffold-plan.ts';
import type { ScaffoldRequest } from './scaffold-request.ts';

/** `keelwerk new shape <module>.<shape>`: `src/shapes/<shape>.ts`, a shape several parts use. */
export function shapeTemplate(request: ScaffoldRequest): ScaffoldPlan {
  const file = nameAt(expectNames('shape', request.names, [1], '<module>.<shape>'), 0);
  const imports = renderImports([{ from: '@keelwerk/core', names: ['field', 'shape'] }]);
  const text = `${imports}

export const ${camelFromKebab(file)} = shape({ value: field.string() });
`;
  return { files: [{ path: `${request.root}/src/shapes/${file}.ts`, text }], handEdits: [] };
}
