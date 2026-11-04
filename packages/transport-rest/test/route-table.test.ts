import { describe, expect, test } from 'vitest';
import { buildRouteTable } from '../src/build-route-table.ts';
import { createRestAdapter } from '../src/create-rest-adapter.ts';
import { portalSurface, withAction } from './support/portal-surface.ts';

function listing(surface = portalSurface(), options = {}): string[] {
  return buildRouteTable(surface, options).routes.map(
    (route) => `${route.method} ${route.path} ${route.action.ref}`,
  );
}

describe('the route table of 16.5.1', () => {
  test('every action of the fixture surface has its route', () => {
    expect(listing()).toEqual(
      expect.arrayContaining([
        'GET /accounts/profiles accounts.profile.query',
        'POST /accounts/profiles/query accounts.profile.query',
        'GET /accounts/profiles/:id accounts.profile.get',
        'POST /accounts/profiles/get accounts.profile.get',
        'POST /accounts/profiles accounts.profile.create',
        'PATCH /accounts/profiles/:id accounts.profile.update',
        'DELETE /accounts/profiles/:id accounts.profile.archive',
        'POST /accounts/profiles/:id/restore accounts.profile.restore',
        'POST /accounts/profiles/set accounts.profile.set',
        'GET /accounts/profiles/changes accounts.profile.changes',
        'POST /accounts/profiles/query-changes accounts.profile.queryChanges',
        'GET /accounts/profiles/watch accounts.profile.watch',
        'GET /accounts/profiles/:id/history accounts.profile.history',
        'POST /accounts/profiles/:id/deactivate accounts.profile.deactivate',
        'POST /accounts/register accounts.register',
        'GET /app/health app.health',
        'POST /auth/login auth.login',
        'GET /auth/session-events auth.sessionEvents',
      ]),
    );
  });

  test('static segments are registered before parameterised ones', () => {
    const paths = buildRouteTable(portalSurface()).routes.map((route) => route.path);
    const firstDynamic = paths.findIndex((path) => path.includes(':'));
    expect(paths.slice(firstDynamic).some((path) => !path.includes(':'))).toBe(false);
    const table = buildRouteTable(portalSurface());
    expect(table.match('GET', '/accounts/profiles/changes', false)?.route.action.ref).toBe(
      'accounts.profile.changes',
    );
    expect(table.match('GET', '/accounts/profiles/prof_x', false)?.params).toEqual({
      id: 'prof_x',
    });
  });

  test('hints rename, hide and move routes', () => {
    const hinted = withAction(portalSurface(), 'accounts.register', {
      hints: { rest: { path: 'sign-up' } },
    });
    expect(listing(hinted)).toContain('POST /accounts/sign-up accounts.register');
    const absolute = withAction(portalSurface(), 'app.health', {
      hints: { rest: { path: '/.well-known/health' } },
    });
    const table = buildRouteTable(absolute);
    expect(table.absolutePaths).toEqual(['/.well-known/health']);
    expect(table.match('GET', '/.well-known/health', true)?.route.action.ref).toBe('app.health');
    const hidden = withAction(portalSurface(), 'app.health', {
      hints: { rest: { expose: false } },
    });
    expect(listing(hidden).some((line) => line.endsWith('app.health'))).toBe(false);
  });

  test('a query that is not query-string representable is a POST, and QUERY under 3.2', () => {
    const nested = withAction(portalSurface(), 'app.health', {
      input: {
        kind: 'shape',
        optional: false,
        access: 'read-write',
        fields: {
          where: { kind: 'shape', optional: false, access: 'read-write', fields: {} },
        },
      },
    });
    expect(listing(nested)).toContain('POST /app/health app.health');
    expect(listing(nested, { openapi: '3.2' })).toContain('QUERY /app/health app.health');
  });

  test('a module action named like a collection is a routeConflict', () => {
    const clash = withAction(portalSurface(), 'accounts.register', {
      name: 'profiles',
      ref: 'accounts.profiles',
    });
    expect(
      createRestAdapter()
        .check(clash)
        .map((problem) => problem.code),
    ).toEqual(['routeConflict']);
  });

  test('a custom entity action with a generated name is a reservedName', () => {
    const reserved = withAction(portalSurface(), 'accounts.profile.deactivate', {
      name: 'restore',
    });
    const problems = createRestAdapter().check(reserved);
    expect(problems).toEqual([
      expect.objectContaining({ code: 'reservedName', subject: 'accounts.profile.deactivate' }),
    ]);
  });

  test('a relative rest.path hint clears a collection conflict', () => {
    const hinted = withAction(portalSurface(), 'accounts.register', {
      name: 'profiles',
      ref: 'accounts.profiles',
      hints: { rest: { path: 'profile-list' } },
    });
    expect(createRestAdapter().check(hinted)).toEqual([]);
  });

  test('a relative rest.path hint clears a reservedName', () => {
    const hinted = withAction(portalSurface(), 'accounts.profile.deactivate', {
      name: 'history',
      hints: { rest: { path: 'timeline' } },
    });
    expect(createRestAdapter().check(hinted)).toEqual([]);
  });

  test('a rest.path hint that is itself reserved is still a reservedName', () => {
    const hinted = withAction(portalSurface(), 'accounts.profile.deactivate', {
      hints: { rest: { path: 'restore' } },
    });
    expect(createRestAdapter().check(hinted)).toEqual([
      expect.objectContaining({ code: 'reservedName' }),
    ]);
  });

  test('the fixture surface has no problems', () => {
    expect(createRestAdapter().check(portalSurface())).toEqual([]);
  });
});
