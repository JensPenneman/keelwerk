import { readFileSync } from 'node:fs';
import { deriveSurface } from '@keelwerk/core';
import { startTransportRuntime } from '@keelwerk/testing';
import { httpHost } from '@keelwerk/transport-http';
import { afterAll, describe, expect, test } from 'vitest';
import { openapiArtifact } from '../src/openapi/openapi-artifact.ts';
import { shelfWithRest } from './support/shelf-rest-app.ts';
import { versionedWithRest } from './support/versioned-app.ts';

const old = '2026-11-04';
const head = '2026-11-11';
const running = await startTransportRuntime({
  app: versionedWithRest,
  host: httpHost(),
  tenants: ['acme'],
});
afterAll(() => running.stop());

const principal = JSON.stringify({ subject: 'ada', roles: [], claims: {} });

function send(path: string, version: string, body?: unknown): Promise<Response> {
  return running.fetch(
    new Request(`https://${running.domains.acme}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'content-type': 'application/json',
        'keelwerk-version': version,
        'x-test-principal': principal,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}

describe('REST and the invocation protocol at an older API version', () => {
  test('REST at 2026-11-04 posts and returns name; at the head displayName', async () => {
    const created = await send('/api/roster/contacts', old, { name: 'Ada' });
    expect(created.status).toBe(201);
    const row = (await created.json()) as Record<string, unknown>;
    expect(row).toMatchObject({ name: 'Ada' });
    expect(row).not.toHaveProperty('displayName');
    expect(created.headers.get('keelwerk-version')).toBe(old);
    const atHead = await send('/api/roster/contacts', head, { displayName: 'Bea' });
    expect(atHead.status).toBe(201);
    expect(await atHead.json()).toMatchObject({ displayName: 'Bea' });
    const wrong = await send('/api/roster/contacts', old, { displayName: 'Bea' });
    expect(wrong.status).toBe(422);
  });

  test('the invocation protocol at 2026-11-04 sends and receives name', async () => {
    const response = await send('/_keelwerk/v1/invoke', old, {
      action: 'roster.contact.create',
      input: { name: 'Cy' },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { value?: Record<string, unknown> };
    expect(body.value).toMatchObject({ name: 'Cy' });
    expect(body.value).not.toHaveProperty('displayName');
    const query = await send('/_keelwerk/v1/invoke', old, {
      action: 'roster.contact.query',
      input: { filter: { name: 'Cy' } },
    });
    expect(await query.json()).toMatchObject({ value: { items: [{ name: 'Cy' }] } });
  });
});

describe('the surfaces and documents per version', () => {
  test.each([old, head])(
    "OpenAPI per version is the golden file and names the version's field (%s)",
    (date) => {
      const surface = deriveSurface(versionedWithRest, date).surface;
      const artifact = openapiArtifact(surface);
      const content = artifact.kind === 'file' ? artifact.content : '';
      const stored = readFileSync(
        new URL(`./fixtures/versioned-openapi-${date}.json`, import.meta.url),
        'utf8',
      );
      // The .bytes file is the document exactly as written; the formatted .json beside it is compared parsed.
      const bytes = readFileSync(
        new URL(`./fixtures/versioned-openapi-${date}.bytes`, import.meta.url),
        'utf8',
      );
      expect(content).toBe(bytes);
      expect(JSON.parse(content)).toEqual(JSON.parse(stored));
      expect(content).not.toContain('producerVersion');
      const schemas = JSON.parse(content).components.schemas as Record<string, unknown>;
      const contact = JSON.stringify(
        Object.entries(schemas).filter(([name]) => name.toLowerCase().includes('contact')),
      );
      expect(contact).toContain(date === old ? '"name":{' : '"displayName":{');
      expect(contact).not.toContain(date === old ? '"displayName":{' : '"name":{');
    },
  );

  test.each([old, head])(
    'the host serves the derived surface of the session version, with its hash as ETag (%s)',
    async (date) => {
      const response = await send('/_keelwerk/v1/surface', date);
      expect(response.status).toBe(200);
      const derived = deriveSurface(versionedWithRest, date).surface;
      const served = (await response.json()) as typeof derived;
      // The runtime adds the test principal resolvers, which `deriveSurface` alone does not know.
      for (const part of ['apiVersion', 'actions', 'entities', 'errors', 'events'] as const) {
        expect(served[part]).toEqual(JSON.parse(JSON.stringify(derived[part])));
      }
      expect(response.headers.get('etag')).toBe(`"${served.hash}"`);
      const contact = served.entities.find((entity) => entity.ref === 'roster.contact');
      expect(Object.keys(contact?.fields ?? {})).toContain(date === old ? 'name' : 'displayName');
    },
  );

  test("the openapi route serves the session's version", async () => {
    for (const date of [old, head]) {
      const response = await send('/api/openapi.json', date);
      expect(response.status).toBe(200);
      const document = (await response.json()) as {
        'x-keelwerk-generated': { apiVersion: string };
      };
      expect(document['x-keelwerk-generated'].apiVersion).toBe(date);
      expect(JSON.stringify(document)).toContain(date === old ? '"name":{' : '"displayName":{');
    }
  });
});

describe('the issues of a refusal past the translation, over REST', async () => {
  const shelves = await startTransportRuntime({
    app: shelfWithRest,
    host: httpHost(),
    tenants: ['acme'],
  });
  afterAll(() => shelves.stop());

  function call(path: string, version: string, body: unknown): Promise<Response> {
    return shelves.fetch(
      new Request(`https://${shelves.domains.acme}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'keelwerk-version': version,
          'x-test-principal': principal,
        },
        body: JSON.stringify(body),
      }),
    );
  }

  test('at 2026-11-04 the issues name `title` and the parent of the field the version lacks', async () => {
    const created = (await (await call('/api/shelf/items', head, { label: 'a' })).json()) as {
      id: string;
    };
    const claimed = await call(`/api/shelf/items/${created.id}/claim`, old, { title: 'x' });
    expect(claimed.status).toBe(422);
    const body = JSON.stringify(await claimed.json());
    expect(body).toContain('title');
    expect(body).not.toContain('label');
    expect(body).not.toContain('size');
    const atHead = await call(`/api/shelf/items/${created.id}/claim`, head, {
      label: 'x',
      size: 2,
    });
    const headBody = JSON.stringify(await atHead.json());
    expect(headBody).toContain('label');
    expect(headBody).toContain('size');
  });
});

describe('what the transport presents, at the head and at an older version', async () => {
  const shelves = await startTransportRuntime({
    app: shelfWithRest,
    host: httpHost(),
    tenants: ['acme'],
  });
  afterAll(() => shelves.stop());

  function send(path: string, version: string, body?: unknown): Promise<Response> {
    return shelves.fetch(
      new Request(`https://${shelves.domains.acme}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          'content-type': 'application/json',
          'keelwerk-version': version,
          'x-test-principal': principal,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  }

  const itemId = /^itm_[0-9a-z]{26}$/;
  const noteId = /^nte_[0-9a-z]{26}$/;
  const instant = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/;
  const asOf = '2026-11-11T10:00:00.000Z';
  type Row = Record<string, unknown>;
  const labelOf = (version: string): string => (version === old ? 'title' : 'label');

  /** The members the transport itself presents: ids, a reference, dates, the version counter. */
  function expectPresented(row: Row, parent: string): void {
    expect(row.id).toMatch(itemId);
    expect(row.parent).toBe(parent);
    expect(row.shelvedOn).toBe('2026-11-11');
    expect(row.addedAt).toBe(asOf);
    expect(row.createdAt).toMatch(instant);
    expect(row.updatedAt).toMatch(instant);
    expect(typeof row.version).toBe('number');
  }

  async function parentItem(): Promise<string> {
    const made = await send('/api/shelf/items', head, { label: 'parent' });
    return ((await made.json()) as { id: string }).id;
  }

  test.each([old, head])(
    'a row and the reference it holds keep their prefixed ids and their dates over REST (%s)',
    async (version) => {
      const parent = await parentItem();
      const created = await send('/api/shelf/items', version, {
        [labelOf(version)]: 'a',
        parent,
        shelvedOn: '2026-11-11',
        addedAt: asOf,
      });
      expect(created.status).toBe(201);
      const row = (await created.json()) as Row;
      expectPresented(row, parent);
      expect(row[labelOf(version)]).toBe('a');
      expect(created.headers.get('location')).toContain(String(row.id));
      const fetched = (await (await send(`/api/shelf/items/${row.id}`, version)).json()) as Row;
      expectPresented(fetched, parent);
      expect(fetched[labelOf(version)]).toBe('a');
      const page = (await (await send('/api/shelf/items', version)).json()) as { items: Row[] };
      const listed = page.items.find((item) => item.id === row.id);
      expect(listed).toBeDefined();
      expectPresented(listed ?? {}, parent);
    },
  );

  test.each([old, head])(
    "a selection and a filter by the member's own name keep the prefixed ids and the reference (%s)",
    async (version) => {
      const parent = await parentItem();
      const created = await send('/api/shelf/items', version, {
        [labelOf(version)]: `c-${version}`,
        parent,
        shelvedOn: '2026-11-11',
        addedAt: asOf,
      });
      const row = (await created.json()) as Row;
      const selected = await send(
        `/api/shelf/items/${row.id}?fields=${labelOf(version)},parent`,
        version,
      );
      expect(selected.status).toBe(200);
      const narrowed = (await selected.json()) as Row;
      expect(narrowed.id).toMatch(itemId);
      expect(narrowed.id).toBe(row.id);
      expect(narrowed.parent).toBe(parent);
      expect(narrowed[labelOf(version)]).toBe(`c-${version}`);
      expect(typeof narrowed.version).toBe('number');
      for (const left of [
        version === old ? 'label' : 'title',
        'shelvedOn',
        'addedAt',
        'createdAt',
        'updatedAt',
      ]) {
        expect(narrowed).not.toHaveProperty(left);
      }
      const filter = encodeURIComponent(JSON.stringify({ [labelOf(version)]: `c-${version}` }));
      const found = await send(`/api/shelf/items?filter=${filter}`, version);
      expect(found.status).toBe(200);
      const page = (await found.json()) as { items: Row[] };
      expect(page.items.map((item) => item.id)).toEqual([row.id]);
      expectPresented(page.items[0] ?? {}, parent);
    },
  );

  test.each([old, head])(
    'an entity no change touches presents its ids and its reference to one they do (%s)',
    async (version) => {
      const item = await parentItem();
      const created = await send('/api/shelf/notes', version, { text: 'n', item });
      expect(created.status).toBe(201);
      const row = (await created.json()) as Row;
      expect(row.id).toMatch(noteId);
      expect(row.item).toBe(item);
      expect(row.createdAt).toMatch(instant);
      const fetched = (await (await send(`/api/shelf/notes/${row.id}`, version)).json()) as Row;
      expect(fetched).toMatchObject({ id: row.id, item, text: 'n' });
    },
  );

  test.each([old, head])(
    'the invocation protocol answers the same presented members (%s)',
    async (version) => {
      const parent = await parentItem();
      const response = await send('/_keelwerk/v1/invoke', version, {
        action: 'shelf.item.create',
        input: { [labelOf(version)]: 'b', parent, shelvedOn: '2026-11-11', addedAt: asOf },
      });
      expect(response.status).toBe(200);
      const { value } = (await response.json()) as { value: Row };
      expectPresented(value, parent);
      const listed = await send('/_keelwerk/v1/invoke', version, {
        action: 'shelf.item.query',
        input: {},
      });
      const page = ((await listed.json()) as { value: { items: Row[] } }).value;
      expectPresented(page.items.find((item) => item.id === value.id) ?? {}, parent);
    },
  );
});
