import { describe, expect, test } from 'vitest';
import { emittedDocument } from './support/emitted-document.ts';
import { librarySurface } from './support/library-surface.ts';
import { action, none, shape } from './support/nodes.ts';
import { withActions } from './support/with-actions.ts';

const resolvers = [
  { id: 'auth.session', describe: () => ({ scheme: 'cookie' as const, name: '__Host-session' }) },
  {
    id: 'api-keys.key',
    describe: () => ({ scheme: 'bearer' as const, description: 'An API key.' }),
  },
];

function _operations(document: { paths: Record<string, Record<string, unknown>> }): string[] {
  return Object.entries(document.paths)
    .flatMap(([path, item]) => Object.keys(item).map((method) => `${method.toUpperCase()} ${path}`))
    .sort();
}

describe('schemas', () => {
  const { schemas } = emittedDocument(librarySurface).components;

  test('per entity: read, create, patch and the recursive filter', () => {
    expect(schemas.LibraryBook.properties.$masked).toEqual({
      type: 'array',
      items: { type: 'string' },
    });
    expect(schemas.LibraryBook.properties.id.readOnly).toBe(true);
    expect(schemas.LibraryBookCreate.properties.id).toBeUndefined();
    expect(schemas.LibraryBookCreate.required).toEqual(
      expect.arrayContaining(['title', 'isbn', 'status', 'author']),
    );
    expect(schemas.LibraryBookPatch.required).toBeUndefined();
    expect(schemas.LibraryBookPatch.properties.title).toBeDefined();
  });

  test('the filter recurses through and, or, not and relations, and respects field kinds', () => {
    const filter = schemas.LibraryBookFilter;
    const self = { $ref: '#/components/schemas/LibraryBookFilter' };
    expect(filter.properties.and).toEqual({ type: 'array', items: self });
    expect(filter.properties.or).toEqual({ type: 'array', items: self });
    expect(filter.properties.not).toEqual(self);
    expect(filter.properties.author.properties.is).toEqual({
      $ref: '#/components/schemas/LibraryAuthorFilter',
    });
    expect(schemas.LibraryAuthorFilter.properties.books.properties.some).toEqual(self);
    const operators = (name: string) =>
      Object.keys(filter.properties[name].anyOf.at(-1).properties).sort();
    expect(operators('tags')).toEqual(['contains', 'isNull']);
    expect(operators('notes')).toEqual(['isNull']);
    expect(operators('reviewer')).toEqual(['eq', 'isNull']);
    expect(operators('pages')).toContain('gte');
    expect(operators('status')).not.toContain('gte');
    expect(filter.properties.reviewer.anyOf).toHaveLength(2);
  });

  test('the filter member of an entity action points at the filter schema', () => {
    expect(schemas.LibraryBookQueryInput.properties.filter).toEqual({
      $ref: '#/components/schemas/LibraryBookFilter',
    });
  });

  test('instance commands leave id and ifVersion to the path and If-Match', () => {
    expect(schemas.LibraryBookUpdateInput.properties.id).toBeUndefined();
    expect(schemas.LibraryBookUpdateInput.properties.ifVersion).toBeUndefined();
    expect(schemas.LibraryBookUpdateInput.properties.title).toBeDefined();
    expect(schemas.LibraryBookStatsOutput).toBeUndefined();
    expect(schemas.LibraryStatsOutput).toBeDefined();
    expect(schemas.LibraryStatsInput).toBeUndefined();
  });
});

describe('security', () => {
  test('schemes come from the resolvers, public actions make authentication optional', () => {
    const document = emittedDocument(librarySurface, { resolvers });
    expect(document.components.securitySchemes).toEqual({
      'api-keys.key': { type: 'http', scheme: 'bearer', description: 'An API key.' },
      'auth.session': { type: 'apiKey', in: 'cookie', name: '__Host-session' },
    });
    expect(document.paths['/library/books'].get.security).toEqual([
      { 'api-keys.key': [] },
      { 'auth.session': [] },
    ]);
    expect(document.paths['/app/health'].get.security).toEqual([
      {},
      { 'api-keys.key': [] },
      { 'auth.session': [] },
    ]);
  });

  test('without selected resolvers the document lists none', () => {
    const document = emittedDocument(librarySurface);
    expect(document.components.securitySchemes).toBeUndefined();
    expect(document.paths['/library/books'].get.security).toBeUndefined();
  });
});

describe('response hints', () => {
  test('raw, download, redirect and empty outputs', () => {
    const hinted = (name: string, response: unknown) =>
      action(`library.${name}`, {
        mount: 'module',
        kind: 'query',
        input: none,
        output: shape({}),
        hints: { http: { response } } as never,
      });
    const surface = withActions(
      librarySurface,
      hinted('raw', { kind: 'raw', contentType: 'text/plain', from: 'text' }),
      hinted('download', { kind: 'download', from: 'file' }),
      hinted('redirect', { kind: 'redirect', from: 'to', status: 303 }),
      hinted('empty', { kind: 'empty', status: 204 }),
    );
    const { paths } = emittedDocument(surface);
    expect(paths['/library/raw'].get.responses['200'].content).toEqual({
      'text/plain': { schema: { type: 'string' } },
    });
    expect(paths['/library/download'].get.responses['200'].content).toEqual({
      'application/octet-stream': { schema: { type: 'string', format: 'binary' } },
    });
    expect(Object.keys(paths['/library/redirect'].get.responses)).toContain('303');
    expect(paths['/library/empty'].get.responses['204'].content).toBeUndefined();
  });
});
