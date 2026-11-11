import type { VersionChange } from '../api-versions/version-change.ts';
import type { RuntimeModule } from './runtime-module.ts';
import type { VersionChangeEntry } from './version-change-entry.ts';

interface SurfaceView {
  readonly entity?: unknown;
  readonly action?: string;
  readonly field?: string;
  readonly renamedFrom?: string;
  readonly addedRequired?: true;
  readonly removed?: true;
}

interface ChangeSpecView extends Omit<VersionChange<unknown>, 'surface'> {
  readonly surface: readonly SurfaceView[];
}

function entityRef(module: RuntimeModule, entity: unknown): string | undefined {
  const own = Object.entries(module.base.entities ?? {}).find(([, value]) => value === entity);
  return own === undefined ? undefined : `${module.id}.${own[0]}`;
}

/** The version changes the modules mount, by id '<module>.<key>'. */
export function buildVersionChangeEntries(
  ordered: readonly RuntimeModule[],
): ReadonlyMap<string, VersionChangeEntry> {
  const changes = new Map<string, VersionChangeEntry>();
  for (const module of ordered) {
    for (const [key, part] of Object.entries(module.changes)) {
      const id = `${module.id}.${key}`;
      const spec = Reflect.get(part, 'spec') as ChangeSpecView;
      changes.set(id, {
        id,
        module: module.id,
        key,
        since: spec.since,
        surface: spec.surface.map((change) => {
          const { entity, ...rest } = change;
          const resolved = entity === undefined ? undefined : entityRef(module, entity);
          return resolved === undefined ? rest : { entity: resolved, ...rest };
        }),
        input: spec.input ?? {},
        output: spec.output ?? {},
        errors: spec.errors ?? {},
        fixtures: spec.fixtures ?? [],
      });
    }
  }
  return changes;
}
