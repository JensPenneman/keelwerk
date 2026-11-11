import { describe, expect, test } from 'vitest';
import { testPrincipal } from '../../src/harness/test-principal.ts';
import {
  bootShelf,
  colourFrom,
  colourFromMemoUnlessMasked,
  idOf,
  shelfAppOf,
  shelfChanges,
} from './support/shelf-kit.ts';

const old = '2026-11-04';
const head = '2026-11-11';
const ada = testPrincipal('ada');
const admin = testPrincipal('bea', { claims: { admin: true } });

describe('a removed field that a transform builds from other members', () => {
  const created = { label: 'a', note: 'secret' };

  test('a selection naming it is served from the whole row and answers what was selected', async () => {
    const { runtime, call } = await bootShelf(
      shelfAppOf(shelfChanges({ colourRemoved: colourFrom('title') })),
    );
    try {
      const id = idOf(await call(head, admin, 'shelf.item.create', created));
      const asAda = await call(old, ada, 'shelf.item.get', { ids: [id], properties: ['colour'] });
      expect(asAda).toMatchObject({
        value: { list: [{ id, colour: 'a-grey', $masked: ['memo'] }] },
      });
      const row = asAda.ok ? (asAda.value.list as Record<string, unknown>[])[0] : undefined;
      expect(Object.keys(row ?? {}).sort()).toEqual(['$masked', 'colour', 'id', 'version']);
      expect(JSON.stringify(asAda)).not.toContain('secret');
    } finally {
      await runtime.stop();
    }
  });

  test('built from a member the caller may not read it answers what the transform gave, a fallback, and nothing secret', async () => {
    const { runtime, call } = await bootShelf(
      shelfAppOf(shelfChanges({ colourRemoved: colourFrom('memo') })),
    );
    try {
      const id = idOf(await call(head, admin, 'shelf.item.create', created));
      const asAda = await call(old, ada, 'shelf.item.get', { ids: [id] });
      expect(asAda).toMatchObject({
        value: { list: [{ title: 'a', colour: 'undefined-grey', $masked: ['memo'] }] },
      });
      expect(JSON.stringify(asAda)).not.toContain('secret');
      const asAdmin = await call(old, admin, 'shelf.item.get', { ids: [id] });
      expect(asAdmin).toMatchObject({ value: { list: [{ colour: 'secret-grey' }] } });
    } finally {
      await runtime.stop();
    }
  });

  test('a transform that reads $masked can leave the member undefined, and it is hidden from them', async () => {
    const { runtime, call } = await bootShelf(
      shelfAppOf(shelfChanges({ colourRemoved: colourFromMemoUnlessMasked() })),
    );
    try {
      const id = idOf(await call(head, admin, 'shelf.item.create', created));
      const asAda = await call(old, ada, 'shelf.item.get', { ids: [id] });
      expect(asAda).toMatchObject({
        value: { list: [{ title: 'a', $masked: ['colour', 'memo'] }] },
      });
      const row = asAda.ok ? (asAda.value.list as Record<string, unknown>[])[0] : undefined;
      expect(row).not.toHaveProperty('colour');
      expect(JSON.stringify(asAda)).not.toContain('secret');
      const asAdmin = await call(old, admin, 'shelf.item.get', { ids: [id] });
      expect(asAdmin).toMatchObject({ value: { list: [{ colour: 'secret-grey' }] } });
    } finally {
      await runtime.stop();
    }
  });
});
