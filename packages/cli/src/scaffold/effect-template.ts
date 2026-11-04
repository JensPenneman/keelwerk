import { camelFromKebab } from '@keelwerk/core';
import { expectNames } from './expect-names.ts';
import { nameAt } from './name-at.ts';
import { partPlacement } from './part-placement.ts';
import { placementImports } from './placement-imports.ts';
import { renderImports } from './render-imports.ts';
import type { ScaffoldPlan } from './scaffold-plan.ts';
import type { ScaffoldRequest } from './scaffold-request.ts';

/** `keelwerk new effect <module>.<effect>`: `src/effects/<effect>.ts`; the base does not list effects (section 7.9.5). */
export function effectTemplate(request: ScaffoldRequest): ScaffoldPlan {
  const file = nameAt(expectNames('effect', request.names, [1], '<module>.<effect>'), 0);
  const placement = partPlacement(request, 'effects', undefined, file);
  const imports = renderImports(placementImports(placement, ['defineEffect', 'field', 'shape']));
  const text = `${imports}

export const ${camelFromKebab(file)} = defineEffect(${placement.source}, {
  input: shape({ payload: field.text() }),
  output: shape({ accepted: field.boolean() }),
});
`;
  return { files: [{ path: placement.path, text }], handEdits: [] };
}
