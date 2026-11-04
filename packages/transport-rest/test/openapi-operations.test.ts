import { describe, expect, test } from 'vitest';
import { emitOpenapi } from '../src/openapi/emit-openapi.ts';
import { emittedDocument } from './support/emitted-document.ts';
import { librarySurface } from './support/library-surface.ts';
import { action, anyJson, id, list, none, shape, str } from './support/nodes.ts';
import { withActions } from './support/with-actions.ts';

const _resolvers = [
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

describe('request and response documentation', () => {
  const document = emittedDocument(librarySurface);
  const refs = (operation: { parameters?: { $ref?: string }[] }) =>
    (operation.parameters ?? []).flatMap((p) =>
      p.$ref === undefined ? [] : [p.$ref.split('/').pop()],
    );

  test('commands document Idempotency-Key, instance commands If-Match and ETag', () => {
    const update = document.paths['/library/books/{id}'].patch;
    expect(refs(update)).toEqual(['idempotencyKey', 'ifMatch']);
    expect(update.responses['200'].headers.ETag).toBeDefined();
    expect(update.requestBody.content['application/merge-patch+json']).toBeDefined();
    expect(update.requestBody.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/LibraryBookPatch',
    });
    expect(refs(document.paths['/library/books/{id}/check-out'].post)).toEqual([
      'idempotencyKey',
      'ifMatch',
      'prefer',
    ]);
    expect(refs(document.paths['/library/books/query'].post)).toEqual([]);
  });

  test('create answers 201 with Location and ETag, and 202 for either', () => {
    const create = document.paths['/library/books'].post;
    expect(Object.keys(create.responses).filter((s) => s < '300')).toEqual(['201', '202']);
    expect(Object.keys(create.responses['201'].headers)).toEqual(
      expect.arrayContaining(['ETag', 'Location', 'Keelwerk-Command-Id']),
    );
    expect(create.responses['202'].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/CommandReceipt',
    });
    expect(create.responses['202'].headers['Preference-Applied']).toBeDefined();
  });

  test('either gives 204 and 202 for a void output, async documents only 202', () => {
    const checkOut = document.paths['/library/books/{id}/check-out'].post;
    expect(Object.keys(checkOut.responses).filter((s) => s < '300')).toEqual(['202', '204']);
    const register = document.paths['/library/register'].post;
    expect(Object.keys(register.responses).filter((s) => s < '300')).toEqual(['202']);
    expect(register.deprecated).toBe(true);
    expect(register['x-keelwerk-contributed-by']).toBe('accounts');
    expect(refs(register)).toEqual(['idempotencyKey']);
  });

  test('server-sent events are a string schema with the item schema extension in 3.1', () => {
    const watch = document.paths['/library/books/watch'].get.responses['200'].content;
    expect(watch['text/event-stream']).toEqual({
      schema: { type: 'string' },
      'x-keelwerk-item-schema': { $ref: '#/components/schemas/LibraryBookWatchOutput' },
    });
  });

  test('extensions on each operation', () => {
    const create = document.paths['/library/books'].post;
    expect(create['x-keelwerk-action']).toBe('library.book.create');
    expect(create['x-keelwerk-execution']).toBe('either');
    expect(create['x-keelwerk-scope']).toBe('tenant');
    expect(document.paths['/app/health'].get['x-keelwerk-scope']).toBe('deployment');
  });
});

describe('instance queries and the filter and sort rule', () => {
  const surface = withActions(
    librarySurface,
    action('library.book.inspect', {
      mount: 'entity',
      instance: true,
      kind: 'query',
      input: shape({ id: id('library.book', 'bk'), where: shape({ a: str() }) }),
      output: none,
    }),
    action('library.find', {
      mount: 'module',
      kind: 'query',
      input: shape({
        filter: anyJson(false),
        sort: list(shape({ field: str(), direction: str() })),
        q: str(),
      }),
      output: none,
    }),
  );

  test('an instance query with a nested member documents a request body, not parameters', () => {
    const paths = emittedDocument(surface).paths['/library/books/{id}/inspect'];
    expect(paths.get).toBeUndefined();
    expect(paths.post.requestBody.content['application/json']).toBeDefined();
    expect(
      Object.keys(
        emittedDocument(surface, { openapi: '3.2' }).paths['/library/books/{id}/inspect'],
      ),
    ).toEqual(expect.arrayContaining(['post', 'query']));
  });

  test('filter is application/json content and sort a string parameter', () => {
    const parameters = emittedDocument(surface).paths['/library/find'].get.parameters;
    const named = (name: string) => parameters.find((p: { name?: string }) => p.name === name);
    expect(named('filter').content['application/json']).toBeDefined();
    expect(named('sort').schema.type).toBe('string');
    expect(named('q').schema.type).toBe('string');
  });
});

describe('problems', () => {
  const document = emittedDocument(librarySurface);

  test('declared errors are a oneOf over their schemas and Problem with a discriminator on code, under the status of their kind', () => {
    const update = document.paths['/library/books/{id}'].patch.responses;
    expect(update['412'].content['application/problem+json'].schema).toEqual({
      oneOf: [
        { $ref: '#/components/schemas/CoreVersionMismatchProblem' },
        {
          allOf: [{ $ref: '#/components/schemas/Problem' }],
          not: { required: ['code'], properties: { code: { enum: ['core.version_mismatch'] } } },
        },
      ],
      discriminator: {
        propertyName: 'code',
        mapping: { 'core.version_mismatch': '#/components/schemas/CoreVersionMismatchProblem' },
      },
    });
    expect(update['409'].content['application/problem+json'].schema.oneOf).toEqual([
      { $ref: '#/components/schemas/LibraryIsbnTakenProblem' },
      {
        allOf: [{ $ref: '#/components/schemas/Problem' }],
        not: { required: ['code'], properties: { code: { enum: ['library.isbn_taken'] } } },
      },
    ]);
  });

  test('the generic member excludes every declared code, so the oneOf is exclusive', () => {
    const schema = (dialect: '3.1' | '3.2') =>
      emittedDocument(librarySurface, { openapi: dialect }).paths['/library/books/{id}'].patch
        .responses['412'].content['application/problem+json'].schema;
    const [declared, generic] = schema('3.1').oneOf;
    const excluded = generic.not.properties.code.enum;
    const declaredCode =
      emittedDocument(librarySurface).components.schemas[declared.$ref.split('/').pop() as string]
        .allOf[1].properties.code.const;
    expect(excluded).toContain(declaredCode);
    expect(Object.keys(schema('3.1').discriminator.mapping)).toEqual(excluded);
    expect(schema('3.1').discriminator.defaultMapping).toBeUndefined();
    expect(schema('3.2').discriminator.defaultMapping).toBe('#/components/schemas/Problem');
  });

  test('the taxonomy statuses every action can return reference shared responses', () => {
    const health = document.paths['/app/health'].get.responses;
    expect(Object.keys(health)).toEqual(['200', '400', '401', '403', '422', '429', '500', '503']);
    expect(health['429']).toEqual({ $ref: '#/components/responses/problem429' });
    expect(document.components.responses.problem429.headers['Retry-After']).toBeDefined();
    expect(Object.keys(document.paths['/library/books/{id}'].get.responses)).toContain('404');
  });

  test('a declared error schema fixes its code and types its details', () => {
    const lent = document.components.schemas.LibraryAlreadyLentProblem;
    expect(lent.allOf[0]).toEqual({ $ref: '#/components/schemas/Problem' });
    expect(lent.allOf[1].properties.code).toEqual({ const: 'library.already_lent' });
    expect(lent.allOf[1].properties.kind).toEqual({ const: 'conflict' });
    expect(lent.allOf[1].properties.details.properties.since).toMatchObject({
      format: 'date-time',
    });
    expect(document.components.schemas.Problem.required).toEqual(
      expect.arrayContaining(['code', 'kind', 'requestId']),
    );
    expect(document.components.schemas.CommandReceipt.required).toEqual(['commandId', 'status']);
    expect(document.components.schemas.PageInfo.required).toContain('hasNextPage');
  });

  test('an action that declares an error the surface does not list fails the emitter', () => {
    const broken = withActions(
      librarySurface,
      action('library.broken', {
        mount: 'module',
        kind: 'query',
        input: none,
        output: none,
        errors: ['library.nope'],
      }),
    );
    expect(() => emitOpenapi(broken)).toThrow(/library\.nope/);
  });
});
