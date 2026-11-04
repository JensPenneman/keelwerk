import { coreApiVersions } from '../core-module/core-api-versions.ts';
import type { ActionEntry } from './action-entry.ts';
import type { ComposableApp } from './composable-app.ts';
import type { EntityModel } from './entity-model.ts';
import type { GeneratedActionKind } from './generated-action-kind.ts';
import { generatedActionSchemas } from './generated-action-schemas.ts';
import { generatedHandler } from './generated-handler.ts';
import { scopeOfTenancy } from './scope-of-tenancy.ts';

const commandKinds: ReadonlySet<GeneratedActionKind> = new Set([
  'create',
  'update',
  'archive',
  'restore',
  'set',
]);
const instanceKinds: ReadonlySet<GeneratedActionKind> = new Set(['update', 'archive', 'restore']);
const pagedKinds: ReadonlySet<GeneratedActionKind> = new Set(['query', 'queryChanges']);

/** The registry entries of the actions the core generates for one entity (section 6.7). */
export function generatedActionEntries(
  model: EntityModel,
  app: ComposableApp,
): readonly ActionEntry[] {
  const { entry } = model;
  const since =
    (entry.module === 'core'
      ? coreApiVersions.dates
      : (app.api?.dates ?? coreApiVersions.dates))[0] ?? coreApiVersions.head;
  return entry.generated.map((kind): ActionEntry => {
    const ref = `${entry.ref}.${kind}`;
    const command = commandKinds.has(kind);
    const schemas = generatedActionSchemas(kind, model.fields);
    return {
      ref,
      module: entry.module,
      entity: entry.ref,
      name: kind,
      mount: 'entity',
      kind: command ? 'command' : kind === 'watch' ? 'subscription' : 'query',
      generated: kind,
      instance: instanceKinds.has(kind),
      input: schemas.input,
      output: schemas.output,
      errors: [],
      auth: 'policy',
      scope: scopeOfTenancy(model.tenancy),
      execution: command ? (app.execution[ref] ?? 'sync') : 'sync',
      idempotent: !command,
      offline: false,
      resumable: kind === 'watch',
      ...(pagedKinds.has(kind) ? { page: entry.page } : {}),
      hints: {},
      since,
      changedIn: [],
      handler: generatedHandler,
    };
  });
}
