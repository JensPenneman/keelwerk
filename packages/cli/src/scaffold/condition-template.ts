import { camelFromKebab, contracts } from '@keelwerk/core';
import { usageFailure } from '../context/usage-failure.ts';
import { expectNames } from './expect-names.ts';
import type { ImportEntry } from './import-entry.ts';
import { moduleImport } from './module-import.ts';
import { nameAt } from './name-at.ts';
import { renderImports } from './render-imports.ts';
import { requireScope } from './require-scope.ts';
import type { ScaffoldPlan } from './scaffold-plan.ts';
import type { ScaffoldRequest } from './scaffold-request.ts';

/**
 * `keelwerk new condition <module>.when-<id>[-and-<id>]`:
 * `src/conditional/when-<ids>/condition.ts`, the declaration the base lists. An id is a module,
 * or a contract by name (`when-live`).
 */
export function conditionTemplate(request: ScaffoldRequest): ScaffoldPlan {
  const scope = requireScope(request);
  const directory = nameAt(expectNames('condition', request.names, [1], '<module>.when-<id>'), 0);
  if (!directory.startsWith('when-') || directory.length === 5) {
    throw usageFailure(`A condition directory is when-<id>, not "${directory}".`);
  }
  const key = camelFromKebab(directory);
  const ids = directory.slice(5).split('-and-');
  const imports: ImportEntry[] = [{ from: '@keelwerk/core', names: ['defineCondition'] }];
  const dependencies: string[] = [];
  const listed: string[] = [];
  const moduleLines: string[] = [];
  for (const id of ids) {
    const name = camelFromKebab(id);
    if (Object.hasOwn(contracts, name)) {
      imports[0] = { from: '@keelwerk/core', names: ['contracts', 'defineCondition'] };
      dependencies.push(`contracts.${name}`);
      listed.push(`contracts.${name}`);
    } else {
      const imported = moduleImport(scope, id);
      imports.push(imported);
      moduleLines.push(`import { ${name} } from '${imported.from}';`);
      dependencies.push(name);
      listed.push(name);
    }
  }
  const text = `${renderImports(imports)}

export const ${key} = defineCondition([${dependencies.join(', ')}], { entities: {} });
`;
  return {
    files: [{ path: `${request.root}/src/conditional/${directory}/condition.ts`, text }],
    handEdits: [
      {
        file: `${request.root}/src/base.ts`,
        reason: 'the base lists the condition and names what it waits for in optional',
        lines: [
          `import { ${key} } from './conditional/${directory}/condition.ts';`,
          ...moduleLines,
          `optional: [${listed.join(', ')}],`,
          `conditions: { ${key} },`,
        ],
      },
    ],
  };
}
