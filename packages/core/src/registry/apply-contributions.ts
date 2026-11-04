import { allPresent } from './all-present.ts';
import type { AppSelection } from './app-selection.ts';
import type { AppliedPart } from './applied-part.ts';
import { dependencyName } from './dependency-name.ts';
import type { RuntimeModule } from './runtime-module.ts';
import { trackIdOf } from './track-id-of.ts';

/**
 * Every contribution of the ordered modules, active or not: active when the target is selected and
 * the `when` list is present, otherwise dropped without error (section 5.3).
 */
export function applyContributions(
  selection: AppSelection,
  ordered: readonly RuntimeModule[],
): readonly AppliedPart[] {
  return ordered.flatMap((module) =>
    module.contributes.map((contribution): AppliedPart => {
      const whenNames = contribution.when.map(dependencyName);
      const targetPresent = selection.byId.has(contribution.to.id);
      const whenPresent = allPresent(selection, contribution.when);
      const active = targetPresent && whenPresent;
      return {
        trackId: trackIdOf(module.id, contribution.to.id, whenNames),
        kind: 'contribution',
        key: contribution.key,
        declaredBy: module,
        target: contribution.to.id,
        when: contribution.when,
        whenNames,
        active,
        ...(active ? {} : { droppedBecause: targetPresent ? 'whenUnsatisfied' : 'targetAbsent' }),
        entities: contribution.entities,
        actions: contribution.actions,
        policies: contribution.policies,
        reactions: contribution.reactions,
        fills: contribution.fills,
      };
    }),
  );
}
