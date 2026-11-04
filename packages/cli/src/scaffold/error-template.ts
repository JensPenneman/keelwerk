import { camelFromKebab } from '@keelwerk/core';
import { usageFailure } from '../context/usage-failure.ts';
import { expectNames } from './expect-names.ts';
import { nameAt } from './name-at.ts';
import { renderImports } from './render-imports.ts';
import type { ScaffoldPlan } from './scaffold-plan.ts';
import type { ScaffoldRequest } from './scaffold-request.ts';
import { snake } from './snake.ts';

const KINDS = [
  'validation',
  'unauthenticated',
  'forbidden',
  'not_found',
  'conflict',
  'rate_limited',
  'not_implemented',
  'unavailable',
  'unsupported',
  'internal',
] as const;

/**
 * `keelwerk new error <module>.<error> --kind conflict`: `src/errors/<error>.ts` with the code
 * `<module>.<snake_case>` (section 23.4). An action lists it in its `errors` by hand.
 */
export function errorTemplate(request: ScaffoldRequest): ScaffoldPlan {
  const file = nameAt(expectNames('error', request.names, [1], '<module>.<error>'), 0);
  const kind = request.options.kind ?? 'conflict';
  if (!KINDS.includes(kind as (typeof KINDS)[number])) {
    throw usageFailure(`--kind of an error is one of ${KINDS.join(', ')}, not "${kind}".`);
  }
  const name = camelFromKebab(file);
  const sentence = file.replaceAll('-', ' ');
  const imports = renderImports([{ from: '@keelwerk/core', names: ['defineError'] }]);
  const text = `${imports}

export const ${name} = defineError('${request.target}.${snake(file)}', {
  kind: '${kind}',
  message: '${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.',
});
`;
  return {
    files: [{ path: `${request.root}/src/errors/${file}.ts`, text }],
    handEdits: [
      {
        file: `${request.root}/src/actions/<action>.ts`,
        reason: 'an action lists the errors it throws',
        lines: [`import { ${name} } from '../errors/${file}.ts';`, `errors: [${name}],`],
      },
    ],
  };
}
