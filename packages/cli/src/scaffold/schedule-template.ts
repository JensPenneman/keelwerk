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
 * `keelwerk new schedule <module>.<action>` or `<module>.<entity>.<action> --every 1d`:
 * `src/schedules/<action>.ts` (`<entity>-<action>.ts` for an entity action) exporting
 * `<action>Schedule`, the schedule of an action the module owns (section 23.4). M1 declares it;
 * the worker that fires it is M2 (S-24).
 */
export function scheduleTemplate(request: ScaffoldRequest): ScaffoldPlan {
  const names = expectNames(
    'schedule',
    request.names,
    [1, 2],
    '<module>.<action> or <module>.<entity>.<action>',
  );
  const action = nameAt(names, names.length - 1);
  const owner = names.length === 2 ? nameAt(names, 0) : undefined;
  const actionFile = owner === undefined ? `actions/${action}.ts` : `actions/${owner}/${action}.ts`;
  if (!request.files.has(actionFile)) {
    throw usageFailure(
      `src/${actionFile} does not exist: a schedule belongs to an action of this module.`,
    );
  }
  const every = request.options.every ?? '1d';
  if (!/^\d+(ms|s|m|h|d)$/.test(every)) {
    throw usageFailure(`--every is a duration such as 5m or 1d, not "${every}".`);
  }
  const file = owner === undefined ? action : `${owner}-${action}`;
  const placement = partPlacement(request, 'schedules', undefined, file);
  const name = camelFromKebab(action);
  const imports = renderImports([
    ...placementImports(placement, ['defineSchedule']),
    { from: relativeImport(placement.inSource, actionFile), names: [name] },
  ]);
  const text = `${imports}

export const ${camelFromKebab(file)}Schedule = defineSchedule(${placement.source}, {
  every: '${every}',
  invoke: ${name},
});
`;
  return { files: [{ path: placement.path, text }], handEdits: [] };
}
