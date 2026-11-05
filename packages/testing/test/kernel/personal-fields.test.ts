import { describe, expect, test } from 'vitest';
import { bootPeople, type PersonPage } from './support/personal-kit.ts';

/** Everything a value holds as text, bytes as hex and big integers as decimals. */
const dump = (value: unknown): string =>
  JSON.stringify(value, (_key, member: unknown) =>
    member instanceof Uint8Array
      ? Buffer.from(member).toString('hex')
      : typeof member === 'bigint'
        ? member.toString()
        : member,
  );

const lengthOf = (value: unknown): number => (value instanceof Uint8Array ? value.length : -1);

const namesOf = (page: PersonPage): string[] => page.items.map((row) => row.name).sort();

async function names(
  people: Awaited<ReturnType<typeof bootPeople>>,
  filter: unknown,
): Promise<string[]> {
  const outcome = await people.find(filter);
  if (!outcome.ok) throw outcome.error;
  return namesOf(outcome.value);
}

describe.each(['memory', 'pglite'] as const)('personal fields on %s (14.7.9)', (kind) => {
  test('values are sealed in state and events and read back as written', {
    timeout: 90_000,
  }, async () => {
    const people = await bootPeople(kind);
    const created = await people.create({
      name: 'Jens',
      email: 'Jens@JensPenneman.com',
      nickname: 'JP',
      notes: 'a private note about Jens',
    });
    // The caller reads the value as written.
    expect(created).toMatchObject({ email: 'Jens@JensPenneman.com', nickname: 'JP' });
    const got = await people.call<{ list: { email: string; notes: string }[] }>(
      'people.person.get',
      { ids: [created.id] },
    );
    expect(got).toMatchObject({
      ok: true,
      value: { list: [{ email: 'Jens@JensPenneman.com', notes: 'a private note about Jens' }] },
    });

    const stored = await people.raw(async (view) => ({
      rows: await view.rows(),
      events: await view.events(created.id),
    }));
    const [row] = stored.rows;
    // The columns hold sealed bytes and 16-byte tags, nothing else.
    expect(row?.email).toBeInstanceOf(Uint8Array);
    expect(row?.nickname).toBeInstanceOf(Uint8Array);
    expect(row?.notes).toBeInstanceOf(Uint8Array);
    expect(lengthOf(row?.email__eq)).toBe(16);
    expect(lengthOf(row?.nickname__eq)).toBe(16);
    expect(row).not.toHaveProperty('notes__eq');
    // The chain holds the $kwe envelope, with a key id the subject's key store knows.
    const created0 = stored.events[0]?.data as { values: Record<string, unknown> };
    const { values } = created0;
    expect(values.name).toBe('Jens');
    for (const name of ['email', 'nickname', 'notes']) {
      expect(values[name]).toMatchObject({ $kwe: 1, k: expect.any(String), n: expect.any(String) });
    }
    const text = dump(stored).toLowerCase();
    for (const marker of ['jenspenneman', 'jens@', 'a private note', '"jp"']) {
      expect(text).not.toContain(marker);
    }
    // The subject's data key opens what was sealed; a second write of the same subject reuses it.
    const key = await people.raw((view) => view.keys.dataKey(created.id, { create: false }));
    expect(key?.id).toBe((values.email as { k: string }).k);
  });

  test('conditions on personal fields run on tags and the normalisers apply', {
    timeout: 90_000,
  }, async () => {
    const people = await bootPeople(kind);
    await people.create({ name: 'Jens', email: 'Jens@JensPenneman.com', nickname: 'JP' });
    await people.create({ name: 'Ada', email: 'ada@example.org', nickname: 'Countess' });
    await people.create({ name: 'Bob', email: 'bob@example.org' });
    const email = (operators: Record<string, unknown>) => ({ email: operators });
    expect(await names(people, email({ eq: 'jens@jenspenneman.com' }))).toEqual(['Jens']);
    expect(await names(people, email({ eq: 'JENS@JENSPENNEMAN.COM' }))).toEqual(['Jens']);
    expect(await names(people, email({ in: ['ada@example.org', 'bob@EXAMPLE.org'] }))).toEqual([
      'Ada',
      'Bob',
    ]);
    expect(await names(people, email({ ne: 'ada@example.org' }))).toEqual(['Bob', 'Jens']);
    expect(await names(people, email({ nin: ['ada@example.org', 'bob@example.org'] }))).toEqual([
      'Jens',
    ]);
    expect(await names(people, { nickname: { eq: 'jp' } })).toEqual(['Jens']);
    expect(await names(people, { nickname: { eq: 'COUNTESS' } })).toEqual(['Ada']);
    // The ne of an optional field is null-safe: rows without a nickname match.
    expect(await names(people, { nickname: { ne: 'jp' } })).toEqual(['Ada', 'Bob']);
    expect(await names(people, { nickname: { isNull: true } })).toEqual(['Bob']);
    expect(await names(people, { nickname: { isNull: false } })).toEqual(['Ada', 'Jens']);
    expect(
      await names(people, {
        or: [{ email: { eq: 'ada@example.org' } }, { name: 'Bob' }],
      }),
    ).toEqual(['Ada', 'Bob']);
    expect(
      await names(people, { not: { email: { eq: 'ada@example.org' } }, name: { ne: 'Bob' } }),
    ).toEqual(['Jens']);
    // Each result is the row as written, unsealed, without tags.
    const found = await people.find(email({ eq: 'jens@jenspenneman.com' }));
    expect(found.ok && found.value.items[0]).toMatchObject({ email: 'Jens@JensPenneman.com' });
    expect(found.ok && found.value.items[0]).not.toHaveProperty('email__eq');
  });

  test('a prefix takes the bounded scan, the original condition decides', {
    timeout: 90_000,
  }, async () => {
    const people = await bootPeople(kind);
    await people.create({ name: 'Jens', email: 'Jens@JensPenneman.com' });
    await people.create({ name: 'Jenny', email: 'jenny@example.org' });
    await people.create({ name: 'Ada', email: 'ada@example.org' });
    expect(await names(people, { email: { startsWith: 'JEN' } })).toEqual(['Jenny', 'Jens']);
    expect(await names(people, { email: { startsWith: 'jenn' } })).toEqual(['Jenny']);
    expect(await names(people, { email: { startsWith: 'zzz' } })).toEqual([]);
    expect(
      await names(people, { and: [{ email: { startsWith: 'jen' } }, { name: 'Jens' }] }),
    ).toEqual(['Jens']);
    const paged = await people.find({ email: { startsWith: 'jen' } }, { first: 1, total: true });
    expect(paged.ok && paged.value.items).toHaveLength(1);
    expect(paged.ok && paged.value.pageInfo.hasNextPage).toBe(true);
    expect(paged.ok && paged.value.total).toBe(2);
    const next = await people.find(
      { email: { startsWith: 'jen' } },
      { first: 1, after: paged.ok ? paged.value.pageInfo.endCursor : null },
    );
    expect(next.ok && next.value.items).toHaveLength(1);
    expect(next.ok && next.value.pageInfo.hasNextPage).toBe(false);
  });

  test('what a field does not declare is refused, nothing falls back silently', {
    timeout: 90_000,
  }, async () => {
    const people = await bootPeople(kind);
    await people.create({ name: 'Jens', email: 'jens@example.org', notes: 'n' });
    for (const filter of [
      { notes: { eq: 'n' } },
      { email: { contains: 'jens' } },
      { email: { lt: 'k' } },
      { nickname: { startsWith: 'abc' } },
      { not: { email: { startsWith: 'jen' } } },
    ]) {
      expect(await people.find(filter), JSON.stringify(filter)).toMatchObject({
        ok: false,
        error: { kind: 'unsupported', code: 'core.personal_operator' },
      });
    }
    expect(await people.find({ email: { startsWith: 'je' } })).toMatchObject({
      ok: false,
      error: { code: 'core.personal_needle_short' },
    });
    expect(await people.find({}, { sort: ['email'] })).toMatchObject({ ok: false });
  });

  test('uniqueness holds under the normaliser', { timeout: 90_000 }, async () => {
    const people = await bootPeople(kind);
    await people.create({ name: 'Jens', email: 'Jens@JensPenneman.com' });
    const again = await people.call('people.person.create', {
      name: 'Other',
      email: 'jens@jenspenneman.com',
    });
    expect(again).toMatchObject({ ok: false, error: { kind: 'conflict' } });
    expect(await names(people, {})).toEqual(['Jens']);
  });

  test('an update seals again, the before-image is sealed, and a shredded key reads as absent', {
    timeout: 90_000,
  }, async () => {
    const people = await bootPeople(kind);
    const created = await people.create({ name: 'Jens', email: 'jens@example.org', notes: 'old' });
    const updated = await people.call<{ email: string; notes: string; version: number }>(
      'people.person.update',
      { id: created.id, ifVersion: 1, patch: { email: 'JENS@new.example.org', notes: 'new' } },
    );
    expect(updated).toMatchObject({
      ok: true,
      value: { email: 'JENS@new.example.org', notes: 'new', version: 2 },
    });
    expect(await names(people, { email: { eq: 'jens@new.example.org' } })).toEqual(['Jens']);
    expect(await names(people, { email: { eq: 'jens@example.org' } })).toEqual([]);
    const events = await people.raw((view) => view.events(created.id));
    const changed = events[1];
    const changedData = changed?.data as { set: Record<string, { $kwe: number }> };
    const { set } = changedData;
    expect([set.email?.$kwe, set.notes?.$kwe]).toEqual([1, 1]);
    const before = changed?.before as Record<string, { $kwe: number }>;
    expect([before.email?.$kwe, before.notes?.$kwe]).toEqual([1, 1]);
    expect(dump(events).toLowerCase()).not.toMatch(/example\.org|"old"|"new"/);

    // Erasing the subject's keys: the values read as absent, and no condition discloses the row.
    await people.raw((view) => view.keys.shred(created.id));
    const got = await people.call<{ list: Record<string, unknown>[] }>('people.person.get', {
      ids: [created.id],
    });
    expect(got.ok && got.value.list[0]).toMatchObject({ name: 'Jens' });
    expect(got.ok && got.value.list[0]).not.toHaveProperty('email');
    expect(await names(people, { email: { eq: 'jens@new.example.org' } })).toEqual([]);
  });

  test('changes and queryChanges name ids and never carry a personal value or a tag', {
    timeout: 90_000,
  }, async () => {
    const people = await bootPeople(kind);
    const a = await people.create({ name: 'Ada', email: 'ada@example.org' });
    const got = await people.call<{ state: string }>('people.person.get', { ids: [a.id] });
    const state = got.ok ? got.value.state : '';
    const filter = { email: { eq: 'ada@example.org' } };
    const page = await people.find(filter);
    const queryState = page.ok ? page.value.queryState : '';
    expect(page.ok && page.value.items.map((row) => row.name)).toEqual(['Ada']);
    const b = await people.create({ name: 'Bea', email: 'bea@example.org' });
    await people.call('people.person.update', {
      id: a.id,
      patch: { email: 'ada@elsewhere.example' },
    });

    const changes = await people.call<{ created: string[]; changed: string[] }>(
      'people.person.changes',
      { since: state },
    );
    expect(changes).toMatchObject({ ok: true, value: { created: [b.id], changed: [a.id] } });
    const moved = await people.call<{ added: { id: string }[]; removed: string[] }>(
      'people.person.queryChanges',
      { sinceQueryState: queryState, filter },
    );
    // Ada left the filter: removed, found by the unsealed value at the old position.
    expect(moved).toMatchObject({ ok: true, value: { added: [], removed: [a.id] } });
    for (const outcome of [changes, moved]) {
      expect(JSON.stringify(outcome)).not.toMatch(/example\.org|elsewhere|[0-9a-f]{32}/i);
    }
  });

  test('a scan past the adapter limit fails with core.scan_limit', {
    timeout: 90_000,
  }, async () => {
    const people = await bootPeople(kind, 3);
    for (const n of [1, 2, 3, 4]) {
      await people.create({ name: `P${n}`, email: `person${n}@example.org` });
    }
    expect(await people.find({ email: { startsWith: 'per' } })).toMatchObject({
      ok: false,
      error: { kind: 'unsupported', code: 'core.scan_limit' },
    });
    // The rest of the condition narrows the scan below the limit.
    expect(
      await names(people, {
        and: [{ email: { startsWith: 'per' } }, { name: { in: ['P1', 'P2'] } }],
      }),
    ).toEqual(['P1', 'P2']);
  });
});
