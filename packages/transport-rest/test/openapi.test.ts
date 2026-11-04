import { readdirSync, readFileSync } from 'node:fs';
import { validate } from '@scalar/openapi-parser';
import { describe, expect, test } from 'vitest';
import { emitOpenapi } from '../src/openapi/emit-openapi.ts';
import { openapiArtifact } from '../src/openapi/openapi-artifact.ts';
import { version } from '../src/version.ts';
import { emittedDocument, emittedText } from './support/emitted-document.ts';
import { librarySurface } from './support/library-surface.ts';

const resolvers = [
  { id: 'auth.session', describe: () => ({ scheme: 'cookie' as const, name: '__Host-session' }) },
  {
    id: 'api-keys.key',
    describe: () => ({ scheme: 'bearer' as const, description: 'An API key.' }),
  },
];

function operations(document: { paths: Record<string, Record<string, unknown>> }): string[] {
  return Object.entries(document.paths)
    .flatMap(([path, item]) => Object.keys(item).map((method) => `${method.toUpperCase()} ${path}`))
    .sort();
}

describe('the artefact', () => {
  test('two runs are byte-identical, and the file follows the generated rules of 13.7', () => {
    const first = emittedText(librarySurface);
    expect(emittedText(librarySurface)).toBe(first);
    expect(first.endsWith('}\n')).toBe(true);
    expect(first).not.toContain('\r');
    expect(first).toContain('\n  "components": {');
    const document = JSON.parse(first);
    expect(Object.keys(document)).toEqual([...Object.keys(document)].sort());
    expect(document['x-keelwerk-generated']).toEqual({
      apiVersion: '2026-11-01',
      format: 'keelwerk.openapi/1',
      producer: '@keelwerk/transport-rest',
      producerVersion: version,
      surface: 'sha256-libraryFixture',
    });
    expect(first).not.toMatch(/\d{4}-\d\d-\d\dT/);
  });

  test('the path is per app and API version, and equals the golden file', () => {
    const artifact = openapiArtifact(librarySurface);
    expect(artifact).toMatchObject({
      kind: 'file',
      path: 'generated/openapi/library/2026-11-01.json',
      contentType: 'application/json',
    });
    const content = (artifact.kind === 'file' ? artifact.content : '').replace(
      /("producerVersion": )"[^"]*"/,
      '$1"0"',
    );
    const stored = readFileSync(new URL('./fixtures/openapi.bytes', import.meta.url), 'utf8');
    expect(content).toBe(stored);
    const golden = readFileSync(new URL('./fixtures/openapi.json', import.meta.url), 'utf8');
    expect(JSON.parse(golden)).toEqual(JSON.parse(content));
  });

  test('info carries the app and the surface hash, servers the base path', () => {
    const document = emittedDocument(librarySurface);
    expect(document.openapi).toBe('3.1.1');
    expect(document.info).toEqual({ title: 'library', version: 'sha256-libraryFixture' });
    expect(document.servers).toEqual([{ url: '/api' }]);
    expect(emittedDocument(librarySurface, { basePath: '/v1' }).servers).toEqual([{ url: '/v1' }]);
    expect(document.tags.map((tag: { name: string }) => tag.name)).toEqual([
      'app',
      'core',
      'library',
    ]);
  });

  test('src has no node: imports (the emitter is pure)', () => {
    const files = readdirSync(new URL('../src/openapi/', import.meta.url));
    for (const file of files) {
      const text = readFileSync(new URL(`../src/openapi/${file}`, import.meta.url), 'utf8');
      expect(text, file).not.toMatch(/from 'node:|Date\.now|Math\.random|new Date/);
    }
  });
});

describe('independence', () => {
  test('changing an emitted document does not change the next one', () => {
    const first = emitOpenapi(librarySurface);
    const expected = emittedText(librarySurface);
    const components = first.components as {
      headers: { etag: { description: string } };
      schemas: Record<string, { properties: { kind: { enum: string[] } } }>;
    };
    components.headers.etag.description = 'changed';
    components.schemas['Problem']?.properties.kind.enum.push('changed');
    expect(emittedText(librarySurface)).toBe(expected);
  });
});

describe('validity', () => {
  test('the document validates under the OpenAPI parser, with and without security schemes', async () => {
    for (const options of [{}, { resolvers }, { openapi: '3.2' as const }]) {
      const result = await validate(emittedText(librarySurface, options));
      expect(result.errors ?? []).toEqual([]);
      expect(result.valid).toBe(true);
    }
  });

  test('the 3.2 document names itself 3.2.0 with QUERY operations, itemSchema and nested tags', () => {
    const document = emittedDocument(librarySurface, { openapi: '3.2' });
    expect(document.openapi).toBe('3.2.0');
    expect(document.paths['/library/books/report'].query.operationId).toBe(
      'libraryBookReportQuery',
    );
    expect(document.paths['/library/books/report'].post['x-keelwerk-safe']).toBe(true);
    expect(
      document.paths['/library/books/watch'].get.responses['200'].content['text/event-stream'],
    ).toEqual({ itemSchema: { $ref: '#/components/schemas/LibraryBookWatchOutput' } });
    expect(document.tags).toContainEqual({
      name: 'library.book',
      summary: 'book',
      parent: 'library',
      description: 'A book in the library.',
    });
    expect(document.paths['/library/books/watch'].get.tags).toEqual(['library.book']);
  });
});

describe('the resource mapping of 16.5.1', () => {
  test('every route of the library surface, by method and path', () => {
    expect(operations(emittedDocument(librarySurface))).toEqual([
      'DELETE /library/books/{id}',
      'GET /app/health',
      'GET /core/me',
      'GET /library/authors',
      'GET /library/authors/{id}',
      'GET /library/books',
      'GET /library/books/changes',
      'GET /library/books/search',
      'GET /library/books/watch',
      'GET /library/books/{id}',
      'GET /library/books/{id}/history',
      'GET /library/events',
      'GET /library/shelves/{id}',
      'GET /library/stats',
      'PATCH /library/books/{id}',
      'POST /library/authors/get',
      'POST /library/authors/query',
      'POST /library/books',
      'POST /library/books/get',
      'POST /library/books/query',
      'POST /library/books/query-changes',
      'POST /library/books/report',
      'POST /library/books/set',
      'POST /library/books/{id}/check-out',
      'POST /library/books/{id}/restore',
      'POST /library/register',
      'POST /library/shelves/get',
    ]);
  });

  test('operation ids are camel(ref), the second route of an action takes a suffix; hidden actions are absent', () => {
    const document = emittedDocument(librarySurface);
    expect(document.paths['/library/books'].get.operationId).toBe('libraryBookQuery');
    expect(document.paths['/library/books/query'].post.operationId).toBe('libraryBookQueryPost');
    expect(document.paths['/library/books'].post.operationId).toBe('libraryBookCreate');
    expect(document.paths['/library/books/{id}'].delete.operationId).toBe('libraryBookArchive');
    expect(JSON.stringify(document.paths)).not.toContain('libraryInternal');
    expect(document.components.schemas.LibraryInternalOutput).toBeUndefined();
  });

  test('queries that are not query-string representable are POST and documented as safe', () => {
    const document = emittedDocument(librarySurface);
    const report = document.paths['/library/books/report'].post;
    expect(report['x-keelwerk-safe']).toBe(true);
    expect(report.requestBody.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/LibraryBookReportInput',
    });
    expect(document.paths['/library/books/search'].get.parameters).toEqual([
      { in: 'query', name: 'text', required: true, schema: { type: 'string' } },
      {
        in: 'query',
        name: 'statuses',
        required: false,
        style: 'form',
        explode: true,
        schema: { type: 'array', items: { type: 'string', enum: ['available', 'lent'] } },
      },
    ]);
  });

  test('filter is a JSON content parameter, sort the compact form, ids carry the prefix pattern', () => {
    const query = emittedDocument(librarySurface).paths['/library/books'].get;
    const byName = Object.fromEntries(query.parameters.map((p: { name: string }) => [p.name, p]));
    expect(byName.filter.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/LibraryBookFilter',
    });
    expect(byName.sort.schema).toEqual({ type: 'string' });
    const single = emittedDocument(librarySurface).paths['/library/books/{id}'].get;
    expect(single.parameters[0]).toMatchObject({ name: 'id', in: 'path', required: true });
    expect(single.parameters[0].schema.pattern).toMatch(/^\^bk_/);
    expect(single.parameters.map((p: { name?: string }) => p.name)).not.toContain('ids');
    expect(single.responses['200'].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/LibraryBook',
    });
    expect(single.responses['304']).toBeDefined();
  });

  test('the irregular collection hint renames the collection of every action of the entity', () => {
    const document = emittedDocument(librarySurface);
    expect(Object.keys(document.paths).filter((path) => path.includes('shel'))).toEqual([
      '/library/shelves/get',
      '/library/shelves/{id}',
    ]);
  });
});
