import { camelFromKebab } from '@keelwerk/core';
import { expectNames } from './expect-names.ts';
import { nameAt } from './name-at.ts';
import { partPlacement } from './part-placement.ts';
import { placementImports } from './placement-imports.ts';
import { renderImports } from './render-imports.ts';
import type { ScaffoldPlan } from './scaffold-plan.ts';
import type { ScaffoldRequest } from './scaffold-request.ts';

/** `keelwerk new service <module>.<service>`: `src/services/<service>.ts`, offered to dependants. */
export function serviceTemplate(request: ScaffoldRequest): ScaffoldPlan {
  const file = nameAt(expectNames('service', request.names, [1], '<module>.<service>'), 0);
  const placement = partPlacement(request, 'services', undefined, file);
  const text = `${renderImports(placementImports(placement, ['defineService']))}

export const ${camelFromKebab(file)} = defineService(${placement.source}, (_own, value: string) => value);
`;
  return { files: [{ path: placement.path, text }], handEdits: [] };
}
