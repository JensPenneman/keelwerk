import { describe, expect, test } from 'vitest';
import { checkTrpcSurface } from '../src/check/check-trpc-surface.ts';
import {
  findTrpcAction,
  mountedTrpc,
  trpcConformanceSurface,
  trpcSurfaceWith,
} from './support/trpc-kit.ts';

const respond = () => ({ ok: true as const, value: undefined });

describe('the tRPC surface check', () => {
  test('the conformance surface checks clean at both versions', () => {
    expect(checkTrpcSurface(trpcConformanceSurface('2026-11-04'))).toEqual([]);
    expect(checkTrpcSurface(trpcConformanceSurface('2026-11-11'))).toEqual([]);
  });

  test('a custom input that is not a shape is refused at check and at mount (S-153)', async () => {
    const surface = trpcSurfaceWith(
      trpcConformanceSurface(),
      { input: { kind: 'string', optional: false, access: 'read-write' } },
      'loans.lend',
    );
    expect(checkTrpcSurface(surface)).toMatchObject([
      { code: 'unsupportedShape', transport: 'trpc', subject: 'loans.lend' },
    ]);
    expect(checkTrpcSurface(surface)[0]?.message).toContain('hints.trpc.expose: false');
    await expect(mountedTrpc(surface, respond)).rejects.toThrow(
      /^unsupportedShape: loans\.lend: .*\(API version 2026-11-11\)$/,
    );
  });

  test('a hidden action has no procedure and no problem', async () => {
    const surface = trpcSurfaceWith(
      trpcConformanceSurface(),
      {
        input: { kind: 'string', optional: false, access: 'read-write' },
        hints: { trpc: { expose: false } },
      },
      'loans.lend',
    );
    expect(checkTrpcSurface(surface)).toEqual([]);
    const mounted = await mountedTrpc(surface, respond);
    const answer = await mounted.handler(
      new Request('https://portal.example/trpc/loans.lend', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
      {
        session: (await import('./support/trpc-kit.ts')).trpcSession(),
        carrier: { transport: 'http' },
        requestId: 'r1',
        signal: new AbortController().signal,
        path: '/loans.lend',
        basePath: '/trpc',
      },
    );
    expect(answer.status).toBe(404);
    expect(mounted.calls).toEqual([]);
  });

  test('a tRPC path hint is refused', () => {
    const surface = trpcSurfaceWith(
      trpcConformanceSurface(),
      { hints: { trpc: { path: 'lending.lend' } } },
      'loans.lend',
    );
    const [problem] = checkTrpcSurface(surface);
    expect(problem).toMatchObject({ code: 'unsupportedShape', subject: 'loans.lend' });
    expect(problem?.message).toContain('hints.trpc.path');
  });

  test('a reserved word in a path is refused', () => {
    const surface = trpcConformanceSurface();
    const lend = findTrpcAction(surface, 'loans.lend');
    const reserved = { ...lend, ref: 'loans.call', name: 'call' };
    const problems = checkTrpcSurface({ ...surface, actions: [...surface.actions, reserved] });
    expect(problems).toMatchObject([{ code: 'reservedName', subject: 'loans.call' }]);
    expect(problems[0]?.message).toContain("'call'");
  });

  test("a subscription input member named 'lastEventId' is refused, a query's is not", () => {
    const surface = trpcConformanceSurface();
    const field = { kind: 'string', optional: false, access: 'read-write' };
    const input = {
      kind: 'shape',
      optional: false,
      access: 'read-write',
      fields: { lastEventId: field },
    };
    const feed = trpcSurfaceWith(surface, { input }, 'loans.loanEvents');
    const problems = checkTrpcSurface(feed);
    expect(problems).toMatchObject([{ code: 'reservedName', subject: 'loans.loanEvents' }]);
    expect(problems[0]?.message).toContain('lastEventId');
    expect(checkTrpcSurface(trpcSurfaceWith(surface, { input }, 'loans.about'))).toEqual([]);
  });

  test("a foreign subscription input with a member named 'lastEventId' is refused", () => {
    const surface = trpcConformanceSurface();
    const foreign = (input: Record<string, unknown>) => ({
      kind: 'foreign',
      optional: false,
      access: 'read-write',
      input,
      output: { type: 'object' },
    });
    const named = foreign({ type: 'object', properties: { lastEventId: { type: 'string' } } });
    const problems = checkTrpcSurface(
      trpcSurfaceWith(surface, { input: named }, 'loans.loanEvents'),
    );
    expect(problems).toMatchObject([{ code: 'reservedName', subject: 'loans.loanEvents' }]);
    expect(checkTrpcSurface(trpcSurfaceWith(surface, { input: named }, 'loans.about'))).toEqual([]);
    const plain = foreign({ type: 'object', properties: { from: { type: 'string' } } });
    expect(
      checkTrpcSurface(trpcSurfaceWith(surface, { input: plain }, 'loans.loanEvents')),
    ).toEqual([]);
  });

  test('a resumable subscription needs an object input when the input is foreign', () => {
    const surface = trpcConformanceSurface();
    const scalar = {
      kind: 'foreign',
      optional: false,
      access: 'read-write',
      input: { type: 'string' },
      output: { type: 'object' },
    };
    const resumable = trpcSurfaceWith(
      surface,
      { input: scalar, resumable: true },
      'loans.loanEvents',
    );
    const problems = checkTrpcSurface(resumable);
    expect(problems).toMatchObject([{ code: 'unsupportedShape', subject: 'loans.loanEvents' }]);
    expect(problems[0]?.message).toContain('hints.trpc.expose: false');
    const plain = trpcSurfaceWith(surface, { input: scalar, resumable: false }, 'loans.loanEvents');
    expect(checkTrpcSurface(plain)).toEqual([]);
  });

  describe('the cookie hint of 16.4.10', () => {
    const hint = (cookie: Record<string, unknown>) => ({ hints: { http: { cookie } } });
    const withHint = (cookie: Record<string, unknown>, ref = 'loans.lend') =>
      trpcSurfaceWith(trpcConformanceSurface(), hint(cookie), ref);

    test('a set name without the __Host- prefix is refused at check and at mount', async () => {
      const surface = withHint({ set: { name: 'session', from: 'token' } });
      const problems = checkTrpcSurface(surface);
      expect(problems).toMatchObject([
        { code: 'cookieName', transport: 'trpc', subject: 'loans.lend' },
      ]);
      expect(problems[0]?.message).toContain("'session'");
      await expect(mountedTrpc(surface, respond)).rejects.toThrow(
        /^cookieName: loans\.lend: .*\(API version 2026-11-11\)$/,
      );
    });

    test('a clear name without the __Host- prefix is refused at check and at mount', async () => {
      const surface = withHint({
        set: { name: '__Host-session', from: 'token' },
        clear: { name: 'session' },
      });
      expect(checkTrpcSurface(surface)).toMatchObject([
        { code: 'cookieName', subject: 'loans.lend' },
      ]);
      await expect(mountedTrpc(surface, respond)).rejects.toThrow(/^cookieName: loans\.lend: /);
    });

    test('names with the __Host- prefix are accepted', () => {
      const surface = withHint({
        set: { name: '__Host-session', from: 'token' },
        clear: { name: '__Host-session' },
      });
      expect(checkTrpcSurface(surface)).toEqual([]);
    });

    test('a hidden action is not checked', async () => {
      const surface = trpcSurfaceWith(
        trpcConformanceSurface(),
        { hints: { trpc: { expose: false }, ...hint({ clear: { name: 'session' } }).hints } },
        'loans.lend',
      );
      expect(checkTrpcSurface(surface)).toEqual([]);
      await expect(mountedTrpc(surface, respond)).resolves.toBeDefined();
    });

    test('mount refuses the first problem', async () => {
      const surface = withHint({ set: { name: 'b', from: 'token' }, clear: { name: 'a' } });
      expect(checkTrpcSurface(surface).map((problem) => problem.message)).toEqual([
        expect.stringContaining("'a'"),
        expect.stringContaining("'b'"),
      ]);
      await expect(mountedTrpc(surface, respond)).rejects.toThrow(/'a'/);
    });
  });

  test('an action and an entity of one name collide', () => {
    const surface = trpcConformanceSurface();
    const lend = findTrpcAction(surface, 'loans.lend');
    // `library.book` as an action name of the module is also the router of the entity's actions.
    const clash = {
      ...lend,
      ref: 'library.book',
      module: 'library',
      name: 'book',
      mount: 'module' as const,
    };
    const problems = checkTrpcSurface({ ...surface, actions: [...surface.actions, clash] });
    expect(problems.map((problem) => problem.code)).toContain('nameCollision');
    const message = problems.find((problem) => problem.code === 'nameCollision')?.message ?? '';
    expect(message).toContain('library.book');
    expect(message).toMatch(/start of the path library\.book\.\w+/);
    const twin = { ...lend, ref: 'loans.lendAgain', name: 'lend' };
    const same = checkTrpcSurface({ ...surface, actions: [...surface.actions, twin] });
    expect(same.map((problem) => problem.code)).toEqual(['nameCollision']);
    expect(same[0]?.message).toContain('loans.lend and loans.lendAgain');
  });
});
