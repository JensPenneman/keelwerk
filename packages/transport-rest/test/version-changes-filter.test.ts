import { parseTypeId, renderTypeId } from '@keelwerk/core';
import { startTransportRuntime } from '@keelwerk/testing';
import { httpHost } from '@keelwerk/transport-http';
import { afterAll, describe, expect, test } from 'vitest';
import { shelfWithRest } from './support/shelf-rest-app.ts';

const old = '2026-11-04';
const head = '2026-11-11';
const principal = JSON.stringify({ subject: 'ada', roles: [], claims: {} });

describe('filters by public ids, at the head and at an older version', async () => {
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

  type Row = Record<string, unknown>;
  const labelOf = (version: string): string => (version === old ? 'title' : 'label');

  async function parentItem(): Promise<string> {
    const made = await send('/api/shelf/items', head, { label: 'parent' });
    return ((await made.json()) as { id: string }).id;
  }

  const containerOf = (version: string): string => (version === old ? 'box' : 'container');

  /** A row of its own: the parent and a child that names it as parent and as container. */
  async function filterFixture(version: string): Promise<{ parent: string; row: Row }> {
    const parent = await parentItem();
    const created = await send('/api/shelf/items', version, {
      [labelOf(version)]: `f-${crypto.randomUUID()}`,
      parent,
      [containerOf(version)]: parent,
    });
    expect(created.status).toBe(201);
    return { parent, row: (await created.json()) as Row };
  }

  async function found(version: string, filter: unknown): Promise<Response> {
    return send(`/api/shelf/items?filter=${encodeURIComponent(JSON.stringify(filter))}`, version);
  }

  async function idsOf(response: Response): Promise<unknown[]> {
    expect(response.status).toBe(200);
    return ((await response.json()) as { items: Row[] }).items.map((item) => item.id);
  }

  async function invoked(version: string, action: string, input: unknown): Promise<Response> {
    return send('/_keelwerk/v1/invoke', version, { action, input });
  }

  /** The body of a refusal without what differs from request to request. */
  async function problemOf(response: Response): Promise<Record<string, unknown>> {
    const { instance: _instance, requestId: _requestId, ...rest } = (await response.json()) as Row;
    return rest;
  }

  async function createdNote(): Promise<string> {
    const made = await send('/api/shelf/notes', head, { text: 'n', item: await parentItem() });
    return ((await made.json()) as { id: string }).id;
  }

  test.each([old, head])(
    "a filter on a reference by its public id finds the row over REST, under the version's name of a renamed reference (%s)",
    async (version) => {
      const { parent, row } = await filterFixture(version);
      expect(await idsOf(await found(version, { parent }))).toEqual([row.id]);
      expect(await idsOf(await found(version, { [containerOf(version)]: parent }))).toEqual([
        row.id,
      ]);
      if (version === old) expect((await found(version, { container: parent })).status).toBe(422);
    },
  );

  test.each([old, head])(
    'membership, the negations and the id itself filter by public ids over REST (%s)',
    async (version) => {
      const { parent, row } = await filterFixture(version);
      const unique = { [labelOf(version)]: row[labelOf(version)] };
      expect(await idsOf(await found(version, { parent: { in: [parent] } }))).toEqual([row.id]);
      expect(
        await idsOf(await found(version, { and: [unique, { parent: { ne: parent } }] })),
      ).toEqual([]);
      expect(
        await idsOf(await found(version, { and: [unique, { parent: { nin: [parent] } }] })),
      ).toEqual([]);
      expect(await idsOf(await found(version, { and: [unique, { not: { id: row.id } }] }))).toEqual(
        [],
      );
      expect(await idsOf(await found(version, { id: row.id }))).toEqual([row.id]);
    },
  );

  test.each([old, head])(
    "the invocation protocol's query filters by public ids (%s)",
    async (version) => {
      const { parent, row } = await filterFixture(version);
      const response = await invoked(version, 'shelf.item.query', {
        filter: { [containerOf(version)]: { in: [parent] } },
      });
      expect(response.status).toBe(200);
      const { value } = (await response.json()) as { value: { items: Row[] } };
      expect(value.items.map((item) => item.id)).toEqual([row.id]);
    },
  );

  test('a relation quantifier filters by the public id of the related row', async () => {
    const { row } = await filterFixture(head);
    const made = await send('/api/shelf/notes', head, { text: 'q', item: row.id });
    const note = ((await made.json()) as { id: string }).id;
    expect(await idsOf(await found(head, { notes: { some: { id: note } } }))).toEqual([row.id]);
  });

  test('a null inside a membership list is refused with the entry as the issue path', async () => {
    const { parent } = await filterFixture(head);
    const response = await found(head, { parent: { in: [parent, null] } });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { code: string; issues: { path: unknown[] }[] };
    expect(body.code).toBe('core.malformed_request');
    expect(body.issues[0]?.path).toEqual(['parent', 'in', '1']);
  });

  test('a bare null in a filter finds the rows whose field is not set', async () => {
    const orphan = await send('/api/shelf/items', head, { label: `o-${crypto.randomUUID()}` });
    const { id } = (await orphan.json()) as { id: string };
    const { row } = await filterFixture(head);
    const ids = await idsOf(await found(head, { parent: null }));
    expect(ids).toContain(id);
    expect(ids).not.toContain(row.id);
  });

  test.each([old, head])(
    "another entity's public id in a filter is refused as in a plain input, whether that row exists or not (%s)",
    async (version) => {
      const existing = await createdNote();
      const absent = renderTypeId('nte', crypto.randomUUID());
      const plain = await send('/api/shelf/items', version, {
        [labelOf(version)]: 'p',
        parent: existing,
      });
      expect(plain.status).toBe(422);
      const plainBody = (await plain.json()) as { issues?: { message: string }[] };
      const bodies: Record<string, unknown>[] = [];
      for (const id of [existing, absent]) {
        const response = await found(version, { parent: id });
        expect(response.status).toBe(422);
        const body = await problemOf(response);
        expect(JSON.stringify(body)).toContain('core.validation');
        expect((body.issues as { message: string }[])[0]?.message).toBe(
          plainBody.issues?.[0]?.message,
        );
        bodies.push(body);
      }
      expect(bodies[0]).toEqual(bodies[1]);
    },
  );

  test('a bare uuid in a filter is refused over REST and the invocation protocol as in a plain input', async () => {
    const { parent } = await filterFixture(head);
    const uuid = parseTypeId(parent, 'itm') ?? '';
    expect(uuid).not.toBe('');
    const plain = await send('/api/shelf/items', head, { label: 'p', parent: uuid });
    expect(plain.status).toBe(422);
    const message = ((await plain.json()) as { issues: { message: string }[] }).issues[0]?.message;
    const rest = await found(head, { parent: uuid });
    expect(rest.status).toBe(422);
    expect(((await rest.json()) as { issues: { message: string }[] }).issues[0]?.message).toBe(
      message,
    );
    const invoked422 = await invoked(head, 'shelf.item.query', { filter: { parent: uuid } });
    expect(invoked422.status).toBe(422);
  });

  test("the filter of queryChanges is decoded on the invocation protocol: another entity's id is refused before the invoker", async () => {
    const response = await invoked(head, 'shelf.item.queryChanges', {
      filter: { parent: await createdNote() },
      sinceQueryState: 'x',
    });
    expect(response.status).toBe(422);
    const { error } = (await response.json()) as {
      error: { code: string; issues: { path: unknown[] }[] };
    };
    expect(error.code).toBe('core.validation');
    expect(error.issues[0]?.path).toEqual(['filter', 'parent']);
  });

  test.each([
    '{"__proto__":"x"}',
    '{"or":[{"__proto__":1}]}',
    '{"label":"a","__proto__":1}',
    '{"parent":"$parent","__proto__":1}',
    '{"and":[{"parent":{"in":["$parent"]}},{"__proto__":"x"}]}',
  ])(
    'a filter key __proto__ is an unknown field, not an empty filter that finds every row: %s',
    async (json) => {
      const { parent } = await filterFixture(head);
      const filter = encodeURIComponent(json.replace('$parent', parent));
      const response = await send(`/api/shelf/items?filter=${filter}`, head);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        code: 'core.malformed_request',
        detail: 'shelf.item has no field __proto__',
      });
    },
  );

  test('a filter nested 10 000 levels deep is refused before it is walked, over the invocation protocol', async () => {
    let filter: unknown = { label: 'x' };
    for (let level = 0; level < 10_000; level += 1) filter = { not: filter };
    for (const action of ['shelf.item.query', 'shelf.item.queryChanges']) {
      const response = await invoked(head, action, { filter, sinceQueryState: 'x' });
      expect(response.status).toBe(400);
      const { error } = (await response.json()) as { error: { code: string } };
      expect(error.code).toBe('core.malformed_request');
    }
  });

  test.each([
    ['a field', (inner: unknown) => ({ x: inner })],
    ['a relation', (inner: unknown) => ({ notes: { x: inner } })],
    ['an and', (inner: unknown) => ({ and: [{ x: inner }] })],
  ])(
    'a filter of plain objects under a key the walk does not rewrite, 10 000 levels deep under %s, is refused as malformed, over the invocation protocol',
    async (_where, wrap) => {
      let inner: unknown = { some: { text: 'a' } };
      for (let level = 0; level < 10_000; level += 1) inner = { x: inner };
      const response = await invoked(head, 'shelf.item.query', { filter: wrap(inner) });
      expect(response.status).toBe(400);
      const { error } = (await response.json()) as { error: { code: string } };
      expect(error.code).toBe('core.malformed_request');
    },
  );
});
