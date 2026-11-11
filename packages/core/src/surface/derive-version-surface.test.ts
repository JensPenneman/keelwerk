import { describe, expect, test } from 'vitest';
import { appOf, shop } from '../../test/registry-kit.ts';
import { shelfApi, shelfApp } from '../../test/version-change-kit.ts';
import { defineApiVersions } from '../dsl/define-api-versions.ts';
import { buildRegistry } from '../registry/build-registry.ts';
import { deriveSurface } from './derive-surface.ts';
import { deriveVersionSurface } from './derive-version-surface.ts';
import type { FieldNode } from './field-node.ts';
import { renderSurfaceArtefact } from './render-surface-artefact.ts';

function fieldsOf(node: FieldNode | undefined): Readonly<Record<string, FieldNode>> {
  return node?.kind === 'shape' ? node.fields : {};
}

function surfaceAt(version: string, headChanges?: readonly string[]) {
  const { app, registry } = shelfApp(
    headChanges === undefined ? {} : { api: shelfApi(headChanges) },
  );
  return deriveSurface({ ...app, registry }, version);
}

describe('deriveVersionSurface (section 18.2)', () => {
  test('the older version shows the older field, action ref and error code; the head shows the code', () => {
    const older = surfaceAt('2026-11-04');
    const head = surfaceAt('2026-11-11');
    expect(older.problems).toEqual([]);
    const itemOlder = older.surface.entities.find((entity) => entity.ref === 'shelf.item');
    const itemHead = head.surface.entities.find((entity) => entity.ref === 'shelf.item');
    expect(Object.keys(itemHead?.fields ?? {})).toContain('label');
    expect(Object.keys(itemOlder?.fields ?? {})).toEqual(
      expect.arrayContaining(['title', 'colour', 'note', 'rackId']),
    );
    expect(Object.keys(itemOlder?.fields ?? {})).not.toContain('label');
    expect(Object.keys(itemOlder?.fields ?? {})).not.toContain('size');
    expect(itemOlder?.fields.colour).toMatchObject({
      kind: 'json',
      optional: true,
      deprecated: { reason: 'Removed by shelf.colourRemoved.' },
    });
    expect(older.surface.actions.map((action) => action.ref)).toContain('shelf.put');
    expect(older.surface.actions.map((action) => action.ref)).not.toContain('shelf.place');
    expect(head.surface.actions.map((action) => action.ref)).toContain('shelf.place');
    const put = older.surface.actions.find((action) => action.ref === 'shelf.put');
    expect(put).toMatchObject({ name: 'put', errors: ['shelf.no_room'] });
    expect(older.surface.errors.map((error) => error.code)).toContain('shelf.no_room');
    expect(older.surface.errors.map((error) => error.code)).not.toContain('shelf.full');
    expect(head.surface.errors.map((error) => error.code)).toContain('shelf.full');
  });

  test('rows, patches and the page of the entity follow the older names', () => {
    const { surface } = surfaceAt('2026-11-04');
    const create = surface.actions.find((action) => action.ref === 'shelf.item.create');
    const inputFields = Object.keys(fieldsOf(create?.input));
    expect(inputFields).toContain('title');
    expect(inputFields).toContain('colour');
    expect(inputFields).not.toContain('label');
    expect(inputFields).not.toContain('size');
    const update = surface.actions.find((action) => action.ref === 'shelf.item.update');
    expect(Object.keys(fieldsOf(fieldsOf(update?.input).patch))).toContain('title');
    const headCreate = surfaceAt('2026-11-11').surface.actions.find(
      (action) => action.ref === 'shelf.item.create',
    );
    expect(create?.inputHash).not.toBe(headCreate?.inputHash);
    expect(create?.outputHash).not.toBe(headCreate?.outputHash);
  });

  test('an app without changes derives byte-identical surfaces', () => {
    const app = appOf([shop]);
    const registry = buildRegistry(app);
    const derived = deriveSurface({ ...app, registry }, '2026-11-04');
    const body: Omit<typeof derived.surface, 'hash'> = { ...derived.surface };
    expect(deriveVersionSurface({ body, registry, api: app.api })).toBe(body);
  });

  test('changedIn lists the versions up to this one that adopt a change touching the action', () => {
    const older = surfaceAt('2026-11-04').surface;
    const head = surfaceAt('2026-11-11').surface;
    const refOf = (surface: typeof head, ref: string) =>
      surface.actions.find((action) => action.ref === ref)?.changedIn;
    expect(refOf(head, 'shelf.item.create')).toEqual(['2026-11-11']);
    expect(refOf(head, 'shelf.place')).toEqual(['2026-11-11']);
    expect(refOf(head, 'shelf.rack.create')).toEqual([]);
    expect(refOf(older, 'shelf.item.create')).toEqual([]);
    expect(refOf(older, 'shelf.put')).toEqual([]);
  });

  test('a released version keeps its surface and hash when a later version adopts changes', () => {
    const before = surfaceAt('2026-11-04', []);
    const { app, registry } = shelfApp({ api: shelfApi() });
    const after = deriveSurface({ ...app, registry }, '2026-11-04');
    expect(after.surface.hash).toBe(before.surface.hash);
    expect(renderSurfaceArtefact(after.surface)).toBe(renderSurfaceArtefact(before.surface));
    const lone = shelfApp({ api: defineApiVersions({ '2026-11-04': {} }) });
    const alone = deriveSurface({ ...lone.app, registry: lone.registry }, '2026-11-04');
    expect(alone.surface.hash).toBe(after.surface.hash);
  });

  test('two head codes that merge into one older code show it once', () => {
    const { app, registry } = shelfApp();
    const merged = {
      ...registry,
      versionChanges: new Map(
        [...registry.versionChanges].map(([id, entry]) => [
          id,
          id === 'shelf.placeRename'
            ? {
                ...entry,
                errors: { 'shelf.full': 'shelf.no_room', 'core.forbidden': 'shelf.no_room' },
              }
            : entry,
        ]),
      ),
    };
    const { surface } = deriveSurface({ ...app, registry: merged }, '2026-11-04');
    expect(surface.errors.filter((error) => error.code === 'shelf.no_room')).toHaveLength(1);
  });

  test('a change nobody adopts is undone at every version, the last one included', () => {
    const { surface } = surfaceAt('2026-11-11', ['shelf.labelRename']);
    const fields = surface.entities.find((entity) => entity.ref === 'shelf.item')?.fields ?? {};
    expect(Object.keys(fields)).toContain('colour');
    expect(Object.keys(fields)).toContain('label');
    expect(Object.keys(fields)).not.toContain('title');
    expect(Object.keys(fields)).not.toContain('size');
  });
});
