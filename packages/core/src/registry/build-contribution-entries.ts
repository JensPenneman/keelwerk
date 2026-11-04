import type { AppliedPart } from './applied-part.ts';
import type { ContributionEntry } from './contribution-entry.ts';
import { resolvePartReference } from './resolve-part-references.ts';
import { rulePrefixOf } from './rule-prefix-of.ts';
import { rulesIn } from './rules-in.ts';

function actionRefs(part: AppliedPart): readonly string[] {
  return [
    ...Object.keys(part.actions).map((name) => `${part.target}.${name}`),
    ...Object.entries(part.entities).flatMap(([entity, patch]) =>
      Object.keys(patch.actions).map((name) => `${part.target}.${entity}.${name}`),
    ),
  ];
}

/** The contributions of the app (section 16.2.6): active ones and those dropped, with the reason. */
export function buildContributionEntries(
  parts: readonly AppliedPart[],
): readonly ContributionEntry[] {
  return parts
    .filter((part) => part.kind === 'contribution')
    .map((part) => ({
      id: part.trackId,
      kind: part.kind,
      from: part.declaredBy.id,
      to: part.target,
      when: part.whenNames,
      active: part.active,
      ...(part.droppedBecause === undefined ? {} : { droppedBecause: part.droppedBecause }),
      fields: Object.fromEntries(
        Object.entries(part.entities)
          .filter(
            ([, patch]) =>
              Object.keys(patch.fields).length + Object.keys(patch.relations).length > 0,
          )
          .map(([entity, patch]) => [
            `${part.target}.${entity}`,
            [...Object.keys(patch.fields), ...Object.keys(patch.relations)],
          ]),
      ),
      actions: actionRefs(part),
      rules: [...rulesIn(part.policies, rulePrefixOf(part))].map(({ id }) => id),
      reactions: Object.entries(part.reactions).map(
        ([key, reaction]) => resolvePartReference(reaction) ?? `${part.target}.${key}`,
      ),
      fills: Object.keys(part.fills).map((name) => `${part.target}.${name}`),
    }));
}
