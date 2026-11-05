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

const issued = {
  id: 'otk_01',
  token: 'kwo_aaaaaaaaaaaaaaaaaaaaaaaaaa_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  expiresAt: '2026-11-05T22:00:00Z',
};

describe('operator token', () => {
  test('issue asks core.operatorToken.issue with the label and lifetime and prints the token once', async () => {
    const { fake, bodies } = setup(issued);
    const run = await runCliWith(
      ['operator', 'token', 'issue', '--label', 'laptop', '--ttl', '2h', '--output', 'json'],
      fake.host,
    );
    expect(run.code).toBe(0);
    expect(bodies[0]).toMatchObject({
      action: 'core.operatorToken.issue',
      input: { label: 'laptop', ttl: '2h' },
    });
    expect(JSON.parse(run.stdout)).toEqual(issued);
  });

  test('issue without flags labels the token "cli" and leaves the lifetime to the deployment', async () => {
    const { fake, bodies } = setup(issued);
    const run = await runCliWith(['operator', 'token', 'issue', '--output', 'json'], fake.host);
    expect(run.code).toBe(0);
    expect(bodies[0]).toMatchObject({ input: { label: 'cli' } });
    expect(bodies[0]?.input).not.toHaveProperty('ttl');
  });

  test('revoke names the token id', async () => {
    const { fake, bodies } = setup({
      id: 'otk_01',
      label: 'laptop',
      revokedAt: '2026-11-05T11:00:00Z',
      verifier: 'must-not-print',
    });
    const run = await runCliWith(
      ['operator', 'token', 'revoke', 'otk_01', '--output', 'json'],
      fake.host,
    );
    expect(run.code).toBe(0);
    expect(bodies[0]).toMatchObject({
      action: 'core.operatorToken.revoke',
      input: { id: 'otk_01' },
    });
    expect(JSON.parse(run.stdout)).toEqual({
      id: 'otk_01',
      label: 'laptop',
      revokedAt: '2026-11-05T11:00:00Z',
    });
  });

  test('list prints id, label, expiry and revocation, and never a secret', async () => {
    const { fake, bodies } = setup({
      items: [
        { id: 'otk_01', label: 'laptop', expiresAt: '2026-11-05T22:00:00Z', publicId: 'p1' },
        {
          id: 'otk_02',
          label: 'ci',
          expiresAt: '2026-11-05T12:00:00Z',
          revokedAt: '2026-11-05T11:00:00Z',
        },
      ],
    });
    const run = await runCliWith(['operator', 'token', 'list', '--output', 'json'], fake.host);
    expect(run.code).toBe(0);
    expect(bodies[0]).toMatchObject({ action: 'core.operatorToken.query' });
    expect(JSON.parse(run.stdout)).toEqual([
      { id: 'otk_01', label: 'laptop', expiresAt: '2026-11-05T22:00:00Z', revokedAt: '' },
      {
        id: 'otk_02',
        label: 'ci',
        expiresAt: '2026-11-05T12:00:00Z',
        revokedAt: '2026-11-05T11:00:00Z',
      },
    ]);
  });

  test('list follows pageInfo until the last page', async () => {
    const bodies: Record<string, unknown>[] = [];
    const fake = createFakeHost({
      files: remoteProfileFiles,
      handler: portalServer({
        invoke: (body) => {
          bodies.push(body);
          const input = body.input as { after?: string };
          return json({
            ok: true,
            value:
              input.after === undefined
                ? {
                    items: [{ id: 'otk_01', label: 'a', expiresAt: 'x' }],
                    pageInfo: { hasNextPage: true, endCursor: 'c1' },
                  }
                : {
                    items: [{ id: 'otk_02', label: 'b', expiresAt: 'y' }],
                    pageInfo: { hasNextPage: false, endCursor: 'c2' },
                  },
          });
        },
      }),
    });
    const run = await runCliWith(['operator', 'token', 'list', '--output', 'json'], fake.host);
    expect(run.code).toBe(0);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toMatchObject({ input: { after: 'c1' } });
    expect((JSON.parse(run.stdout) as { id: string }[]).map((row) => row.id)).toEqual([
      'otk_01',
      'otk_02',
    ]);
  });

  test('a refusal ends the command with the exit code of its kind', async () => {
    const fake = createFakeHost({
      files: remoteProfileFiles,
      handler: portalServer({
        invoke: () =>
          json({ ok: false, error: { kind: 'forbidden', code: 'core.forbidden', message: 'no' } }),
      }),
    });
    const run = await runCliWith(['operator', 'token', 'list'], fake.host);
    expect(run.code).not.toBe(0);
  });
});
