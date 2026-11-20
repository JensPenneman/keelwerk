import { errors } from '@keelwerk/core';
import {
  type LoggedLine,
  recordingLogger,
  requestHeaders,
  startTransportRuntime,
} from '@keelwerk/testing';
import { httpHost } from '@keelwerk/transport-http';
import { afterAll, describe, expect, test } from 'vitest';
import { orpcErrorOf } from '../src/errors/orpc-error-of.ts';
import type { OrpcAnswer } from '../src/router/orpc-answer.ts';
import { orpcEchoApp } from './support/orpc-echo-app.ts';

const lines: LoggedLine[] = [];
const runtime = await startTransportRuntime({
  app: orpcEchoApp(),
  host: httpHost(),
  config: { orpc: { cors: [] } },
  logger: recordingLogger(lines),
});
const openapi = await startTransportRuntime({
  app: orpcEchoApp({ openapi: '/orpc-openapi' }),
  host: httpHost(),
  config: { orpc: { cors: [] } },
  logger: recordingLogger(lines),
});
afterAll(async () => {
  await runtime.stop();
  await openapi.stop();
});

function post(
  path: string,
  input: unknown,
  caller: { subject?: string } = {},
  init: { body?: string; on?: typeof runtime; prefix?: string } = {},
): Promise<Response> {
  const headers = requestHeaders(caller);
  headers.set('content-type', 'application/json');
  const target = init.on ?? runtime;
  return target.fetch(
    new Request(`https://${target.domains.acme}${init.prefix ?? '/orpc'}/${path}`, {
      method: 'POST',
      headers,
      body: init.body ?? JSON.stringify({ json: input }),
    }),
  );
}

interface ErrorBody {
  readonly json: {
    readonly defined: boolean;
    readonly code: string;
    readonly status: number;
    readonly message: string;
    readonly data: Record<string, unknown>;
  };
  readonly meta: unknown[];
}

describe('the answer to an error', () => {
  test('a taxonomy error answers its 16.4.6 status with the wire error as data', async () => {
    const add = () =>
      post('library/addBook', { title: 'Dune', isbn: '978-0-441-17271-9' }, { subject: 'ada' });
    expect((await add()).status).toBe(200);
    const answer = await add();
    expect(answer.status).toBe(409);
    const body = (await answer.json()) as ErrorBody;
    expect(body.json).toMatchObject({
      defined: true,
      code: 'library.isbn_taken',
      status: 409,
      data: {
        kind: 'conflict',
        code: 'library.isbn_taken',
        retryable: false,
        details: { isbn: '978-0-441-17271-9' },
      },
    });
    expect(body.json.data.requestId).toBe(answer.headers.get('x-request-id'));
  });

  test('an input that does not fit answers 422 core.validation with its issues', async () => {
    const answer = await post('library/findByIsbn', { isbn: 5 }, { subject: 'ada' });
    expect(answer.status).toBe(422);
    const body = (await answer.json()) as ErrorBody;
    expect(body.json.defined).toBe(false);
    expect(body.json.data).toMatchObject({ kind: 'validation' });
    expect(Array.isArray(body.json.data.issues)).toBe(true);
  });

  test('401 carries WWW-Authenticate, 429 Retry-After', async () => {
    const anonymous = await post('library/findByIsbn', { isbn: 'x' });
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get('www-authenticate')).toMatch(/^Bearer/i);
    const limited = await post('echo/limited', {});
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('7');
    expect(((await limited.json()) as ErrorBody).json.data).toMatchObject({
      kind: 'rate_limited',
      retryAfter: 7,
    });
  });

  test('GET is core.unsupported 405', async () => {
    const answer = await runtime.fetch(
      new Request(`https://${runtime.domains.acme}/orpc/echo/limited`, { method: 'GET' }),
    );
    expect(answer.status).toBe(405);
    expect(((await answer.json()) as ErrorBody).json).toMatchObject({
      code: 'core.unsupported',
      data: { kind: 'unsupported', code: 'core.unsupported' },
    });
  });

  test('a malformed body is core.malformed_request 400', async () => {
    const answer = await post('echo/limited', undefined, {}, { body: 'this is not json' });
    expect(answer.status).toBe(400);
    expect(((await answer.json()) as ErrorBody).json).toMatchObject({
      code: 'core.malformed_request',
    });
  });

  test('an unknown path is core.not_found 404', async () => {
    const answer = await post('nobody/knowsThis', {});
    expect(answer.status).toBe(404);
    expect(((await answer.json()) as ErrorBody).json).toMatchObject({
      code: 'core.not_found',
      data: { kind: 'not_found' },
    });
  });

  test('an internal error is logged once and keeps its cause out of the answer', async () => {
    const before = lines.filter((line) => line.message === 'The oRPC request failed.').length;
    const answer = await post('echo/broken', {});
    expect(answer.status).toBe(500);
    const text = await answer.text();
    expect(text).not.toContain('secret detail');
    expect((JSON.parse(text) as ErrorBody).json).toMatchObject({
      defined: false,
      code: 'core.internal',
      status: 500,
    });
    const logged = lines.filter((line) => line.message === 'The oRPC request failed.');
    expect(logged).toHaveLength(before + 1);
  });
});

const mirrorInput = {
  at: '2026-11-12T10:00:00.000Z',
  on: '2026-11-12',
  big: '9007199254740993',
  bytes: 'AQID',
  tags: ['a'],
  label: 'plain',
};

/** The body of an answer as the wire error it holds: under `json` for the RPC handler, as it is for the OpenAPI one. */
type ErrorAnswer = ErrorBody['json'];

async function errorAnswerOf(answer: Response): Promise<ErrorAnswer> {
  const body = (await answer.json()) as ErrorBody | ErrorAnswer;
  return 'json' in body ? body.json : body;
}

describe('an error that is no taxonomy error', () => {
  const handlers = [
    { name: 'rpc', on: runtime, prefix: '/orpc' },
    { name: 'openapi', on: openapi, prefix: '/orpc-openapi' },
  ] as const;

  test.each(handlers)(
    'a body that is no JSON is 400 core.malformed_request on $name',
    async ({ on, prefix }) => {
      const answer = await post('echo/limited', undefined, {}, { body: 'not json {', on, prefix });
      expect(answer.status).toBe(400);
      const { data } = await errorAnswerOf(answer);
      expect(data).toMatchObject({ kind: 'validation', code: 'core.malformed_request' });
      expect(data.requestId).toBe(answer.headers.get('x-request-id'));
    },
  );

  test('serialised data that does not fit its type is 400 core.malformed_request', async () => {
    const answer = await post(
      'echo/mirror',
      undefined,
      {},
      {
        body: JSON.stringify({
          json: { ...mirrorInput, label: 'not a list' },
          meta: [[7, 'label']],
        }),
      },
    );
    expect(answer.status).toBe(400);
    const { data } = await errorAnswerOf(answer);
    expect(data).toMatchObject({ kind: 'validation', code: 'core.malformed_request' });
    expect(data.requestId).toBe(answer.headers.get('x-request-id'));
  });

  test.each(handlers)(
    'an output whose encoding raises a TypeError after the procedure ran is 500 core.internal on $name',
    async ({ on, prefix }) => {
      const before = lines.filter((line) => line.message === 'The oRPC request failed.').length;
      const answer = await post('echo/unencodable', {}, {}, { on, prefix });
      expect(answer.status).toBe(500);
      const text = await answer.clone().text();
      expect(text).not.toContain('output encoding failed');
      const failure = await errorAnswerOf(answer);
      expect(failure).toMatchObject({ defined: false, code: 'core.internal', status: 500 });
      expect(failure.data).toMatchObject({ kind: 'internal', code: 'core.internal' });
      const logged = lines.filter((line) => line.message === 'The oRPC request failed.');
      expect(logged).toHaveLength(before + 1);
      expect(String(logged.at(-1)?.fields.cause)).toContain('output encoding failed');
    },
  );
});

describe('orpcErrorOf', () => {
  test('an internal error answers the public message and is logged once with its cause', () => {
    const log: LoggedLine[] = [];
    const cause = new Error('secret detail of the failure');
    const answer: OrpcAnswer = {};
    const error = orpcErrorOf(errors.internal('The request failed.', { cause }), {
      session: { principal: { kind: 'user' } } as never,
      development: false,
      requestId: '0192a000-0000-7000-8000-000000000002',
      log: recordingLogger(log),
      surface: {} as never,
      wire: 'orpc',
      answer,
    });
    expect(error.status).toBe(500);
    expect(error.message).toBe('Internal server error.');
    expect(JSON.stringify(error.data)).not.toContain('secret detail');
    expect(error.data).toMatchObject({
      kind: 'internal',
      code: 'core.internal',
      requestId: '0192a000-0000-7000-8000-000000000002',
    });
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ level: 'error', message: 'The oRPC request failed.' });
    expect(log[0]?.fields.cause).toBe(cause);
    expect(answer.failure?.code).toBe('core.internal');
  });
});
