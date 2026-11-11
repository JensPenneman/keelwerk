import { actionsAt } from '../api-versions/actions-at-point.ts';
import { adoptedChanges } from '../api-versions/adopted-changes.ts';
import { orderVersionChanges } from '../api-versions/order-version-changes.ts';
import { checkVersionChangeChain } from './check-version-change-chain.ts';
import type { ComposableApp } from './composable-app.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';
import type { Registry } from './registry.ts';
import type { VersionChangeEntry } from './version-change-entry.ts';

function invalid(change: VersionChangeEntry, message: string): CompositionProblem {
  return compositionError('invalidVersionChange', `The change '${change.id}' ${message}`, {
    module: change.module,
    ref: change.id,
  });
}

function problemsOfKeys(
  change: VersionChangeEntry,
  newer: readonly VersionChangeEntry[],
  registry: Registry,
): readonly CompositionProblem[] {
  const problems: CompositionProblem[] = [];
  const keyed = [
    ...Object.keys(change.input),
    ...Object.keys(change.output),
    ...change.fixtures.map((fixture) => fixture.ref),
  ];
  const named = actionsAt(registry, newer);
  const point =
    newer.length === 0
      ? 'the head'
      : `the point of the change (the head's actions undone through ${newer.map((entry) => `'${entry.id}'`).join(', ')})`;
  for (const ref of new Set(keyed)) {
    if (!named.has(ref)) {
      problems.push(
        invalid(
          change,
          `names '${ref}' in a transform or fixture, which is not an action of the app at ${point} (a key names the action as it is on the newer side of the change).`,
        ),
      );
    }
  }
  return problems;
}

/**
 * The compose check of the version changes (section 18.2): every id a version adopts names a
 * registered change, no change is adopted twice, no adopted change is app-level (this release does
 * not serve them), the changes fit the head one after the other (`checkVersionChangeChain`), and
 * each key of a transform or fixture names an action as it is on the newer side of its change.
 */
export function checkVersionChanges(
  app: ComposableApp,
  registry: Registry,
): readonly CompositionProblem[] {
  const problems: CompositionProblem[] = [];
  const adopter = new Map<string, string>();
  for (const date of app.api?.dates ?? []) {
    const objects = (app.api?.versions[date]?.changes ?? []).filter(
      (change) => typeof change !== 'string',
    );
    if (objects.length > 0) {
      problems.push(
        compositionError(
          'appVersionChangeUnavailable',
          `The version '${date}' declares an app-level change, which this release does not serve.`,
          { ref: date },
        ),
      );
    }
    for (const id of adoptedChanges(app.api, date)) {
      if (!registry.versionChanges.has(id)) {
        problems.push(
          compositionError(
            'unknownVersionChange',
            `The version '${date}' adopts '${id}', which no module registers.`,
            { ref: id },
          ),
        );
      }
      const first = adopter.get(id);
      if (first === undefined) {
        adopter.set(id, date);
      } else {
        problems.push(
          compositionError(
            'versionChangeAdoptedTwice',
            `The change '${id}' is adopted by '${first}' and again by '${date}'.`,
            { ref: id },
          ),
        );
      }
    }
  }
  const ordered = orderVersionChanges(registry, app.api).map(({ change }) => change);
  problems.push(...checkVersionChangeChain(registry, ordered));
  ordered.forEach((change, index) => {
    problems.push(...problemsOfKeys(change, ordered.slice(index + 1), registry));
  });
  return problems;
}
