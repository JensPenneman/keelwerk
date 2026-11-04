import { camelFromKebab } from '@keelwerk/core';
import { usageFailure } from '../context/usage-failure.ts';
import { expectNames } from './expect-names.ts';
import { findOwnPart } from './find-own-part.ts';
import { nameAt } from './name-at.ts';
import { partPlacement } from './part-placement.ts';
import { partTest } from './part-test.ts';
import { placementImports } from './placement-imports.ts';
import { relativeImport } from './relative-import.ts';
import { renderImports } from './render-imports.ts';
import type { ScaffoldPlan } from './scaffold-plan.ts';
import type { ScaffoldRequest } from './scaffold-request.ts';

/**
 * `keelwerk new action <module>.<action>` or `<module>.<entity>.<action>` with `--kind
 * command|query`: `src/actions/[<entity>/]<action>.ts` and a test beside it. Rules are a separate
 * kind, so a new action stays closed to every caller until one allows it.
 */
export function actionTemplate(request: ScaffoldRequest): ScaffoldPlan {
  const names = expectNames(
    'action',
    request.names,
    [1, 2],
    '<module>.<action> or <module>.<entity>.<action>',
  );
  const kindOption = request.options.kind ?? 'command';
  if (kindOption !== 'command' && kindOption !== 'query') {
    throw usageFailure(`--kind of an action is command or query, not "${kindOption}".`);
  }
  const action = nameAt(names, names.length - 1);
  const owner = names.length === 2 ? nameAt(names, 0) : undefined;
  const placement = partPlacement(request, 'actions', owner, action);
  const define = kindOption === 'command' ? 'defineCommand' : 'defineQuery';
  const imports = placementImports(placement, [define, 'shape']);
  let ownerArgument = '';
  if (owner !== undefined) {
    const entityFile = findOwnPart(request, placement, 'entities', owner);
    if (request.options.from !== undefined) {
      ownerArgument = `'${camelFromKebab(owner)}', `;
    } else {
      if (entityFile === undefined) {
        throw usageFailure(
          `src/entities/${owner}.ts does not exist: run "keelwerk new entity ${request.target}.${owner}" first.`,
        );
      }
      const entity = camelFromKebab(owner);
      imports.push({
        from: relativeImport(placement.inSource, entityFile),
        names: [entity],
      });
      ownerArgument = `${entity}, `;
    }
  }
  const name = camelFromKebab(action);
  let body: string;
  if (kindOption === 'command') {
    body = `  input: shape({}),
  principal: 'user',
  decide: () => [],`;
  } else {
    body = `  input: shape({}),
  output: shape({}),
  principal: 'user',
  read: () => ({}),`;
  }
  const text = `${renderImports(imports)}

export const ${name} = ${define}(${placement.source}, ${ownerArgument}{
${body}
});
`;
  const reference = [request.target, ...names.map((part) => camelFromKebab(part))].join('.');
  return {
    files: [
      { path: placement.path, text },
      partTest(request, placement, reference, {
        member: owner === undefined ? 'actions' : 'entities',
        path: owner === undefined ? name : `${camelFromKebab(owner)}.actions.${name}`,
      }),
    ],
    handEdits: [],
  };
}
