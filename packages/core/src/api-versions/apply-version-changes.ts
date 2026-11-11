import type { ApiVersions } from '../dsl/define-api-versions.ts';
import type { Registry } from '../registry/registry.ts';
import type { VersionChangeEntry } from '../registry/version-change-entry.ts';
import { actionsAt } from './actions-at-point.ts';
import { entityPositions } from './entity-positions.ts';
import { orderVersionChanges } from './order-version-changes.ts';
import type { VersionTranslation } from './version-translation.ts';

/** The changes a version lacks, oldest first: every registered change that no version up to this one adopts, in the order of `orderVersionChanges`. */
function lackingOf(input: {
  readonly registry: Registry;
  readonly api: ApiVersions | null | undefined;
  readonly apiVersion: string | null;
  readonly only?: readonly string[];
}): readonly VersionChangeEntry[] {
  const { registry, api, apiVersion } = input;
  if (input.only !== undefined) {
    return input.only.flatMap((id) => {
      const change = registry.versionChanges.get(id);
      return change === undefined ? [] : [change];
    });
  }
  if (apiVersion === null) return [];
  const own = api?.dates.indexOf(apiVersion) ?? -1;
  return orderVersionChanges(registry, api)
    .filter(({ adopted }) => adopted === -1 || adopted > own)
    .map(({ change }) => change);
}

/** The entities whose relations lead, directly or through other entities, to one of `changed`: a filter on them can name a changed field. */
function entitiesReaching(registry: Registry, changed: ReadonlySet<string>): ReadonlySet<string> {
  const reaching = new Set(changed);
  let grew = true;
  while (grew) {
    grew = false;
    for (const entity of registry.entities.values()) {
      if (reaching.has(entity.ref)) continue;
      const related = Object.values(entity.descriptor.relations).some((relation) =>
        reaching.has(relation.target),
      );
      if (related) {
        reaching.add(entity.ref);
        grew = true;
      }
    }
  }
  return reaching;
}

/**
 * The translation of one API version (section 18.2): the changes it lacks, the actions they touch,
 * the references and error codes the version shows. Pure; ids the registry lacks are skipped, the
 * compose check reports them. `only` names exactly the changes to apply, in that order, instead of
 * what the version lacks (the fixtures run one change at a time).
 */
export function applyVersionChanges(input: {
  readonly registry: Registry;
  readonly api: ApiVersions | null | undefined;
  readonly apiVersion: string | null;
  readonly only?: readonly string[];
}): VersionTranslation {
  const { registry } = input;
  const lacking = lackingOf(input);
  const newestFirst = [...lacking].reverse();
  const ordered = orderVersionChanges(registry, input.api).map(({ change }) => change);
  const keys = new Map<string, ReadonlyMap<string, string>>();
  const heads = new Map<string, ReadonlyMap<string, string>>();
  for (const change of lacking) {
    const named = actionsAt(registry, ordered.slice(ordered.indexOf(change) + 1));
    heads.set(change.id, named);
    const differing = new Map<string, string>();
    for (const [key, head] of named) if (key !== head) differing.set(head, key);
    if (differing.size > 0) keys.set(change.id, differing);
  }
  const touched = new Set<string>();
  const headRefs = new Map<string, string>();
  const versionRefs = new Map<string, string>();
  const errorCodes = new Map<string, string>();
  if (lacking.length > 0) {
    const entities = new Set<string>();
    for (const change of lacking) {
      for (const spec of change.surface) {
        if (spec.entity !== undefined && spec.field !== undefined) entities.add(spec.entity);
      }
      for (const key of [...Object.keys(change.input), ...Object.keys(change.output)]) {
        const head = heads.get(change.id)?.get(key);
        if (head !== undefined) touched.add(head);
      }
    }
    const reaching = entitiesReaching(registry, entities);
    const declared = new Set<string>();
    for (const action of registry.actions.values()) {
      const positions = entityPositions(action);
      if (positions !== undefined) {
        if (entities.has(positions.entity)) touched.add(action.ref);
        else if (positions.filters.length > 0 && reaching.has(positions.entity)) {
          touched.add(action.ref);
        }
      }
      for (const code of action.errors) declared.add(code);
      let shown = action.ref;
      for (const change of newestFirst) {
        const renamed = change.surface.find((spec) => spec.action === shown);
        if (renamed?.renamedFrom !== undefined) {
          shown = renamed.renamedFrom;
          touched.add(action.ref);
        }
      }
      if (shown !== action.ref) {
        versionRefs.set(action.ref, shown);
        headRefs.set(shown, action.ref);
      }
    }
    for (const code of declared) {
      let shown = code;
      for (const change of newestFirst) shown = change.errors[shown] ?? shown;
      if (shown !== code) errorCodes.set(code, shown);
    }
    if (errorCodes.size > 0) {
      for (const action of registry.actions.values()) {
        if (action.errors.some((code) => errorCodes.has(code))) touched.add(action.ref);
      }
    }
  }
  return {
    registry,
    apiVersion: input.apiVersion,
    lacking,
    touched,
    keys,
    headRefs,
    versionRefs,
    errorCodes,
  };
}
