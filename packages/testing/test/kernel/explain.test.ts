import type { DryRunReport } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { conformanceApp } from '../../src/fixtures/index.ts';
import { withTestResolver } from '../../src/harness/with-test-resolver.ts';
import { capturing, setup } from './support/explain-kit.ts';
import type { Kind } from './support/runtime-kit.ts';

const kinds: readonly Kind[] = ['memory', 'pglite'];

describe('decisions', () => {
  const kind = 'memory';
  test('a decision names the matched rules with their files, for any principal', async () => {
    const { explain } = await setup(kind);
    const allowed = await explain({
      mode: 'decision',
      ref: 'library.addBook',
      as: 'user:ada',
      input: { title: 'Dune', isbn: 'i-1' },
    });
    expect(allowed).toMatchObject({
      ok: true,
      value: {
        mode: 'decision',
        action: 'library.addBook',
        allowed: true,
        principal: { kind: 'user', id: 'ada' },
        rules: [
          {
            effect: 'allow',
            module: 'library',
            file: 'src/policies/add-book/signed-in.ts',
          },
        ],
      },
    });
    const denied = await explain({ mode: 'decision', ref: 'library.addBook', as: 'anonymous' });
    expect(denied).toMatchObject({ ok: true, value: { allowed: false } });
  });

  test('a decision for an entity action carries the plan and the masks', async () => {
    const { explain } = await setup(kind, {}, { apps: [withTestResolver(conformanceApp)] });
    const answer = await explain({ mode: 'decision', ref: 'loans.loan.query', as: 'user:ada' });
    // `library.findByIsbn` is no entity action, so the plan is shown on the fixture's loans entity.
    expect(answer).toMatchObject({
      ok: true,
      value: {
        allowed: true,
        kind: 'query',
        plan: {
          kind: 'conditional',
          operation: 'read',
          entity: 'loans.loan',
          // The fixture's `auditors` rule selects the same rows for a caller without the auditor role.
          selects: '(borrower = "ada" or borrower = "ada")',
          masks: [{ field: 'note', revealedBy: ['loans.loan.borrowers'], hiddenBy: [] }],
        },
      },
    });
    expect(answer.value).toMatchObject({
      plan: { text: expect.stringContaining('allow loans.loan.borrowers: where borrower = "ada"') },
    });
  });
});

// PGlite boots slowly: one runtime per test, a longer limit.
describe.each(kinds)('explain on %s', { timeout: 60_000 }, (kind) => {
  test('the dry run reports events, effects and the decision record and leaves the database unchanged', async () => {
    const { explain, invoke, asAda, stores } = await setup(kind);
    const input = { title: 'Dune', isbn: 'i-1' };
    const before = await invoke('library.findByIsbn', { isbn: 'i-1' }, asAda);
    expect(before).toMatchObject({ ok: true, value: {} });
    const untouched = await stores();
    const answer = await explain({
      mode: 'dry-run',
      ref: 'library.addBook',
      as: 'user:ada',
      input,
    });
    expect(answer.ok).toBe(true);
    const { authorization, report } = answer.value as unknown as {
      authorization: { allowed: boolean };
      report: Extract<DryRunReport, { status: 'decided' }>;
    };
    expect(authorization.allowed).toBe(true);
    expect(report.status).toBe('decided');
    expect(report.action).toBe('library.addBook');
    expect(report.events).toHaveLength(1);
    expect(report.events[0]).toMatchObject({
      type: 'library.book.created',
      version: 1,
      before: null,
      data: { values: { title: 'Dune', isbn: 'i-1', addedBy: 'ada' } },
    });
    expect(report.effects).toEqual([]);
    expect(report.result).toMatchObject({ bookId: expect.any(String) });
    expect(report.decision?.part).toBe('library.addBook');
    expect(report.decision?.answers).toEqual([
      { kind: 'id', entity: 'library.book', value: (report.result as { bookId: string }).bookId },
    ]);
    // Nothing was written: the event heads, the receipts and the books of every store are as they were.
    const tenantStore = await stores(report.commandId);
    expect(tenantStore).toEqual(untouched);
    expect(Object.keys(untouched).some((key) => key.endsWith('/tenant'))).toBe(true);
    expect(Object.keys(untouched).some((key) => key.endsWith('/deployment'))).toBe(true);
    for (const store of Object.values(tenantStore)) {
      expect((store as { receipt?: unknown }).receipt).toBeUndefined();
    }
    expect(
      Object.values(tenantStore).flatMap((store) => (store as { books?: unknown[] }).books ?? []),
    ).toEqual([]);
    const after = await invoke('library.findByIsbn', { isbn: 'i-1' }, asAda);
    expect(after).toMatchObject({ ok: true, value: {} });
    expect((after as { value: { bookId?: string } }).value.bookId).toBeUndefined();
    const again = await explain({ mode: 'dry-run', ref: 'library.addBook', as: 'user:ada', input });
    expect(again.ok).toBe(true);
  });

  test('a dry run of an instance command reports the before-image of the row it changes', async () => {
    const { explain, invoke, asAda, stores } = await setup(
      kind,
      {},
      { apps: [withTestResolver(conformanceApp)] },
    );
    const created = await invoke('library.addBook', { title: 'Dune', isbn: 'i-1' }, asAda);
    if (!created.ok) throw new Error('the book was not added');
    const { bookId } = created.value as { bookId: string };
    expect(await invoke('library.book.reserve', { id: bookId }, asAda)).toMatchObject({ ok: true });
    const untouched = await stores();
    const answer = await explain({
      mode: 'dry-run',
      ref: 'library.book.reserve',
      as: 'user:bob',
      input: { id: bookId },
    });
    const { report } = answer.value as unknown as {
      report: Extract<DryRunReport, { status: 'decided' }>;
    };
    expect(report.events).toHaveLength(1);
    expect(report.events[0]).toMatchObject({
      type: 'library.book.changed',
      version: 3,
      data: { set: { reservedBy: 'bob' } },
      before: { reservedBy: 'ada' },
    });
    expect(await stores()).toEqual(untouched);
  });

  test('the dry run sees the decision refuse what the real run would refuse', async () => {
    const { explain, invoke, asAda } = await setup(kind);
    const input = { title: 'Dune', isbn: 'i-1' };
    expect(await invoke('library.addBook', input, asAda, 'c1')).toMatchObject({ ok: true });
    const answer = await explain({
      mode: 'dry-run',
      ref: 'library.addBook',
      as: 'user:ada',
      input,
    });
    expect(answer).toMatchObject({ ok: false, error: { code: 'library.isbn_taken' } });
  });

  test('a dry run as nobody is unauthenticated, as the real call is', async () => {
    const { explain } = await setup(kind);
    const answer = await explain({
      mode: 'dry-run',
      ref: 'library.addBook',
      as: 'anonymous',
      input: { title: 'Dune', isbn: 'i-1' },
    });
    expect(answer).toMatchObject({ ok: false, error: { kind: 'unauthenticated' } });
  });

  test('a dry run as a user the rules do not admit is forbidden', async () => {
    const { explain } = await setup(kind);
    const answer = await explain({
      mode: 'dry-run',
      ref: 'library.addBook',
      as: 'service:billing',
      input: { title: 'Dune', isbn: 'i-1' },
    });
    expect(answer).toMatchObject({ ok: false, error: { kind: 'forbidden' } });
  });

  test('a trace prints the command, its events and its decision, by command, event or stream id', async () => {
    const { explain, invoke, asAda } = await setup(kind);
    expect(
      await invoke('library.addBook', { title: 'Dune', isbn: 'i-1' }, asAda, 'cmd-1'),
    ).toMatchObject({ ok: true });
    const byCommand = await explain({ mode: 'trace', id: 'cmd-1' });
    expect(byCommand).toMatchObject({
      ok: true,
      value: {
        mode: 'trace',
        requested: { kind: 'command', id: 'cmd-1' },
        command: {
          commandId: 'cmd-1',
          action: 'library.addBook',
          actor: { kind: 'user', id: 'ada' },
          decision: { part: 'library.addBook', effects: [] },
          effects: [],
          nested: [],
        },
      },
    });
    const [event] = byCommand.value.command.events;
    expect(event).toMatchObject({ type: 'library.book.created', version: 1 });
    const byEvent = await explain({ mode: 'trace', id: event?.eventId });
    expect(byEvent.value.requested.kind).toBe('event');
    expect(byEvent.value.command.commandId).toBe('cmd-1');
    expect(await explain({ mode: 'trace', id: 'nobody' })).toMatchObject({
      ok: false,
      error: { kind: 'not_found' },
    });
  });

  test('only an operator may explain', async () => {
    const { invoke, asAda } = await setup(kind);
    const answer = await invoke('core.explain', { mode: 'trace', id: 'x' }, asAda);
    expect(answer).toMatchObject({ ok: false, error: { kind: 'forbidden' } });
  });
});

describe('the request', () => {
  test('a malformed request is a validation error', async () => {
    const { explain } = await setup('memory');
    expect(await explain({ mode: 'nope' })).toMatchObject({
      ok: false,
      error: { kind: 'validation' },
    });
    expect(await explain({ mode: 'decision' })).toMatchObject({
      ok: false,
      error: { kind: 'validation' },
    });
    expect(await explain({ mode: 'decision', ref: 'library.addBook', as: 'user' })).toMatchObject({
      ok: false,
      error: { kind: 'validation' },
    });
    expect(
      await explain({ mode: 'dry-run', ref: 'library.findByIsbn', input: { isbn: 'x' } }),
    ).toMatchObject({ ok: false, error: { kind: 'validation' } });
  });
});

describe('--as outside development (decision 17)', () => {
  test('a decision evaluates in production, a dry run as another principal is refused', async () => {
    const { explain } = await setup('memory', { environment: 'production' });
    const input = { title: 'Dune', isbn: 'i-1' };
    expect(
      await explain({ mode: 'decision', ref: 'library.addBook', as: 'user:ada', input }),
    ).toMatchObject({ ok: true, value: { allowed: true } });
    expect(
      await explain({ mode: 'dry-run', ref: 'library.addBook', as: 'user:ada', input }),
    ).toMatchObject({ ok: false, error: { kind: 'forbidden' } });
  });

  test('development runs it', async () => {
    const { explain } = await setup('memory', { environment: 'development' });
    const input = { title: 'Dune', isbn: 'i-1' };
    expect(
      await explain({ mode: 'dry-run', ref: 'library.addBook', as: 'user:ada', input }),
    ).toMatchObject({ ok: true, value: { report: { status: 'decided' } } });
  });
});

describe('KEELWERK_EXPLAIN=1', () => {
  test('writes one line per invocation through the explain stream', async () => {
    const lines: string[] = [];
    const { invoke, asAda } = await setup('memory', {
      // biome-ignore lint/style/useNamingConvention: the environment variable's own name
      env: { KEELWERK_EXPLAIN: '1' },
      logger: capturing(lines),
    });
    await invoke('library.addBook', { title: 'Dune', isbn: 'i-1' }, asAda);
    await invoke('library.addBook', { title: 'Dune', isbn: 'i-1' }, asAda);
    const written = lines.filter((line) => line.includes(' -> '));
    expect(written).toHaveLength(2);
    expect(written[0]).toMatch(
      /^test -> library\.addBook ok \d+ ms rules=library\.addBook\.signedIn$/,
    );
    expect(written[1]).toMatch(
      /^test -> library\.addBook library\.isbn_taken \d+ ms rules=library\.addBook\.signedIn stage=execute$/,
    );
  });

  test('is off in production, whatever the variable says', async () => {
    const lines: string[] = [];
    const { invoke, asAda } = await setup('memory', {
      // biome-ignore lint/style/useNamingConvention: the environment variable's own name
      env: { KEELWERK_EXPLAIN: '1' },
      environment: 'production',
      logger: capturing(lines),
    });
    await invoke('library.addBook', { title: 'Dune', isbn: 'i-1' }, asAda);
    expect(lines.filter((line) => line.includes(' -> '))).toEqual([]);
  });

  test('is silent without the variable', async () => {
    const lines: string[] = [];
    const { invoke, asAda } = await setup('memory', { logger: capturing(lines) });
    await invoke('library.addBook', { title: 'Dune', isbn: 'i-1' }, asAda);
    expect(lines.filter((line) => line.includes(' -> '))).toEqual([]);
  });
});
