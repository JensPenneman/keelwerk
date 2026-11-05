import { canonicalizeJson } from '../json/canonicalize-json.ts';
import type { ApiSurface } from '../surface/api-surface.ts';
import type { FieldNode } from '../surface/field-node.ts';
import { classifySurfaceChange } from './classify-surface-change.ts';
import { diffFieldNode } from './diff-field-node.ts';
import type { SurfaceChange, SurfaceChangeKind } from './surface-change.ts';

type Found = { readonly kind: SurfaceChangeKind; readonly ref: string; readonly message: string };

function byRef<T extends { readonly ref: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.ref, item]));
}

function nodes(
  base: FieldNode,
  head: FieldNode,
  side: 'input' | 'output',
  ref: string,
): readonly Found[] {
  return diffFieldNode(base, head, side, '').map((found) => ({
    kind: found.kind,
    ref: found.path === '' ? ref : `${ref}.${found.path}`,
    message: found.message,
  }));
}

function executionLeavesSync(from: string, to: string): boolean {
  return from === 'sync' || (from === 'either' && to === 'async');
}

function diffActions(base: ApiSurface, head: ApiSurface): readonly Found[] {
  const found: Found[] = [];
  const before = byRef(base.actions);
  const after = byRef(head.actions);
  for (const [ref, action] of before) {
    const next = after.get(ref);
    if (next === undefined) {
      found.push({ kind: 'actionRemoved', ref, message: 'The action was removed.' });
      continue;
    }
    if (action.kind !== next.kind) {
      found.push({
        kind: 'actionKindChanged',
        ref,
        message: `The action changed from a ${action.kind} to a ${next.kind}.`,
      });
    }
    if (action.execution !== next.execution) {
      found.push({
        kind: executionLeavesSync(action.execution, next.execution)
          ? 'executionLeftSync'
          : 'executionChanged',
        ref,
        message: `The execution mode changed from ${action.execution} to ${next.execution}.`,
      });
    }
    if (action.auth !== next.auth) {
      found.push({
        kind: 'authChanged',
        ref,
        message: `The action's auth changed from ${action.auth} to ${next.auth}.`,
      });
    }
    if (action.scope !== next.scope) {
      found.push({
        kind: 'scopeChanged',
        ref,
        message: `The action's scope changed from ${action.scope} to ${next.scope}.`,
      });
    }
    if (action.instance !== next.instance) {
      found.push({
        kind: 'instanceChanged',
        ref,
        message: `The action now ${next.instance ? 'takes' : 'no longer takes'} an instance id.`,
      });
    }
    if (action.mount !== next.mount) {
      found.push({
        kind: 'metadataChanged',
        ref,
        message: `The action's mount changed from ${action.mount} to ${next.mount}.`,
      });
    }
    if (action.idempotent !== next.idempotent) {
      found.push({
        kind: 'metadataChanged',
        ref,
        message: `The action is ${next.idempotent ? 'now' : 'no longer'} idempotent.`,
      });
    }
    found.push(...nodes(action.input, next.input, 'input', `${ref}.input`));
    found.push(...nodes(action.output, next.output, 'output', `${ref}.output`));
    for (const code of next.errors.filter((item) => !action.errors.includes(item))) {
      found.push({ kind: 'declaredErrorAdded', ref, message: `The action declares ${code}.` });
    }
    for (const code of action.errors.filter((item) => !next.errors.includes(item))) {
      found.push({
        kind: 'declaredErrorRemoved',
        ref,
        message: `The action no longer declares ${code}.`,
      });
    }
  }
  for (const ref of after.keys()) {
    if (!before.has(ref)) found.push({ kind: 'actionAdded', ref, message: 'The action is new.' });
  }
  return found;
}

function diffEntities(base: ApiSurface, head: ApiSurface): readonly Found[] {
  const found: Found[] = [];
  const before = byRef(base.entities);
  const after = byRef(head.entities);
  for (const [ref, entity] of before) {
    const next = after.get(ref);
    if (next === undefined) {
      found.push({ kind: 'entityRemoved', ref, message: 'The entity was removed.' });
      continue;
    }
    const names = [...new Set([...Object.keys(entity.fields), ...Object.keys(next.fields)])];
    for (const name of names.toSorted()) {
      const was = entity.fields[name];
      const now = next.fields[name];
      const at = `${ref}.${name}`;
      if (was !== undefined && now !== undefined) found.push(...nodes(was, now, 'output', at));
      else if (was !== undefined) {
        found.push({
          kind: 'outputFieldRemoved',
          ref: at,
          message: 'The entity field was removed.',
        });
      } else {
        found.push({ kind: 'outputFieldAdded', ref: at, message: 'The entity field is new.' });
      }
    }
  }
  for (const ref of after.keys()) {
    if (!before.has(ref)) found.push({ kind: 'entityAdded', ref, message: 'The entity is new.' });
  }
  return found;
}

function diffEvents(base: ApiSurface, head: ApiSurface): readonly Found[] {
  const found: Found[] = [];
  const key = (event: { readonly entity: string; readonly name: string }): string =>
    `${event.entity}#${event.name}`;
  const before = new Map(base.events.map((event) => [key(event), event]));
  const after = new Map(head.events.map((event) => [key(event), event]));
  for (const [ref, event] of before) {
    const next = after.get(ref);
    if (next === undefined) {
      found.push({ kind: 'eventRemoved', ref, message: 'The event was removed.' });
    } else if (event.data !== undefined && next.data !== undefined) {
      found.push(...nodes(event.data, next.data, 'output', ref));
    } else if (event.data !== undefined) {
      found.push({ kind: 'outputFieldRemoved', ref, message: 'The event no longer carries data.' });
    } else if (next.data !== undefined) {
      found.push({ kind: 'outputFieldAdded', ref, message: 'The event now carries data.' });
    }
  }
  for (const ref of after.keys()) {
    if (!before.has(ref)) found.push({ kind: 'eventAdded', ref, message: 'The event is new.' });
  }
  return found;
}

function diffErrors(base: ApiSurface, head: ApiSurface): readonly Found[] {
  const found: Found[] = [];
  const before = new Map(base.errors.map((error) => [error.code, error]));
  const after = new Map(head.errors.map((error) => [error.code, error]));
  for (const [code, error] of before) {
    const next = after.get(code);
    if (next === undefined) {
      found.push({ kind: 'errorRemoved', ref: code, message: 'The error code was removed.' });
    } else {
      if (next.kind !== error.kind) {
        found.push({
          kind: 'errorKindChanged',
          ref: code,
          message: `The error code changed from kind ${error.kind} to ${next.kind}.`,
        });
      }
      if (next.retryable !== error.retryable) {
        found.push({
          kind: 'metadataChanged',
          ref: code,
          message: `The error is ${next.retryable ? 'now' : 'no longer'} retryable.`,
        });
      }
      if (canonicalizeJson(error.data ?? null) !== canonicalizeJson(next.data ?? null)) {
        found.push({
          kind: 'metadataChanged',
          ref: code,
          message: 'The error data changed.',
        });
      }
    }
  }
  for (const code of after.keys()) {
    if (!before.has(code))
      found.push({ kind: 'errorAdded', ref: code, message: 'The error code is new.' });
  }
  return found;
}

function diffModules(base: ApiSurface, head: ApiSurface): readonly Found[] {
  const before = new Map(base.modules.map((module) => [module.id, module.version]));
  const after = new Map(head.modules.map((module) => [module.id, module.version]));
  const found: Found[] = [];
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    if (before.get(id) !== after.get(id)) {
      found.push({
        kind: 'moduleChanged',
        ref: id,
        message: `The module went from ${before.get(id) ?? 'absent'} to ${after.get(id) ?? 'absent'}.`,
      });
    }
  }
  return found;
}

/**
 * Every difference between two surfaces of one app, classified (section 18.6): actions, entities,
 * events, error codes and modules, sorted by reference and kind. Two surfaces are compared as they
 * are: the diff assumes no translation between versions, so a surface of another version is just
 * another surface.
 */
export function diffSurfaces(base: ApiSurface, head: ApiSurface): readonly SurfaceChange[] {
  return [
    ...diffActions(base, head),
    ...diffEntities(base, head),
    ...diffEvents(base, head),
    ...diffErrors(base, head),
    ...diffModules(base, head),
  ]
    .map((found) => ({ ...found, class: classifySurfaceChange(found.kind) }))
    .toSorted((left, right) =>
      left.ref === right.ref
        ? left.kind < right.kind
          ? -1
          : left.kind > right.kind
            ? 1
            : 0
        : left.ref < right.ref
          ? -1
          : 1,
    );
}
