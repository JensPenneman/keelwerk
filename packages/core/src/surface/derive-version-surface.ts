import { adoptedChanges } from '../api-versions/adopted-changes.ts';
import { applyVersionChanges } from '../api-versions/apply-version-changes.ts';
import { entityPositions } from '../api-versions/entity-positions.ts';
import type { FieldChange } from '../api-versions/field-change.ts';
import { fieldChangesOf } from '../api-versions/field-changes-of.ts';
import { compareCodePoints } from '../conditions/compare-code-points.ts';
import type { ApiVersions } from '../dsl/define-api-versions.ts';
import type { Registry } from '../registry/registry.ts';
import type { ApiSurface } from './api-surface.ts';
import type { FieldNode } from './field-node.ts';
import type { PageSpec } from './page-spec.ts';
import type { SurfaceAction } from './surface-action.ts';
import type { SurfaceEntity } from './surface-entity.ts';
import type { SurfaceError } from './surface-error.ts';
import type { SurfaceEvent } from './surface-event.ts';
import { surfaceHash } from './surface-hash.ts';

type Fields = Readonly<Record<string, FieldNode>>;
type Edit = (fields: Fields) => Fields;

function sortedRecord<V>(entries: Iterable<readonly [string, V]>): Record<string, V> {
  return Object.fromEntries([...entries].sort(([left], [right]) => compareCodePoints(left, right)));
}

function removedNode(changeId: string): FieldNode {
  return {
    optional: true,
    access: 'read-write',
    kind: 'json',
    schema: {},
    input: {},
    output: {},
    deprecated: { reason: `Removed by ${changeId}.` },
  };
}

/** The member map as the older version had it: head to older, for one field change. */
function editOf(change: FieldChange, changeId: string): Edit {
  return (fields) => {
    if (change.kind === 'renamed') {
      if (!Object.hasOwn(fields, change.field)) return fields;
      return Object.fromEntries(
        Object.entries(fields).map(([name, node]) => [
          name === change.field ? change.was : name,
          node,
        ]),
      );
    }
    if (change.kind === 'added') {
      return Object.fromEntries(Object.entries(fields).filter(([name]) => name !== change.field));
    }
    return Object.hasOwn(fields, change.field)
      ? fields
      : { ...fields, [change.field]: removedNode(changeId) };
  };
}

/** Edits the member map of the shape `path` reaches; `'*'` steps into a list, set or page item and `items` is the page itself. */
function editNode(node: FieldNode, path: readonly string[], edit: Edit): FieldNode {
  const [step, ...rest] = path;
  if (step === undefined)
    return node.kind === 'shape' ? { ...node, fields: edit(node.fields) } : node;
  if (step === '*') {
    return node.kind === 'list' || node.kind === 'set' || node.kind === 'page'
      ? { ...node, item: editNode(node.item, rest, edit) }
      : node;
  }
  if (node.kind === 'page' && step === 'items') return editNode(node, rest, edit);
  if (node.kind !== 'shape') return node;
  const child = node.fields[step];
  return child === undefined
    ? node
    : { ...node, fields: { ...node.fields, [step]: editNode(child, rest, edit) } };
}

function editPage(page: PageSpec, change: FieldChange): PageSpec {
  if (change.kind === 'removed') return page;
  const was = change.kind === 'renamed' ? change.was : undefined;
  const sortable = page.sortable.flatMap((name) => {
    if (name !== change.field) return [name];
    return was === undefined ? [] : [was];
  });
  const defaultSort = page.defaultSort.flatMap((sort) => {
    if (sort.field !== change.field) return [sort];
    return was === undefined ? [] : [{ ...sort, field: was }];
  });
  return { ...page, sortable: sortable.sort(compareCodePoints), defaultSort };
}

function editEntity(entity: SurfaceEntity, change: FieldChange, changeId: string): SurfaceEntity {
  if (entity.ref === change.entity) {
    const origin = Object.entries(entity.origin).flatMap(([name, module]): [string, string][] => {
      if (name !== change.field) return [[name, module]];
      return change.kind === 'renamed' ? [[change.was, module]] : [];
    });
    return {
      ...entity,
      fields: sortedRecord(Object.entries(editOf(change, changeId)(entity.fields))),
      page: editPage(entity.page, change),
      origin: sortedRecord(origin),
    };
  }
  if (change.kind !== 'renamed') return entity;
  const relations = Object.entries(entity.relations).map(
    ([name, relation]) =>
      [
        name,
        relation.target === change.entity && relation.by === change.field
          ? { ...relation, by: change.was }
          : relation,
      ] as const,
  );
  return { ...entity, relations: Object.fromEntries(relations) };
}

/**
 * The dates up to `apiVersion` that adopt a change, by the head refs of the actions it touches: a
 * later version adopting a change never alters the surface of an earlier one.
 */
function datesByAction(
  registry: Registry,
  api: ApiVersions | null | undefined,
  apiVersion: string,
): ReadonlyMap<string, readonly string[]> {
  const found = new Map<string, string[]>();
  for (const id of registry.versionChanges.keys()) {
    const dates = (api?.dates ?? []).filter(
      (date) => compareCodePoints(date, apiVersion) <= 0 && adoptedChanges(api, date).includes(id),
    );
    if (dates.length === 0) continue;
    const { touched } = applyVersionChanges({ registry, api, apiVersion: null, only: [id] });
    for (const ref of touched) found.set(ref, [...(found.get(ref) ?? []), ...dates]);
  }
  return found;
}

interface Work {
  readonly head: string;
  action: SurfaceAction;
  dirty: boolean;
}

/**
 * The head body of the surface seen at `body.apiVersion` (section 18.2): the changes the version
 * lacks undone newest first, then `changedIn` filled for every action a change an API version up to this one
 * adopts touches (a later version never alters it). A renamed field is the older one in the entity (fields, origin, sortable,
 * default sort), in the rows, selections and patches of its actions and in its events; an added
 * required field is gone; a removed field is an optional `json` member marked deprecated; a renamed
 * action carries its older reference and name; a renamed error code its older code (two head codes merged into one appear once). Returns `body`
 * itself when nothing lacks and no adopted change touches an action, so every surface without
 * changes keeps its bytes. What the compose check refuses is skipped.
 */
export function deriveVersionSurface(input: {
  readonly body: Omit<ApiSurface, 'hash'>;
  readonly registry: Registry;
  readonly api: ApiVersions | null | undefined;
}): Omit<ApiSurface, 'hash'> {
  const { body, registry, api } = input;
  const translation = applyVersionChanges({ registry, api, apiVersion: body.apiVersion });
  const dated = datesByAction(registry, api, body.apiVersion);
  if (translation.lacking.length === 0 && dated.size === 0) return body;
  let entities: readonly SurfaceEntity[] = body.entities;
  let events: readonly SurfaceEvent[] = body.events;
  let errors: readonly SurfaceError[] = body.errors;
  const works: Work[] = body.actions.map((action) => ({ head: action.ref, action, dirty: false }));
  for (const change of [...translation.lacking].reverse()) {
    for (const field of [...fieldChangesOf(change)].reverse()) {
      const edit = editOf(field, change.id);
      entities = entities.map((entity) => editEntity(entity, field, change.id));
      events = events.map((event) =>
        event.entity === field.entity && event.data !== undefined
          ? { ...event, data: editNode(event.data, [], edit) }
          : event,
      );
      for (const work of works) {
        const entry = registry.actions.get(work.head);
        const positions = entry === undefined ? undefined : entityPositions(entry);
        if (positions?.entity !== field.entity) continue;
        let { input: inputNode, output: outputNode } = work.action;
        for (const path of positions.inputRows) inputNode = editNode(inputNode, path, edit);
        for (const path of positions.outputRows) outputNode = editNode(outputNode, path, edit);
        const page = work.action.page === undefined ? undefined : editPage(work.action.page, field);
        work.action = {
          ...work.action,
          input: inputNode,
          output: outputNode,
          ...(page === undefined ? {} : { page }),
        };
        work.dirty = true;
      }
    }
    for (const spec of change.surface) {
      if (spec.action === undefined || spec.renamedFrom === undefined) continue;
      const work = works.find((item) => item.action.ref === spec.action);
      if (work === undefined) continue;
      work.action = {
        ...work.action,
        ref: spec.renamedFrom,
        name: spec.renamedFrom.split('.').at(-1) ?? spec.renamedFrom,
      };
    }
    const codes = Object.entries(change.errors);
    if (codes.length > 0) {
      const rename = (code: string): string => change.errors[code] ?? code;
      for (const work of works) {
        if (!work.action.errors.some((code) => Object.hasOwn(change.errors, code))) continue;
        work.action = {
          ...work.action,
          errors: work.action.errors.map(rename).sort(compareCodePoints),
        };
      }
      const seen = new Set<string>();
      errors = errors
        .map((error) => ({ ...error, code: rename(error.code) }))
        .filter((error) => !seen.has(error.code) && seen.add(error.code));
    }
  }
  const actions = works.map((work) => {
    const dates = dated.get(work.head);
    const changedIn =
      dates === undefined
        ? work.action.changedIn
        : [...new Set([...work.action.changedIn, ...dates])].sort(compareCodePoints);
    if (!work.dirty && dates === undefined) return work.action;
    return {
      ...work.action,
      changedIn,
      ...(work.dirty
        ? {
            inputHash: surfaceHash(work.action.input),
            outputHash: surfaceHash(work.action.output),
          }
        : {}),
    };
  });
  return {
    ...body,
    entities: [...entities].sort((left, right) => compareCodePoints(left.ref, right.ref)),
    actions: actions.sort((left, right) => compareCodePoints(left.ref, right.ref)),
    errors: [...errors].sort((left, right) => compareCodePoints(left.code, right.code)),
    events,
  };
}
