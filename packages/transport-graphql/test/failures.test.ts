import { errors, type Invocation, type KeelwerkError, type Outcome } from '@keelwerk/core';
import { recordingLogger } from '@keelwerk/testing';
import { GraphQLError } from 'graphql';
import { describe, expect, test } from 'vitest';
import { keelwerkErrorsPlugin } from '../src/errors/keelwerk-errors-plugin.ts';
import {
  ask,
  graphqlSession,
  mountedGraphql,
  publicId,
  sendGraphql,
  transportSurface,
  uuidOf,
} from './support/graphql-kit.ts';
import { libraryBookRow, loanRow, rowPage } from './support/rows.ts';

const surface = transportSurface();

type Respond = (inv: Invocation<unknown>) => Outcome<unknown>;

const loans =
  (
    rows: readonly Record<string, unknown>[],
    over: Respond = () => ({ ok: true, value: undefined }),
  ): Respond =>
  (inv) =>
    inv.action === 'loans.loan.query' ? { ok: true, value: rowPage(rows) } : over(inv);

describe('errors', () => {
  const failing =
    (error: KeelwerkError): Respond =>
    () => ({ ok: false, error });

  test('an undeclared failure is in errors[] with extensions.code and keelwerk, requestId included', async () => {
    const { handler } = await mountedGraphql(surface, failing(errors.forbidden('Not for you.')));
    const answer = await ask(handler, '{ loansLoans { nodes { id } } }');
    expect(answer.status).toBe(200);
    expect(answer.body.errors).toHaveLength(1);
    expect(answer.body.errors[0].extensions.code).toBe('FORBIDDEN');
    expect(answer.body.errors[0].extensions.keelwerk).toMatchObject({
      kind: 'forbidden',
      code: 'core.forbidden',
      requestId: '01929b5e-7c3a-7f00-9a51-2f0a0c1b4d11',
    });
    expect(answer.body.errors[0].path).toEqual(['loansLoans']);
  });

  test('every kind has its code', async () => {
    const cases: [KeelwerkError, string][] = [
      [errors.unauthenticated('x'), 'UNAUTHENTICATED'],
      [errors.not_found('x'), 'NOT_FOUND'],
      [errors.conflict('x'), 'CONFLICT'],
      [errors.rate_limited('x'), 'RATE_LIMITED'],
      [errors.unavailable('x'), 'UNAVAILABLE'],
    ];
    for (const [error, code] of cases) {
      const { handler } = await mountedGraphql(surface, failing(error));
      const answer = await ask(handler, '{ loansLoans { nodes { id } } }');
      expect(answer.body.errors[0].extensions.code).toBe(code);
    }
  });

  test('an internal error answers the public message and no stack, logged once', async () => {
    const cause = new Error('connection string postgres://secret');
    const { handler, lines } = await mountedGraphql(
      surface,
      failing(errors.internal('relation "kw_loans" does not exist', { cause })),
    );
    const answer = await ask(handler, '{ loansLoans { nodes { id } } }');
    const text = JSON.stringify(answer.body);
    expect(answer.body.errors[0].extensions.code).toBe('INTERNAL_SERVER_ERROR');
    expect(answer.body.errors[0].message).toBe('Internal server error.');
    expect(text).not.toContain('kw_loans');
    expect(text).not.toContain('postgres://');
    expect(text).not.toContain('stack');
    expect(text).not.toContain('at ');
    const logged = lines.filter((line) => line.message === 'The GraphQL request failed.');
    expect(logged).toHaveLength(1);
    expect(logged[0]?.fields).toMatchObject({ code: 'core.internal', cause });
  });

  test('a throw inside the invoker is an internal error, never its message', async () => {
    const { handler, lines } = await mountedGraphql(surface, () => {
      throw new TypeError('boom with secrets');
    });
    const answer = await ask(handler, '{ loansLoans { nodes { id } } }');
    expect(answer.body.errors[0].extensions.code).toBe('INTERNAL_SERVER_ERROR');
    expect(JSON.stringify(answer.body)).not.toContain('boom');
    expect(lines.filter((line) => line.message === 'The GraphQL request failed.')).toHaveLength(1);
  });

  test('an output that does not fit its node is an internal error', async () => {
    const { handler, lines } = await mountedGraphql(
      surface,
      loans([{ ...loanRow(1), version: 'one' }]),
    );
    const answer = await ask(handler, '{ loansLoans { nodes { id } } }');
    expect(answer.body.errors[0].extensions.code).toBe('INTERNAL_SERVER_ERROR');
    expect(answer.body.data).toBeNull();
    expect(lines.filter((line) => line.level === 'error')).toHaveLength(1);
  });

  test('an unknown field names no neighbouring field', async () => {
    const { handler } = await mountedGraphql(surface, loans([]));
    const answer = await ask(handler, '{ loansLoanz { id } }');
    const text = JSON.stringify(answer.body);
    expect(text).not.toContain('Did you mean');
    expect(text).not.toMatch(/loansLoans|loansLoan\b/);
  });

  test('a variable that does not coerce is a validation error', async () => {
    const { handler } = await mountedGraphql(surface, loans([]));
    const answer = await ask(handler, 'query($n: Int) { loansLoans(first: $n) { nodes { id } } }', {
      n: 'many',
    });
    expect(answer.body.errors[0].extensions.keelwerk.code).toBe('core.validation');
    expect(answer.body.errors[0].extensions.code).toBe('BAD_USER_INPUT');
  });

  test('an enum variable that names no value carries no suggestion', async () => {
    const { handler, calls } = await mountedGraphql(surface, loans([]));
    const answer = await ask(
      handler,
      'query($sort: [LoansLoanSort!]) { loansLoans(sort: $sort) { nodes { id } } }',
      { sort: [{ field: 'creatdAt' }] },
    );
    expect(answer.body.errors[0].extensions.keelwerk.code).toBe('core.validation');
    expect(JSON.stringify(answer.body)).not.toContain('Did you mean');
    expect(JSON.stringify(answer.body)).not.toContain('createdAt');
    expect(calls).toEqual([]);
  });

  test('a validation error of the invoker keeps its issues', async () => {
    const { handler } = await mountedGraphql(
      surface,
      failing(errors.validation('Bad.', { issues: [{ path: ['first'], message: 'too big' }] })),
    );
    const answer = await ask(handler, '{ loansLoans(first: 1) { nodes { id } } }');
    expect(answer.body.errors[0].extensions.keelwerk.issues).toEqual([
      { path: ['first'], message: 'too big' },
    ]);
  });
});

describe('introspection and GraphiQL', () => {
  const introspection = '{ __schema { queryType { name } } }';

  test('introspection is refused when core.introspect refuses, served when it answers', async () => {
    const refusing = await mountedGraphql(surface, () => ({
      ok: false,
      error: errors.forbidden('The surface is for operators only.'),
    }));
    const refused = await ask(refusing.handler, introspection);
    expect(refused.status).toBe(403);
    expect(refused.body.errors[0].extensions.code).toBe('FORBIDDEN');
    expect(refusing.calls.map((call) => call.action)).toEqual(['core.introspect']);

    const serving = await mountedGraphql(surface, () => ({ ok: true, value: {} }));
    const served = await ask(serving.handler, introspection);
    expect(served.body).toEqual({ data: { __schema: { queryType: { name: 'Query' } } } });
  });

  test('an unauthenticated refusal answers 401 with WWW-Authenticate', async () => {
    const refusing = await mountedGraphql(surface, () => ({
      ok: false,
      error: errors.unauthenticated('Sign in first.'),
    }));
    const refused = await ask(refusing.handler, introspection);
    expect(refused.status).toBe(401);
    expect(refused.headers.get('www-authenticate')).toBe('Bearer');
  });

  test('__typename is free and needs no introspection call', async () => {
    const { handler, calls } = await mountedGraphql(surface, () => ({
      ok: false,
      error: errors.forbidden('no'),
    }));
    const answer = await ask(handler, '{ __typename }');
    expect(answer.body).toEqual({ data: { __typename: 'Query' } });
    expect(calls).toEqual([]);
  });

  test('an introspection field inside a fragment is still introspection', async () => {
    const { handler, calls } = await mountedGraphql(surface, () => ({
      ok: false,
      error: errors.forbidden('no'),
    }));
    const answer = await ask(
      handler,
      '{ ...F } fragment F on Query { __type(name: "Query") { name } }',
    );
    expect(answer.status).toBe(403);
    expect(calls).toHaveLength(1);
  });

  test('GraphiQL only in development', async () => {
    const development = await mountedGraphql(surface, loans([]), { development: true });
    const page = await sendGraphql(development.handler, undefined, {
      method: 'GET',
      headers: { accept: 'text/html' },
    });
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    const html = await page.text();
    expect(html).toContain('GraphiQL');
    expect(html).toContain('"endpoint":"/graphql"');

    const production = await mountedGraphql(surface, loans([]));
    const refused = await sendGraphql(production.handler, undefined, {
      method: 'GET',
      headers: { accept: 'text/html' },
    });
    expect(refused.status).toBe(405);
  });
});

describe('the session', () => {
  test('a reference is read through the invoker with the caller session', async () => {
    const caller = graphqlSession({ apiVersion: '2026-11-04' });
    const { handler, calls } = await mountedGraphql(surface, (inv) =>
      inv.action === 'loans.loan.query'
        ? { ok: true, value: rowPage([loanRow(1, { bookId: uuidOf(9) })]) }
        : { ok: true, value: { list: [libraryBookRow(9)], notFound: [] } },
    );
    await ask(handler, '{ loansLoans { nodes { book { title } } } }', undefined, {
      session: caller,
    });
    expect(calls.map((call) => call.action)).toEqual(['loans.loan.query', 'library.book.get']);
    for (const call of calls) {
      expect(call.session).toBe(caller);
      expect(call.carrier.transport).toBe('graphql');
      expect(call.requestId).toBe('01929b5e-7c3a-7f00-9a51-2f0a0c1b4d11');
    }
  });

  test('a failed reference get is a field-level error on each book field', async () => {
    const { handler } = await mountedGraphql(surface, (inv) =>
      inv.action === 'loans.loan.query'
        ? {
            ok: true,
            value: rowPage([loanRow(1, { bookId: uuidOf(9) }), loanRow(2, { bookId: uuidOf(9) })]),
          }
        : { ok: false, error: errors.forbidden('Books are not for you.') },
    );
    const answer = await ask(handler, '{ loansLoans { nodes { id book { title } } } }');
    expect(answer.body.data.loansLoans.nodes).toEqual([
      { id: publicId('loan', 1), book: null },
      { id: publicId('loan', 2), book: null },
    ]);
    expect(answer.body.errors.map((error: { path: unknown[] }) => error.path)).toEqual([
      ['loansLoans', 'nodes', 0, 'book'],
      ['loansLoans', 'nodes', 1, 'book'],
    ]);
    expect(answer.body.errors[0].extensions.code).toBe('FORBIDDEN');
  });
});

describe('an error raised before any field ran', () => {
  test("one that is not the engine's own answers a fixed message, never the runtime's", () => {
    const plugin = keelwerkErrorsPlugin();
    const hook = plugin.onExecute?.({} as never);
    const context = {
      session: graphqlSession(),
      development: false,
      requestId: '01929b5e-7c3a-7f00-9a51-2f0a0c1b4d11',
      log: recordingLogger(),
    };
    const done = (error: GraphQLError): readonly GraphQLError[] => {
      let answered: readonly GraphQLError[] = [];
      const after = (hook as { onExecuteDone?: (payload: never) => void } | undefined)
        ?.onExecuteDone;
      after?.({
        args: { contextValue: context },
        result: { errors: [error] },
        setResult: (result: unknown) => {
          answered = (result as { errors: readonly GraphQLError[] }).errors;
        },
      } as never);
      return answered;
    };
    const overflow = new RangeError('Maximum call stack size exceeded');
    const [fixed] = done(new GraphQLError(overflow.message, { originalError: overflow }));
    expect(fixed?.message).toBe('The variables do not fit their types.');
    expect(fixed?.extensions.code).toBe('BAD_USER_INPUT');
    const [engine] = done(
      new GraphQLError('Variable "$a" of required type "Int!" was not provided.'),
    );
    expect(engine?.message).toContain('Variable "$a"');
  });
});
