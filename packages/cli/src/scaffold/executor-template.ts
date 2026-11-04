import { camelFromKebab } from '@keelwerk/core';
import { usageFailure } from '../context/usage-failure.ts';
import { expectNames } from './expect-names.ts';
import { nameAt } from './name-at.ts';
import { partPlacement } from './part-placement.ts';
import { placementImports } from './placement-imports.ts';
import { relativeImport } from './relative-import.ts';
import { renderImports } from './render-imports.ts';
import type { ScaffoldPlan } from './scaffold-plan.ts';
import type { ScaffoldRequest } from './scaffold-request.ts';

/**
 * `keelwerk new executor <module>.<effect>`: `src/executors/<effect>.ts`, the only imperative
 * code of a module. The effect has to exist (`keelwerk new effect`).
 */
export function executorTemplate(request: ScaffoldRequest): ScaffoldPlan {
  const file = nameAt(expectNames('executor', request.names, [1], '<module>.<effect>'), 0);
  if (!request.files.has(`effects/${file}.ts`)) {
    throw usageFailure(
      `src/effects/${file}.ts does not exist: run "keelwerk new effect ${request.target}.${file}" first.`,
    );
  }
  const placement = partPlacement(request, 'executors', undefined, file);
  const name = camelFromKebab(file);
  const imports = renderImports([
    ...placementImports(placement, ['defineEffectExecutor']),
    {
      from: relativeImport(placement.inSource, `effects/${file}.ts`),
      names: [`${name} as ${name}Effect`],
    },
  ]);
  const text = `${imports}

export const ${name} = defineEffectExecutor(${placement.source}, ${name}Effect, {
  run: async () => ({ accepted: true }),
});
`;
  return { files: [{ path: placement.path, text }], handEdits: [] };
}
