import { camelFromKebab, pascal } from '@keelwerk/core';
import { expectNames } from './expect-names.ts';
import { nameAt } from './name-at.ts';
import { renderImports } from './render-imports.ts';
import type { ScaffoldPlan } from './scaffold-plan.ts';
import type { ScaffoldRequest } from './scaffold-request.ts';
import { snake } from './snake.ts';

/** `keelwerk new entity <module>.<entity>`: `src/entities/<entity>.ts`; the base lists it by hand. */
export function entityTemplate(request: ScaffoldRequest): ScaffoldPlan {
  const file = nameAt(expectNames('entity', request.names, [1], '<module>.<entity>'), 0);
  const name = camelFromKebab(file);
  const type = pascal(file);
  const imports = renderImports([
    { from: '@keelwerk/core', names: ['defineEntity', 'type EntityType', 'field'] },
  ]);
  const text = `${imports}

const ${name}Def = defineEntity({
  prefix: '${snake(file)}',
  fields: {
    name: field.string({ maxLength: 200 }),
  },
});

export interface ${type} extends EntityType<typeof ${name}Def> {}
export const ${name}: ${type} = ${name}Def;
`;
  return {
    files: [{ path: `${request.root}/src/entities/${file}.ts`, text }],
    handEdits: [
      {
        file: `${request.root}/src/base.ts`,
        reason: `the base lists the entity; the TypeID prefix '${snake(file)}' must be unique in the app`,
        lines: [`import { ${name} } from './entities/${file}.ts';`, `entities: { ${name} },`],
      },
    ],
  };
}
