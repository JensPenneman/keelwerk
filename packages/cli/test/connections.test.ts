import { describe, expect, test } from 'vitest';
import { createFakeHost } from './support/fake-host.ts';
import { json, portalServer } from './support/portal-server.ts';
import { portalSurface } from './support/portal-surface.ts';
import { remoteProfileFiles } from './support/profile-files.ts';
import { runCliWith } from './support/run-cli-with.ts';

describe('the project connection', () => {
  test('goes to .keelwerk/dev.sock while keelwerk dev runs', async () => {
    const fake = createFakeHost({
      cwd: '/work/project',
      files: {
        '/work/project/keelwerk.config.ts': '',
        '/work/project/.keelwerk/dev.sock': '',
      },
      handler: () => json({ ok: true, value: { items: [] } }),
    });
    const run = await runCliWith(['backend', 'list', '--output', 'json'], fake.host);
    expect(run.code).toBe(0);
    expect(fake.sent[0]?.socketPath).toBe('/work/project/.keelwerk/dev.sock');
    expect(JSON.parse(run.stdout)).toEqual([]);
  });

  test('a deployment file under .launchway has its project root one level up', async () => {
    const fake = createFakeHost({
      cwd: '/work/project',
      files: {
        '/work/project/.launchway/deployment.ts': '',
        '/work/project/.keelwerk/dev.sock': '',
      },
      handler: () => json({ ok: true, value: { items: [] } }),
    });
    const run = await runCliWith(['tenant', 'list', '--output', 'json'], fake.host);
    expect(run.code).toBe(0);
    expect(fake.sent[0]?.socketPath).toBe('/work/project/.keelwerk/dev.sock');
  });
});

describe('the remote connection', () => {
  test('refuses http:// to a host that is no loopback address before anything is sent', async () => {
    const fake = createFakeHost({
      files: {
        '/home/tester/.config/keelwerk/profiles.json': JSON.stringify({
          current: 'plain',
          profiles: { plain: { url: 'http://lvj.example' } },
        }),
      },
    });
    const run = await runCliWith(['backend', 'list'], fake.host);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('loopback');
    expect(fake.sent).toHaveLength(0);
  });

  test('accepts http:// to a loopback host', async () => {
    const fake = createFakeHost({
      files: {
        '/home/tester/.config/keelwerk/profiles.json': JSON.stringify({
          current: 'local',
          profiles: { local: { url: 'http://127.0.0.1:4000' } },
        }),
      },
      handler: () => json({ ok: true, value: { items: [] } }),
    });
    const run = await runCliWith(['backend', 'list', '--output', 'json'], fake.host);
    expect(run.code).toBe(0);
    expect(fake.sent[0]?.url).toBe('http://127.0.0.1:4000/_keelwerk/v1/invoke');
  });
});

describe('aliases the route map could not take', () => {
  test('are reported as a warning and the command still runs', async () => {
    const taken = portalSurface.actions.find((action) => action.ref === 'accounts.profile.create');
    if (taken === undefined) throw new Error('the fixture lacks accounts.profile.create');
    const clashing = {
      ...portalSurface,
      actions: portalSurface.actions.map((action) =>
        action.ref === 'auth.login'
          ? {
              ...action,
              hints: { ...action.hints, cli: { ...action.hints.cli, aliases: [taken.ref] } },
            }
          : action,
      ),
    };
    const fake = createFakeHost({
      files: remoteProfileFiles,
      handler: (sent) => (sent.url.endsWith('/surface') ? json(clashing) : portalServer()(sent)),
    });
    const run = await runCliWith(['call', 'list', '--output', 'json'], fake.host);
    expect(run.code).toBe(0);
    expect(run.stderr).toContain(`warning: the alias "${taken.ref}" of auth.login is not routed`);
  });
});
