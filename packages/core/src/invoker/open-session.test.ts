import { describe, expect, test } from 'vitest';
import {
  actionOf,
  carrier,
  failureOf,
  invokerOf,
  registryOf,
  sessionOf,
  signedIn,
} from '../../test/invoker/invoker-kit.ts';

const registry = registryOf([actionOf('doc.open', { auth: 'public' })]);
const invoker = invokerOf(registry);
const withHeaders = (headers: Record<string, string>) => ({
  transport: 'test',
  headers: { 'x-tenant': 't1', ...headers },
});

describe('open', () => {
  test('a valid bearer token is a user session in the resolved tenant', async () => {
    const session = sessionOf(await invoker.open(signedIn));
    expect(session.scope).toEqual({ level: 'tenant', backendId: 'b1', tenantId: 't1' });
    expect(session.app).toBe('doc');
    expect(session.principal).toMatchObject({ kind: 'user', subject: 'ada' });
    expect(session.apiVersion).toBe('2026-11-01');
    expect(session.resolvedBy).toBe('header');
  });

  test('an invalid bearer token fails with unauthenticated, also when no resolver knows it', async () => {
    expect(failureOf(await invoker.open(withHeaders({ authorization: 'Bearer bad' }))).kind).toBe(
      'unauthenticated',
    );
    expect(
      failureOf(await invoker.open(withHeaders({ authorization: 'Bearer stranger' }))).kind,
    ).toBe('unauthenticated');
    expect(failureOf(await invoker.open({ ...carrier, token: 'stranger' })).kind).toBe(
      'unauthenticated',
    );
  });

  test('an unknown cookie session is anonymous and the session carries the cookie to clear', async () => {
    const session = sessionOf(await invoker.open(withHeaders({ cookie: 'sid=stale' })));
    expect(session.principal.kind).toBe('anonymous');
    expect(session.clearCookies).toEqual(['sid']);
  });

  test('no credentials give the anonymous principal and no cookies to clear', async () => {
    const session = sessionOf(await invoker.open(carrier));
    expect(session.principal.kind).toBe('anonymous');
    expect(session.clearCookies).toBeUndefined();
  });

  test('resolvers run in deployment order and a host name loses its port and case', async () => {
    const host = { transport: 'test', host: 'DOC.example:8080' };
    expect(sessionOf(await invoker.open(host)).resolvedBy).toBe('hostname');
    const hostFirst = invokerOf(registry, {
      tenantResolution: [{ kind: 'hostname' }, { kind: 'header', header: 'x-tenant' }],
    });
    const both = { ...host, headers: { 'x-tenant': 't-off' } };
    expect(sessionOf(await hostFirst.open(both)).resolvedBy).toBe('hostname');
    expect(failureOf(await invoker.open(both)).kind).toBe('unavailable');
  });

  test('a suspended tenant is unavailable and an unknown one not_found', async () => {
    expect(failureOf(await invoker.open(withHeaders({ 'x-tenant': 't-off' }))).kind).toBe(
      'unavailable',
    );
    expect(failureOf(await invoker.open(withHeaders({ 'x-tenant': 'gone' }))).kind).toBe(
      'not_found',
    );
    expect(failureOf(await invoker.open({ transport: 'test' })).kind).toBe('not_found');
  });

  test('a local carrier is the operator at deployment level, the socket and the process alike', async () => {
    const socket = sessionOf(
      await invoker.open({ transport: 'cli', local: { socket: '/run/k.sock' } }),
    );
    expect(socket.scope).toEqual({ level: 'deployment' });
    expect(socket.principal).toMatchObject({ kind: 'operator', id: 'local.socket' });
    const process = sessionOf(await invoker.open({ transport: 'cli', local: { inProcess: true } }));
    expect(process.principal).toMatchObject({ kind: 'operator', id: 'local.in-process' });
    expect(process.resolvedBy).toBe('local');
  });

  test('a resolver that throws is an internal error, redacted outside development', async () => {
    const boom = withHeaders({ authorization: 'Bearer boom' });
    const production = failureOf(
      await invokerOf(registry, { environment: 'production' }).open(boom),
    );
    expect(production).toMatchObject({ kind: 'internal', code: 'core.internal' });
    expect(production.message).not.toContain('exploded');
    const development = failureOf(
      await invokerOf(registry, { environment: 'development' }).open(boom),
    );
    expect(development.message).toContain('exploded');
  });

  test('a cancelled request does not open a session', async () => {
    const controller = new AbortController();
    controller.abort();
    expect(failureOf(await invoker.open(carrier, { signal: controller.signal })).kind).toBe(
      'unavailable',
    );
  });

  test('revalidate resolves the principal again into a new session', async () => {
    const first = sessionOf(await invoker.open(signedIn));
    const second = sessionOf(await first.revalidate());
    expect(second).not.toBe(first);
    expect(second.principal).toMatchObject({ kind: 'user', subject: 'ada' });
  });
});
