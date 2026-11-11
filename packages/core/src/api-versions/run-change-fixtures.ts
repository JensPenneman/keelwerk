import type { ApiVersions } from '../dsl/define-api-versions.ts';
import { canonicalizeJson } from '../json/canonicalize-json.ts';
import type { Registry } from '../registry/registry.ts';
import { actionsAt } from './actions-at-point.ts';
import { applyVersionChanges } from './apply-version-changes.ts';
import { orderVersionChanges } from './order-version-changes.ts';
import { translateInput } from './translate-input.ts';

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalizeJson(left) === canonicalizeJson(right);
}

/** One fixture of a version change that did not hold. */
export interface ChangeFixtureFailure {
  /** The change id, '<module>.<key>'. */
  readonly change: string;
  readonly ref: string;
  /** Position in the change's `fixtures`. */
  readonly index: number;
  readonly message: string;
}

/**
 * Runs every fixture of every registered change (section 18.2). A fixture is written in the names
 * of the newer side of its change: the older input translated through that change alone must equal
 * the newer one, and the newer one translated on through the later changes must fit the head
 * action's input schema. `api` orders the changes the way the compose check does (null: the app
 * declares no versions).
 */
export async function runChangeFixtures(
  registry: Registry,
  api: ApiVersions | null,
): Promise<readonly ChangeFixtureFailure[]> {
  const failures: ChangeFixtureFailure[] = [];
  const ordered = orderVersionChanges(registry, api).map(({ change }) => change);
  for (const change of registry.versionChanges.values()) {
    const later = ordered.slice(ordered.indexOf(change) + 1);
    const named = actionsAt(registry, later);
    const onwards = applyVersionChanges({
      registry,
      api,
      apiVersion: null,
      only: later.map(({ id }) => id),
    });
    const translation = applyVersionChanges({
      registry,
      api,
      apiVersion: null,
      only: [change.id],
    });
    for (const [index, fixture] of change.fixtures.entries()) {
      const fail = (message: string): void => {
        failures.push({ change: change.id, ref: fixture.ref, index, message });
      };
      const head = named.get(fixture.ref);
      const action = head === undefined ? undefined : registry.actions.get(head);
      if (action === undefined) {
        fail(`"${fixture.ref}" is not an action of the app.`);
        continue;
      }
      let translated: unknown;
      try {
        translated = translateInput(translation, action, fixture.older, later);
      } catch (error) {
        fail(`The translation threw: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      if (!sameJson(translated, fixture.newer)) {
        fail(
          `The older input translates to ${canonicalizeJson(translated)}, not to the newer input.`,
        );
        continue;
      }
      let atHead: unknown;
      try {
        atHead = translateInput(onwards, action, translated);
      } catch (error) {
        fail(`The later changes threw: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      const result = await action.input['~standard'].validate(atHead);
      if (result.issues !== undefined) {
        fail(
          `The translated input does not fit the input of "${action.ref}": ${result.issues
            .map((issue) => issue.message)
            .join('; ')}.`,
        );
      }
    }
  }
  return failures;
}
