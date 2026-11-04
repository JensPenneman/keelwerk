import { camelFromKebab } from '@keelwerk/core';
import { usageFailure } from '../context/usage-failure.ts';
import { expectNames } from './expect-names.ts';
import { moduleImport } from './module-import.ts';
import { nameAt } from './name-at.ts';
import { renderImports } from './render-imports.ts';
import { requireScope } from './require-scope.ts';
import type { ScaffoldPlan } from './scaffold-plan.ts';
import type { ScaffoldRequest } from './scaffold-request.ts';

/**
 * `keelwerk new contribution <module>.to-<target>[-when-<id>]`:
 * `src/contributions/to-<target>/contribution.ts`, the declaration the base lists. The behaviour
 * that belongs to it is scaffolded with `--from <module>` on the other kinds.
 */
export function contributionTemplate(request: ScaffoldRequest): ScaffoldPlan {
  const scope = requireScope(request);
  const directory = nameAt(
    expectNames('contribution', request.names, [1], '<module>.to-<target>'),
    0,
  );
  const [head = '', ...whens] = directory.split('-when-');
  if (!head.startsWith('to-') || head.length === 3) {
    throw usageFailure(`A contribution directory is to-<target id>, not "${directory}".`);
  }
  const targetId = head.slice(3);
  const key = camelFromKebab(directory);
  const target = moduleImport(scope, targetId);
  const when = whens.map((id) => moduleImport(scope, id));
  const imports = renderImports([
    { from: '@keelwerk/core', names: ['defineContribution'] },
    target,
    ...when,
  ]);
  const options = [
    ...(when.length > 0 ? [`when: [${when.flatMap((entry) => entry.names).join(', ')}]`] : []),
    'entities: {}',
  ];
  const text = `${imports}

export const ${key} = defineContribution(${camelFromKebab(targetId)}, { ${options.join(', ')} });
`;
  return {
    files: [{ path: `${request.root}/src/contributions/${directory}/contribution.ts`, text }],
    handEdits: [
      {
        file: `${request.root}/src/base.ts`,
        reason: `the base lists the contribution and names ${targetId} in requires or optional`,
        lines: [
          `import { ${key} } from './contributions/${directory}/contribution.ts';`,
          `import { ${camelFromKebab(targetId)} } from '${target.from}';`,
          `requires: [${camelFromKebab(targetId)}],   // or optional`,
          `contributions: { ${key} },`,
        ],
      },
    ],
  };
}
