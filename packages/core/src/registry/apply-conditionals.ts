import { allPresent } from './all-present.ts';
import type { AppSelection } from './app-selection.ts';
import type { AppliedPart } from './applied-part.ts';
import { dependencyName } from './dependency-name.ts';
import type { RuntimeModule } from './runtime-module.ts';
import { trackIdOf } from './track-id-of.ts';

/** Every conditional part of the ordered modules: active when every `when` module and contract is present (section 5.4). */
export function applyConditionals(
  selection: AppSelection,
  ordered: readonly RuntimeModule[],
): readonly AppliedPart[] {
  return ordered.flatMap((module) =>
    module.conditional.map((conditional): AppliedPart => {
      const whenNames = conditional.when.map(dependencyName);
      const active = allPresent(selection, conditional.when);
      return {
        trackId: trackIdOf(module.id, null, whenNames),
        kind: 'conditional',
        key: conditional.key,
        declaredBy: module,
        target: module.id,
        when: conditional.when,
        whenNames,
        active,
        ...(active ? {} : { droppedBecause: 'whenUnsatisfied' as const }),
        entities: conditional.entities,
        actions: conditional.actions,
        policies: conditional.policies,
        reactions: conditional.reactions,
        fills: conditional.fills,
      };
    }),
  );
}
