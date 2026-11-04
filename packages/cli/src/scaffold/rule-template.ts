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
 * `keelwerk new rule <module>.<target>.<rule> --effect allow|deny`: `src/policies/<target>/<rule>.ts`
 * for a rule over one entity or one module-level action (decision 60b), and a test beside it. A
 * rule over several actions or a selector is written by hand.
 */
export function ruleTemplate(request: ScaffoldRequest): ScaffoldPlan {
  const names = expectNames('rule', request.names, [2], '<module>.<target>.<rule>');
  const target = nameAt(names, 0);
  const rule = nameAt(names, 1);
  const effect = request.options.effect ?? 'allow';
  if (effect !== 'allow' && effect !== 'deny') {
    throw usageFailure(`--effect is allow or deny, not "${effect}".`);
  }
  const placement = partPlacement(request, 'policies', target, rule);
  const imports = placementImports(placement, ['defineRule']);
  const reason = `The ${rule.replaceAll('-', ' ')} rule.`;
  let targetArgument: string;
  let body: string;
  const entityBody = `  effect: '${effect}',
  actions: ['read'],
  principal: 'user',
  reason: '${reason}',`;
  const entityFile = findOwnPart(request, placement, 'entities', target);
  const actionFile = findOwnPart(request, placement, 'actions', target);
  if (request.options.from !== undefined) {
    targetArgument = `'${camelFromKebab(target)}'`;
    body = entityBody;
  } else if (entityFile !== undefined) {
    targetArgument = camelFromKebab(target);
    imports.push({ from: relativeImport(placement.inSource, entityFile), names: [targetArgument] });
    body = entityBody;
  } else if (actionFile !== undefined) {
    targetArgument = camelFromKebab(target);
    imports.push({ from: relativeImport(placement.inSource, actionFile), names: [targetArgument] });
    body = `  effect: '${effect}',
  principal: 'user',
  reason: '${reason}',`;
  } else {
    throw usageFailure(
      `A rule targets an entity or a module-level action: neither src/entities/${target}.ts nor src/actions/${target}.ts exists.`,
    );
  }
  const name = camelFromKebab(rule);
  const text = `${renderImports(imports)}

export const ${name} = defineRule(${placement.source}, ${targetArgument}, {
${body}
});
`;
  return {
    files: [
      { path: placement.path, text },
      partTest(request, placement, `${request.target}.${camelFromKebab(target)}.${name}`, {
        member: 'policies',
        path: `${camelFromKebab(target)}.${name}`,
      }),
    ],
    handEdits: [],
  };
}
