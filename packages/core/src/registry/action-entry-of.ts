import { coreApiVersions } from '../core-module/core-api-versions.ts';
import { durationMs } from '../effects/duration-ms.ts';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import type { StandardSchemaV1 } from '../fields/standard-schema-v1.ts';
import type { AnyActionPart } from '../model/action-part.ts';
import type { ActionEntry } from './action-entry.ts';
import type { ActionHandler } from './action-handler.ts';
import { specOf } from './action-spec-view.ts';
import type { ComposableApp } from './composable-app.ts';
import type { EntityModel } from './entity-model.ts';
import { generatedHandler } from './generated-handler.ts';
import { permissiveSchema } from './permissive-schema.ts';
import { rowShape } from './row-shape.ts';
import { scopeOfTenancy } from './scope-of-tenancy.ts';
import { typedOutputSchema } from './typed-output-schema.ts';

function sinceOf(module: string, app: ComposableApp): string {
  const dates =
    module === 'core' ? coreApiVersions.dates : (app.api?.dates ?? coreApiVersions.dates);
  return dates[0] ?? coreApiVersions.head;
}

/** Entity commands target a row, unless they declare that they create rows (F-11b change note). */
function isInstance(part: AnyActionPart, mount: PartMount): boolean {
  return part.kind === 'command' && mount.mount === 'entity' && specOf(part).creates !== true;
}

function inputOf(
  part: AnyActionPart,
  mount: PartMount,
  context: ActionEntryContext,
): StandardSchemaV1 {
  const input = specOf(part).input;
  const instance = isInstance(part, mount);
  const paged = isPaged(part, context);
  if (input === undefined) {
    return shape({
      ...(instance ? { id: field.string(), ifVersion: field.integer().optional() } : {}),
      ...(paged ? { first: field.integer().optional(), after: field.string().optional() } : {}),
    });
  }
  if (input.kind !== 'shape' || input.fields === undefined) return permissiveSchema();
  if (!(instance || paged)) return input as unknown as StandardSchemaV1;
  return shape({
    ...(input.fields as Parameters<typeof shape>[0]),
    ...(instance ? { id: field.string(), ifVersion: field.integer().optional() } : {}),
    ...(paged ? { first: field.integer().optional(), after: field.string().optional() } : {}),
  });
}

function modelOfOutput(part: AnyActionPart, context: ActionEntryContext): EntityModel | undefined {
  const entity = specOf(part).output?.entity;
  if (entity === undefined) return undefined;
  return [...context.entities.values()].find((model) => model.entry.prefix === entity.prefix);
}

function isPaged(part: AnyActionPart, context: ActionEntryContext): boolean {
  return (
    part.kind === 'query' &&
    specOf(part).output?.form === 'page' &&
    modelOfOutput(part, context) !== undefined
  );
}

function outputOf(
  part: AnyActionPart,
  mount: PartMount,
  context: ActionEntryContext,
): StandardSchemaV1 {
  const output = specOf(part).output;
  const model = modelOfOutput(part, context);
  if (output?.kind === 'entityOutput' && model !== undefined) {
    const row = rowShape(model.fields);
    return output.form === 'page'
      ? shape({
          items: field.list(field.json(row)),
          pageInfo: field.json(permissiveSchema()),
          queryState: field.string(),
        })
      : row;
  }
  if (output?.kind === 'typedOutput') return typedOutputSchema();
  if (output !== undefined && output.kind === 'shape') return output as unknown as StandardSchemaV1;
  if (mount.mount === 'entity' && part.kind === 'command' && mount.entity !== undefined) {
    const own = context.entities.get(`${mount.module}.${mount.entity}`);
    return own === undefined ? permissiveSchema() : rowShape(own.fields);
  }
  return shape({});
}

function entityOutputMarker(
  part: AnyActionPart,
  mount: PartMount,
  context: ActionEntryContext,
): ActionEntry['entityOutput'] {
  const output = specOf(part).output;
  const model = modelOfOutput(part, context);
  if (output?.kind === 'entityOutput' && model !== undefined) {
    return { entity: model.entry.ref, shape: output.form === 'page' ? 'page' : 'row' };
  }
  if (output === undefined && mount.mount === 'entity' && part.kind === 'command') {
    const own = mount.entity === undefined ? undefined : `${mount.module}.${mount.entity}`;
    return own !== undefined && context.entities.has(own)
      ? { entity: own, shape: 'row' }
      : undefined;
  }
  return undefined;
}

function pageOf(part: AnyActionPart, context: ActionEntryContext): ActionEntry['page'] {
  const spec = specOf(part);
  const model = modelOfOutput(part, context);
  if (part.kind !== 'query' || model === undefined || spec.output?.form !== 'page')
    return undefined;
  const defaults = model.entry.page;
  return {
    sortable: spec.page?.sortable ?? defaults.sortable,
    defaultSort: defaults.defaultSort,
    defaultSize: spec.page?.defaultSize ?? defaults.defaultSize,
    maxSize: spec.page?.maxSize ?? defaults.maxSize,
  };
}

function handlerOf(part: AnyActionPart): ActionHandler {
  const spec = specOf(part);
  return spec.decide ?? spec.read ?? spec.source ?? generatedHandler;
}

/** Where an action part is mounted and who mounted it. */
export interface PartMount {
  readonly ref: string;
  readonly module: string;
  readonly entity?: string;
  readonly name: string;
  readonly mount: ActionEntry['mount'];
  readonly contributedBy?: string;
}

/** What building the entry of one action part reads of the app. */
export interface ActionEntryContext {
  readonly app: ComposableApp;
  readonly entities: ReadonlyMap<string, EntityModel>;
}

/** The registry entry of a custom action part (section 16.2.2), after the app's execution overrides. */
export function actionEntryOf(
  part: AnyActionPart,
  mount: PartMount,
  context: ActionEntryContext,
): ActionEntry {
  const spec = specOf(part);
  const model =
    mount.entity === undefined
      ? undefined
      : context.entities.get(`${mount.module}.${mount.entity}`);
  const principal = spec.principal === undefined ? undefined : [spec.principal].flat();
  const page = pageOf(part, context);
  const entityOutput = entityOutputMarker(part, mount, context);
  const execution =
    part.kind === 'command' ? (context.app.execution[mount.ref] ?? part.execution) : 'sync';
  const prepare = spec.prepare;
  const handler = handlerOf(part);
  return {
    ref: mount.ref,
    module: mount.module,
    ...(mount.entity === undefined ? {} : { entity: `${mount.module}.${mount.entity}` }),
    name: mount.name,
    mount: mount.mount,
    kind: part.kind,
    instance: isInstance(part, mount),
    input: inputOf(part, mount, context),
    output: outputOf(part, mount, context),
    ...(entityOutput === undefined ? {} : { entityOutput }),
    errors: (spec.errors ?? []).map((error) => error.code).sort(),
    auth: spec.auth === undefined || spec.auth === 'policy' ? 'policy' : 'public',
    scope: spec.scope ?? (model === undefined ? 'tenant' : scopeOfTenancy(model.tenancy)),
    execution,
    idempotent: part.kind === 'query' ? true : (spec.idempotent ?? false),
    offline: spec.offline ?? false,
    resumable: part.kind === 'subscription' && handler.length >= 3,
    ...(principal === undefined ? {} : { principal }),
    ...(page === undefined ? {} : { page }),
    ...(spec.timeoutMs === undefined ? {} : { timeoutMs: spec.timeoutMs }),
    ...(spec.idempotency === undefined
      ? {}
      : { idempotencyWindowMs: durationMs(spec.idempotency.window) }),
    ...(spec.gate === undefined ? {} : { gate: spec.gate }),
    ...(spec.trace === undefined || part.kind !== 'command' ? {} : { trace: spec.trace }),
    ...(spec.shownOnce === undefined || part.kind !== 'command'
      ? {}
      : { shownOnce: spec.shownOnce }),
    hints: spec.hints ?? {},
    ...(mount.contributedBy === undefined ? {} : { contributedBy: mount.contributedBy }),
    ...(spec.description === undefined ? {} : { description: spec.description }),
    ...(spec.deprecated === undefined ? {} : { deprecated: spec.deprecated }),
    since: sinceOf(mount.module, context.app),
    changedIn: [],
    handler,
    ...(prepare === undefined ? {} : { prepare }),
  };
}
