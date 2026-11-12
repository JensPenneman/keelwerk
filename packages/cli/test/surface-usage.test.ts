import { describe, expect, test } from 'vitest';
import { createFakeHost } from './support/fake-host.ts';
import { json, portalServer } from './support/portal-server.ts';
import { remoteProfileFiles } from './support/profile-files.ts';
import { runCliWith } from './support/run-cli-with.ts';

function setup(answer: unknown) {
  const bodies: Record<string, unknown>[] = [];
  const fake = createFakeHost({
    files: remoteProfileFiles,
    handler: portalServer({
      invoke: (body) => {
        bodies.push(body);
        return json({ ok: true, value: answer });
      },
    }),
  });
  return { fake, bodies };
}

describe('surface usage and surface retire (18.5)', () => {
  test('surface usage sends core.apiUsage with its flags and prints the totals', async () => {
    const totals = [{ backendId: 'b', apiVersion: '2026-11-04', item: '', count: 3 }];
    const { fake, bodies } = setup({ items: totals, truncated: true });
    const run = await runCliWith(
      [
        'surface',
        'usage',
        '--since',
        '2026-11-01',
        '--until',
        '2026-11-12',
        '--backend',
        'b',
        '--api-version',
        '2026-11-04',
        '--output',
        'json',
      ],
      fake.host,
    );
    expect(run.code).toBe(0);
    expect(bodies[0]).toMatchObject({
      action: 'core.apiUsage',
      input: { since: '2026-11-01', until: '2026-11-12', backendId: 'b', apiVersion: '2026-11-04' },
    });
    expect(JSON.parse(run.stdout)).toEqual(totals);
    expect(run.stderr).toContain('the list is cut at 1000 rows');
  });

  test('surface retire sends core.retireApiVersion with app and version', async () => {
    const answer = {
      app: 'portal',
      version: '2026-11-04',
      floor: '2026-11-11',
      tenants: 2,
      backends: 0,
    };
    const { fake, bodies } = setup(answer);
    const run = await runCliWith(
      ['surface', 'retire', '2026-11-04', '--app', 'portal', '--output', 'json'],
      fake.host,
    );
    expect(run.code).toBe(0);
    expect(bodies[0]).toMatchObject({
      action: 'core.retireApiVersion',
      input: { app: 'portal', version: '2026-11-04' },
    });
    expect(JSON.parse(run.stdout)).toEqual(answer);
  });

  test('surface retire without --app exits 2', async () => {
    const { fake, bodies } = setup({});
    const run = await runCliWith(['surface', 'retire', '2026-11-04'], fake.host);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('--app');
    expect(bodies).toEqual([]);
  });
});
