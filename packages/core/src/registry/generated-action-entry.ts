import { coreApiVersions } from '../core-module/core-api-versions.ts';
import type { ApiVersions } from '../dsl/define-api-versions.ts';
import type { ActionEntry } from './action-entry.ts';
import type { ComposableApp } from './composable-app.ts';
import type { EntityEntry } from './entity-entry.ts';
import type { GeneratedActionKind } from './generated-action-kind.ts';
import type { GeneratedSchemas } from './generated-action-schemas.ts';
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
const rowKinds: ReadonlySet<GeneratedActionKind> = new Set([
  'create',
  'update',
  'archive',
  'restore',
]);
const pagedKinds: ReadonlySet<GeneratedActionKind> = new Set(['query', 'queryChanges']);

/** What the entry of a generated action reads besides the entity: the schemas the caller chose, the app's versions and its execution overrides. */
export interface GeneratedActionContext {
  readonly schemas: GeneratedSchemas;
  readonly api: ApiVersions | null | undefined;
  readonly execution: ComposableApp['execution'];
}

/**
 * The registry entry of one generated action of an entity (section 6.7): the one place that decides
 * its `since`, scope, idempotency, resumability, page and handler. The registry builds its entries
 * with the schemas derived from the entity's fields; the live kernel builds the watch entry of an
 * entity the app does not generate `watch` for, with schemas nothing validates against.
 */
export function generatedActionEntry(
  entry: EntityEntry,
  kind: GeneratedActionKind,
  context: GeneratedActionContext,
): ActionEntry {
  const since =
    (entry.module === 'core'
      ? coreApiVersions.dates
      : (context.api?.dates ?? coreApiVersions.dates))[0] ?? coreApiVersions.head;
  const ref = `${entry.ref}.${kind}`;
  const command = commandKinds.has(kind);
  return {
    ref,
    module: entry.module,
    entity: entry.ref,
    name: kind,
    mount: 'entity',
    kind: command ? 'command' : kind === 'watch' ? 'subscription' : 'query',
    generated: kind,
    instance: instanceKinds.has(kind),
    input: context.schemas.input,
    output: context.schemas.output,
    ...(rowKinds.has(kind) ? { entityOutput: { entity: entry.ref, shape: 'row' as const } } : {}),
    errors: [],
    auth: 'policy',
    scope: scopeOfTenancy(entry.descriptor.tenancy),
    execution: command ? (context.execution[ref] ?? 'sync') : 'sync',
    idempotent: !command,
    offline: false,
    resumable: kind === 'watch',
    ...(pagedKinds.has(kind) ? { page: entry.page } : {}),
    hints: {},
    since,
    changedIn: [],
    handler: generatedHandler,
  };
}
