import type { ApiSurface } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { checkRestSurface } from '../src/check/check-rest-surface.ts';
import { createRestAdapter } from '../src/create-rest-adapter.ts';
import { emitOpenapi } from '../src/openapi/emit-openapi.ts';
import { librarySurface } from './support/library-surface.ts';
import { action, none, shape, str } from './support/nodes.ts';
import { invokerWith, mountRest } from './support/rest-kit.ts';
import { withActions } from './support/with-actions.ts';

const bySubject = (surface: ApiSurface) =>
  checkRestSurface(surface).map(({ code, subject }) => `${code} ${subject}`);

describe('checkRestSurface', () => {
  test('the library surface projects cleanly', () => {
    expect(checkRestSurface(librarySurface)).toEqual([]);
  });

  test('two actions with one operation id collide, and the message names the hint that resolves it', () => {
    const surface = withActions(
      librarySurface,
      action('library.bookSearch', { mount: 'module', kind: 'query', input: none, output: none }),
    );
    const problems = checkRestSurface(surface);
    expect(bySubject(surface)).toEqual(
      expect.arrayContaining([
        'nameCollision library.book.search',
        'nameCollision library.bookSearch',
      ]),
    );
    const collision = problems.find((problem) => problem.subject === 'library.bookSearch');
    expect(collision).toMatchObject({ transport: 'rest', code: 'nameCollision' });
    expect(collision?.message).toContain('libraryBookSearch');
    expect(collision?.message).toContain('rest.expose');
    expect(() => emitOpenapi(surface)).toThrow(/libraryBookSearch/);
  });

  test('the adapter check() reports a name collision, and artifacts() yields the library file', () => {
    const surface = withActions(
      librarySurface,
      action('library.bookSearch', { mount: 'module', kind: 'query', input: none, output: none }),
    );
    const adapter = createRestAdapter();
    expect(adapter.check(surface)).toEqual(
      checkRestSurface(surface, { basePath: '/api', openapi: '3.1' }),
    );
    expect(adapter.check(surface).map((problem) => problem.code)).toContain('nameCollision');
    expect(adapter.artifacts(librarySurface)).toEqual([
      expect.objectContaining({ kind: 'file', path: 'generated/openapi/library/2026-11-01.json' }),
    ]);
  });

  test('mount refuses exactly what check reports, with the problem code and subject', async () => {
    const surface = withActions(
      librarySurface,
      action('library.bookSearch', { mount: 'module', kind: 'query', input: none, output: none }),
    );
    const first = checkRestSurface(surface)[0];
    expect(first).toMatchObject({ code: 'nameCollision' });
    await expect(
      mountRest(
        surface,
        invokerWith(async () => ({ ok: true, value: undefined })),
      ),
    ).rejects.toThrow(new RegExp(`^nameCollision: ${first?.subject.replaceAll('.', '\\.')}:`));
  });

  test('under 3.1 a collision on a Query operation id is not reported, under 3.2 it is', () => {
    const surface = withActions(
      librarySurface,
      action('library.book.reportQuery', {
        mount: 'entity',
        kind: 'query',
        input: shape({ a: shape({}) }),
        output: none,
      }),
    );
    expect(checkRestSurface(surface, { openapi: '3.1' })).toEqual([]);
    expect(checkRestSurface(surface, { openapi: '3.2' }).map((p) => p.code)).toContain(
      'nameCollision',
    );
  });

  test('a hidden action takes no part in a collision', () => {
    const surface = withActions(
      librarySurface,
      action('library.bookSearch', {
        mount: 'module',
        kind: 'query',
        input: none,
        output: none,
        hints: { rest: { expose: false } },
      }),
    );
    expect(checkRestSurface(surface)).toEqual([]);
  });

  test('a module action named like a collection is a route conflict naming rest.path', () => {
    const surface = withActions(
      librarySurface,
      action('library.books', { mount: 'module', kind: 'query', input: none, output: none }),
    );
    const problems = checkRestSurface(surface).filter(
      (problem) => problem.code === 'routeConflict',
    );
    expect(problems.map((problem) => problem.subject)).toEqual(
      expect.arrayContaining(['library.books']),
    );
    expect(problems[0]?.message).toContain('rest.path');
    expect(problems.some((problem) => problem.message.includes("'/library/books'"))).toBe(true);
  });

  test('two actions on one method and path conflict, and rest.path resolves it', () => {
    const clashing = (ref: string, path: string) =>
      action(ref, {
        mount: 'module',
        kind: 'command',
        input: none,
        output: none,
        hints: { rest: { path } },
      });
    const surface = withActions(
      librarySurface,
      clashing('library.first', 'same'),
      clashing('library.second', 'same'),
    );
    expect(bySubject(surface)).toEqual(['routeConflict library.second']);
    const fixed = withActions(
      librarySurface,
      clashing('library.first', 'same'),
      clashing('library.second', 'other'),
    );
    expect(checkRestSurface(fixed)).toEqual([]);
  });

  test('a relative rest.path hint is a segment below the module and conflicts with the collection it names', () => {
    const surface = withActions(
      librarySurface,
      action('library.byId', {
        mount: 'module',
        kind: 'query',
        input: none,
        output: none,
        hints: { rest: { path: 'books' } },
      }),
    );
    expect(bySubject(surface)).toEqual(['routeConflict library.byId']);
  });

  test('a relative rest.path hint passes the check and is documented below the module', () => {
    const surface = withActions(
      librarySurface,
      action('library.ping', {
        mount: 'module',
        kind: 'command',
        input: none,
        output: none,
        hints: { rest: { path: 'pong' } },
      }),
    );
    expect(checkRestSurface(surface)).toEqual([]);
    expect(Object.keys(emitOpenapi(surface).paths as object)).toContain('/library/pong');
  });

  test('a rest.path hint that starts with a slash is the host root, with its own servers entry', () => {
    const surface = withActions(
      librarySurface,
      action('library.mtaSts', {
        mount: 'module',
        kind: 'query',
        input: none,
        output: none,
        hints: { rest: { path: '/.well-known/mta-sts.txt' } },
      }),
    );
    expect(checkRestSurface(surface)).toEqual([]);
    const paths = emitOpenapi(surface).paths as Record<string, Record<string, unknown>>;
    expect(paths['/.well-known/mta-sts.txt']?.servers).toEqual([{ url: '/' }]);
    expect(paths['/.well-known/mta-sts.txt']?.get).toBeDefined();
    expect(paths['/library/mta-sts']).toBeUndefined();
  });

  test('a generated action ignores the rest.path hint', () => {
    const surface: ApiSurface = {
      ...librarySurface,
      actions: librarySurface.actions.map((candidate) =>
        candidate.ref === 'library.book.archive'
          ? { ...candidate, hints: { rest: { path: '/elsewhere' } } }
          : candidate,
      ),
    };
    const paths = emitOpenapi(surface).paths as Record<string, Record<string, unknown>>;
    expect(paths['/elsewhere']).toBeUndefined();
    expect(paths['/library/books/{id}']?.delete).toBeDefined();
  });

  test('a suffixed operation id collides with a generated one', () => {
    const surface = withActions(
      librarySurface,
      action('library.bookQueryPost', {
        mount: 'module',
        kind: 'query',
        input: none,
        output: none,
      }),
    );
    const problems = checkRestSurface(surface);
    expect(problems.map((problem) => `${problem.code} ${problem.subject}`)).toEqual(
      expect.arrayContaining([
        'nameCollision library.bookQueryPost',
        'nameCollision library.book.query',
      ]),
    );
    expect(() => emitOpenapi(surface)).toThrow(/libraryBookQueryPost/);
  });

  test('names on Object.prototype are ordinary names', () => {
    const surface = withActions(
      librarySurface,
      action('to.string', { mount: 'module', kind: 'query', input: none, output: none }),
    );
    expect(checkRestSurface(surface)).toEqual([]);
    const paths = emitOpenapi(surface).paths as Record<string, Record<string, unknown>>;
    expect(paths['/to/string']?.get).toBeDefined();
  });

  test('an entity action named like a generated action is a reserved name', () => {
    const surface = withActions(
      librarySurface,
      action('library.author.history', {
        mount: 'entity',
        kind: 'query',
        input: none,
        output: none,
      }),
      action('library.author.queryChanges', {
        mount: 'entity',
        kind: 'query',
        input: none,
        output: none,
      }),
    );
    expect(bySubject(surface)).toEqual([
      'reservedName library.author.history',
      'reservedName library.author.queryChanges',
    ]);
  });

  test('two entities of one module with the same collection collide and the message names rest.collection', () => {
    const surface: ApiSurface = {
      ...librarySurface,
      actions: librarySurface.actions.map((candidate) =>
        candidate.ref === 'library.shelf.get'
          ? { ...candidate, hints: { rest: { collection: 'authors' } } }
          : candidate,
      ),
    };
    const found = checkRestSurface(surface).filter(
      (problem) => problem.code === 'nameCollision' && problem.message.includes('rest.collection'),
    );
    expect(found.map((problem) => problem.subject)).toEqual(['library.author', 'library.shelf']);
    expect(found[0]?.message).toContain('library/authors');
  });

  test('schema names that two references share collide', () => {
    const surface = withActions(
      librarySurface,
      action('library-x.book', {
        mount: 'module',
        kind: 'query',
        input: shape({ a: str() }),
        output: none,
      }),
      action('library.xBook', {
        mount: 'module',
        kind: 'query',
        input: shape({ a: str() }),
        output: none,
      }),
    );
    const problems = checkRestSurface(surface).filter((problem) =>
      problem.message.includes('schema name'),
    );
    expect(problems.map((problem) => problem.subject)).toEqual(['library-x.book', 'library.xBook']);
  });

  test('an entity action without its entity, and an undeclared error, are unsupported shapes', () => {
    const surface = withActions(
      librarySurface,
      action('library.ghost.walk', { mount: 'entity', kind: 'query', input: none, output: none }),
      action('library.sad', {
        mount: 'module',
        kind: 'query',
        input: none,
        output: none,
        errors: ['library.unknown'],
      }),
    );
    expect(bySubject(surface)).toEqual([
      'unsupportedShape library.ghost.walk',
      'unknownError library.sad',
    ]);
  });

  test('the same surface gives the same problems in the same order', () => {
    const surface = withActions(
      librarySurface,
      action('library.bookSearch', { mount: 'module', kind: 'query', input: none, output: none }),
    );
    expect(checkRestSurface(surface)).toEqual(checkRestSurface(surface));
  });
});
