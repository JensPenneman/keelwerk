import { describe, expect, test } from 'vitest';
import { changeIds, shelfApi, shelfApp } from '../../test/version-change-kit.ts';
import { applyVersionChanges } from './apply-version-changes.ts';

const { app, registry } = shelfApp();

describe('applyVersionChanges (section 18.2)', () => {
  test('a version lacks the changes no version up to it adopts, oldest first', () => {
    const api = shelfApi(['shelf.sizeAdded', 'shelf.labelRename']);
    const older = applyVersionChanges({ registry, api, apiVersion: '2026-11-04' });
    expect(older.lacking.map((change) => change.id)).toEqual([
      'shelf.labelRename',
      'shelf.sizeAdded',
      'shelf.colourRemoved',
      'shelf.placeRename',
    ]);
    const head = applyVersionChanges({ registry, api, apiVersion: '2026-11-11' });
    expect(head.lacking.map((change) => change.id)).toEqual([
      'shelf.colourRemoved',
      'shelf.placeRename',
    ]);
  });

  test('changes adopted by one date keep module order, then since, then id', () => {
    const api = shelfApi();
    const older = applyVersionChanges({ registry, api, apiVersion: '2026-11-04' });
    expect(older.lacking.map((change) => change.id)).toEqual([
      'shelf.colourRemoved',
      'shelf.labelRename',
      'shelf.placeRename',
      'shelf.sizeAdded',
    ]);
  });

  test('the head of an app without versions lacks every change', () => {
    const translation = applyVersionChanges({ registry, api: app.api, apiVersion: '2026-11-04' });
    expect(translation.lacking).toHaveLength(changeIds.length);
    const none = applyVersionChanges({ registry, api: null, apiVersion: null });
    expect(none.lacking).toEqual([]);
    expect(none.touched.size).toBe(0);
  });

  test('a version that adopts every change is the identity', () => {
    const translation = applyVersionChanges({
      registry,
      api: shelfApi(),
      apiVersion: '2026-11-11',
    });
    expect(translation.lacking).toEqual([]);
    expect(translation.touched.size).toBe(0);
    expect(translation.headRefs.size).toBe(0);
    expect(translation.errorCodes.size).toBe(0);
  });

  test('an action rename maps the older ref to the head and hides the head ref', () => {
    const translation = applyVersionChanges({
      registry,
      api: shelfApi(),
      apiVersion: '2026-11-04',
    });
    expect(translation.headRefs.get('shelf.put')).toBe('shelf.place');
    expect(translation.versionRefs.get('shelf.place')).toBe('shelf.put');
    expect(translation.touched.has('shelf.place')).toBe(true);
  });

  test('chained renames compose from the head to the oldest', () => {
    const only = applyVersionChanges({
      registry,
      api: null,
      apiVersion: null,
      only: ['shelf.placeRename'],
    });
    expect(only.versionRefs.get('shelf.place')).toBe('shelf.put');
  });

  test('error maps compose newest first', () => {
    const translation = applyVersionChanges({
      registry,
      api: shelfApi(),
      apiVersion: '2026-11-04',
    });
    expect([...translation.errorCodes]).toEqual([['shelf.full', 'shelf.no_room']]);
  });

  test('touched lists exactly the actions of the field changes, renames and error maps', () => {
    const translation = applyVersionChanges({
      registry,
      api: shelfApi(),
      apiVersion: '2026-11-04',
    });
    expect([...translation.touched].sort()).toEqual([
      'shelf.item.archive',
      'shelf.item.create',
      'shelf.item.get',
      'shelf.item.query',
      'shelf.item.queryChanges',
      'shelf.item.restore',
      'shelf.item.set',
      'shelf.item.update',
      'shelf.place',
      'shelf.rack.query',
      'shelf.rack.queryChanges',
    ]);
    expect(translation.touched.has('shelf.rack.create')).toBe(false);
    expect(translation.touched.has('shelf.item.changes')).toBe(false);
  });

  test('an id the registry lacks is skipped', () => {
    const translation = applyVersionChanges({
      registry,
      api: null,
      apiVersion: null,
      only: ['shelf.nothing', 'shelf.labelRename'],
    });
    expect(translation.lacking.map((change) => change.id)).toEqual(['shelf.labelRename']);
  });
});
