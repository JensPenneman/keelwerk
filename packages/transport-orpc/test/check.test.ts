import {
  type ApiSurface,
  deriveSurface,
  type MountContext,
  type SurfaceAction,
} from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { checkOrpcSurface } from '../src/check/check-orpc-surface.ts';
import { orpcVersionMounts } from '../src/mount/orpc-version-mounts.ts';
import type { OrpcConfig } from '../src/orpc-config.ts';
import { orpcConformanceApp, orpcConformanceVersions } from './support/orpc-conformance-app.ts';

const surface: ApiSurface = deriveSurface(
  orpcConformanceApp as never,
  orpcConformanceVersions.head,
).surface;

function actionNamed(ref: string): SurfaceAction {
  const action = surface.actions.find((candidate) => candidate.ref === ref);
  if (action === undefined) throw new Error(`The surface has no ${ref}.`);
  return action;
}

function withActions(...more: readonly SurfaceAction[]): ApiSurface {
  return { ...surface, actions: [...surface.actions, ...more] };
}

describe('checkOrpcSurface', () => {
  test('the conformance surface has no problem', () => {
    expect(checkOrpcSurface(surface)).toEqual([]);
  });

  test('a non-shape custom input is unsupportedShape at check and fails the mount', () => {
    const lend = actionNamed('loans.lend');
    const refused: ApiSurface = {
      ...surface,
      actions: surface.actions.map((action) =>
        action === lend ? { ...action, input: { kind: 'string' } as never } : action,
      ),
    };
    expect(checkOrpcSurface(refused)).toEqual([
      expect.objectContaining({
        code: 'unsupportedShape',
        transport: 'orpc',
        subject: 'loans.lend',
      }),
    ]);
    const mount = (): unknown =>
      orpcVersionMounts({ surface: refused } as unknown as MountContext<OrpcConfig>, {});
    expect(mount).toThrow(TypeError);
    expect(mount).toThrow(/^unsupportedShape: loans\.lend: .* \(API version 2026-11-11\)$/);
  });

  test('an entity action of an entity the surface lacks and an unlisted error are named', () => {
    const lend = actionNamed('loans.lend');
    const problems = checkOrpcSurface(
      withActions(
        {
          ...lend,
          ref: 'loans.ghost.haunt',
          name: 'haunt',
          entity: 'loans.ghost',
          mount: 'entity',
        },
        { ...lend, ref: 'loans.unlisted', name: 'unlisted', errors: ['loans.not_listed'] },
      ),
    );
    expect(problems.map((problem) => [problem.code, problem.subject])).toEqual([
      ['unsupportedShape', 'loans.ghost.haunt'],
      ['unknownError', 'loans.unlisted'],
    ]);
  });

  test('two module ids with one camel form collide', () => {
    const lend = actionNamed('loans.lend');
    const problems = checkOrpcSurface(
      withActions(
        { ...lend, ref: 'api-keys.make', module: 'api-keys', name: 'make' },
        { ...lend, ref: 'apiKeys.make', module: 'apiKeys', name: 'make' },
      ),
    );
    expect(problems).toEqual([
      expect.objectContaining({ code: 'nameCollision', subject: 'apiKeys' }),
    ]);
  });

  test('a subscription event with a member named control is no problem', () => {
    const watch = actionNamed('loans.loanEvents');
    const event = { kind: 'string', optional: false, access: 'read-write' } as never;
    const problems = checkOrpcSurface(
      withActions({
        ...watch,
        ref: 'loans.forged',
        name: 'forged',
        output: { kind: 'shape', fields: { control: event } } as never,
      }),
    );
    expect(problems).toEqual([]);
  });

  test('a cookie hint without the __Host- prefix is cookieName, as in REST', () => {
    const lend = actionNamed('loans.lend');
    const problems = checkOrpcSurface(
      withActions(
        {
          ...lend,
          ref: 'loans.login',
          name: 'login',
          hints: { http: { cookie: { set: { name: 'session', from: 'token' } } } },
        },
        {
          ...lend,
          ref: 'loans.logout',
          name: 'logout',
          hints: { http: { cookie: { clear: { name: 'session' } } } },
        },
        {
          ...lend,
          ref: 'loans.safe',
          name: 'safe',
          hints: { http: { cookie: { set: { name: '__Host-session', from: 'token' } } } },
        },
      ),
    );
    expect(problems.map((problem) => [problem.code, problem.subject])).toEqual([
      ['cookieName', 'loans.login'],
      ['cookieName', 'loans.logout'],
    ]);
    expect(problems[0]?.message).toBe(
      "The cookie 'session' must carry the '__Host-' prefix (section 16.4.10).",
    );
  });

  test('an action named like an entity of its module collides', () => {
    const lend = actionNamed('loans.lend');
    const problems = checkOrpcSurface(withActions({ ...lend, ref: 'loans.loan', name: 'loan' }));
    expect(problems).toEqual([
      expect.objectContaining({ code: 'nameCollision', subject: 'loans.loan' }),
    ]);
  });
});
