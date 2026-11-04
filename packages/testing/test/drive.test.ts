import { isKeelwerkError } from '@keelwerk/core';
import { driveDecision } from '@keelwerk/core/replay';
import { describe, expect, test } from 'vitest';
import { created } from '../src/drive/created.ts';
import { drive } from '../src/drive/drive.ts';
import { drivePrincipal } from '../src/drive/drive-principal.ts';
import type { EntityLoadMatchers } from '../src/drive/entity-load-matchers.ts';
import { load } from '../src/drive/load.ts';
import { newId } from '../src/drive/new-id.ts';
import { runInMemory } from '../src/drive/run-in-memory.ts';
import { conformanceApp, libraryApp } from '../src/fixtures/index.ts';
import { addBook } from '../src/fixtures/modules/library/src/actions/add-book.ts';
import { book } from '../src/fixtures/modules/library/src/entities/book.ts';
import { testPrincipal } from '../src/harness/test-principal.ts';

const library = load.library as { readonly book: EntityLoadMatchers };
const input = { title: 'Dune', isbn: '978-0441172719' };
const bookId = '00000000-0000-7000-8000-000000000001';

describe('drive: a handler run with its answers as data', () => {
  test('addBook: the example of section 7.9.6, no storage and no runtime', async () => {
    const run = drive(libraryApp, 'library.addBook', {
      input,
      principal: testPrincipal('ada'),
    });
    run.expect(library.book.exists({ isbn: input.isbn })).answer(false);
    run.expect(newId(book)).answer(bookId);
    await run.returns({
      events: [created(book, { id: bookId, ...input, addedBy: 'ada' })],
      result: { bookId },
    });
  });

  test('an answer of true makes addBook fail with library.isbn_taken', async () => {
    const run = drive(libraryApp, 'library.addBook', { input });
    run.expect(library.book.exists({ isbn: input.isbn })).answer(true);
    await run.throws('library.isbn_taken');
  });

  test('the part defineCommand returned drives as well as its reference', async () => {
    const run = drive(libraryApp, addBook, { input });
    run.expect(library.book.exists({ isbn: input.isbn })).answer(true);
    await run.throws('library.isbn_taken');
  });

  test('a request other than the expected one fails the drive with a diff', async () => {
    const run = drive(libraryApp, 'library.addBook', { input });
    run.expect(library.book.exists({ isbn: 'another' })).answer(false);
    await expect(run.returns({})).rejects.toThrow(/isbn/);
  });

  test('a request nothing expected fails the drive', async () => {
    const run = drive(libraryApp, 'library.addBook', { input });
    await expect(run.returns({})).rejects.toThrow(/nothing expected/);
  });

  test('an expected request the handler never made fails the drive', async () => {
    const run = drive(libraryApp, 'library.addBook', { input });
    run.expect(library.book.exists({ isbn: input.isbn })).answer(false);
    run.expect(newId(book)).answer(bookId);
    run.expect(library.book.count()).answer(0);
    await expect(
      run.returns({
        events: [created(book, { id: bookId, ...input, addedBy: 'tester' })],
        result: { bookId },
      }),
    ).rejects.toThrow(/never made/);
  });

  test('other drafts than the expected ones fail the drive', async () => {
    const run = drive(libraryApp, 'library.addBook', { input });
    run.expect(library.book.exists({ isbn: input.isbn })).answer(false);
    run.expect(newId(book)).answer(bookId);
    await expect(
      run.returns({
        events: [created(book, { id: bookId, ...input, addedBy: 'someone else' })],
        result: { bookId },
      }),
    ).rejects.toThrow(/addedBy/);
  });

  test('an entity name that is no app prefix is refused', async () => {
    const run = drive(libraryApp, 'library.addBook', { input });
    run.expect(newId({ prefix: 'nope' })).answer(bookId);
    await expect(run.returns({})).rejects.toThrow(/prefix "nope"/);
  });
});

describe('driveDecision: a load the runtime would refuse', () => {
  const loanLoad = {
    kind: 'load',
    module: 'loans',
    entity: 'loan',
    op: 'count',
    args: [],
    view: 'module',
    forUpdate: false,
    *[Symbol.iterator](): Generator<unknown, unknown, unknown> {
      return yield this;
    },
  };

  test('a load outside the visible module set is refused with core.request_not_allowed', async () => {
    const { registry } = conformanceApp;
    const addBookAction = registry.actions.get('library.addBook');
    if (addBookAction === undefined) throw new Error('the fixture lost library.addBook');
    const action = {
      ...addBookAction,
      handler: () => loanLoad,
    };
    const scope = {
      level: 'tenant',
      backendId: '00000000-0000-4000-8000-0000000000b1',
      tenantId: '00000000-0000-4000-8000-0000000000a1',
    } as const;
    const error = await driveDecision({
      registry,
      action: action as typeof addBookAction,
      input,
      principal: drivePrincipal({ subject: 'tester', roles: [], claims: {} }, scope),
      scope,
      clock: { now: () => Temporal.Instant.from('2026-01-01T00:00:00Z') },
      answer: () => 0,
    }).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(isKeelwerkError(error) && error.code).toBe('core.request_not_allowed');
  });
});

describe('runInMemory: a command on the in-memory adapter from given rows', () => {
  const ada = testPrincipal('ada');

  test('a given row is there for the command to find', async () => {
    const run = await runInMemory(libraryApp, 'library.addBook', {
      input,
      principal: ada,
      rows: { 'library.book': [{ id: bookId, title: 'Dune', isbn: input.isbn, addedBy: 'ada' }] },
    });
    try {
      expect(run.outcome.ok).toBe(false);
      if (!run.outcome.ok) expect(run.outcome.error).toMatchObject({ code: 'library.isbn_taken' });
      expect(run.events.map((event) => event.type)).toEqual(['library.book.created']);
      expect(run.events[0]?.commandId).toBeNull();
      expect(await run.rows('library.book')).toHaveLength(1);
    } finally {
      await run.stop();
    }
  });

  test('another ISBN adds the book beside the given one', async () => {
    const run = await runInMemory(libraryApp, 'library.addBook', {
      input: { title: 'Emma', isbn: 'isbn-emma' },
      principal: ada,
      rows: { 'library.book': [{ id: bookId, title: 'Dune', isbn: input.isbn, addedBy: 'ada' }] },
    });
    try {
      expect(run.outcome.ok).toBe(true);
      expect(await run.rows('library.book')).toHaveLength(2);
      expect(run.events.map((event) => event.commandId)).toEqual([null, run.commandId]);
    } finally {
      await run.stop();
    }
  });

  test('an entity command runs on a given row', async () => {
    const run = await runInMemory(conformanceApp, 'library.book.reserve', {
      input: { id: bookId, ifVersion: 1 },
      principal: ada,
      rows: { 'library.book': [{ id: bookId, title: 'Dune', isbn: input.isbn, addedBy: 'ada' }] },
    });
    try {
      expect(run.outcome.ok).toBe(true);
      expect(run.events.map((event) => event.type)).toEqual([
        'library.book.created',
        'library.book.changed',
      ]);
    } finally {
      await run.stop();
    }
  });

  test('a row of an unknown entity is refused', async () => {
    await expect(
      runInMemory(libraryApp, 'library.addBook', { input, rows: { 'library.nope': [{}] } }),
    ).rejects.toMatchObject({ kind: 'not_found' });
  });

  test('errors of the pipeline come back as the outcome', async () => {
    const run = await runInMemory(libraryApp, 'library.addBook', {
      input,
      principal: testPrincipal(null),
    });
    try {
      expect(run.outcome.ok).toBe(false);
      if (!run.outcome.ok) expect(isKeelwerkError(run.outcome.error)).toBe(true);
    } finally {
      await run.stop();
    }
  });
});
