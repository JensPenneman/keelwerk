import { camelFromKebab } from '@keelwerk/core';
import { usageFailure } from '../context/usage-failure.ts';
import { expectNames } from './expect-names.ts';
import { nameAt } from './name-at.ts';
import { partPlacement } from './part-placement.ts';
import { partTest } from './part-test.ts';
import { placementImports } from './placement-imports.ts';
import { renderImports } from './render-imports.ts';
import type { ScaffoldPlan } from './scaffold-plan.ts';
import type { ScaffoldRequest } from './scaffold-request.ts';

/**
 * `keelwerk new reaction <module>.<reaction> --on <module>.<entity>.<event>`:
 * `src/reactions/<reaction>.ts` and a test beside it. The reaction's file name is its id, which
 * never changes once released (section 23.5).
 */
export function reactionTemplate(request: ScaffoldRequest): ScaffoldPlan {
  const file = nameAt(expectNames('reaction', request.names, [1], '<module>.<reaction>'), 0);
  const { on } = request.options;
  if (
    on === undefined ||
    !/^[a-z][a-z0-9-]*\.[A-Za-z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9]*$/.test(on)
  ) {
    throw usageFailure(
      'A reaction needs --on <module>.<entity>.<event>, such as accounts.profile.created.',
    );
  }
  const placement = partPlacement(request, 'reactions', undefined, file);
  const name = camelFromKebab(file);
  const text = `${renderImports(placementImports(placement, ['defineReaction']))}

export const ${name} = defineReaction(${placement.source}, {
  on: '${on}',
  timing: 'inline',
  react: () => ({ events: [] }),
});
`;
  return {
    files: [
      { path: placement.path, text },
      partTest(request, placement, `${request.target}.${name}`, {
        member: 'reactions',
        path: name,
      }),
    ],
    handEdits: [],
  };
}
