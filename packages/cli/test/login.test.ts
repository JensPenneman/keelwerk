import { describe, expect, test } from 'vitest';
import { createFakeHost } from './support/fake-host.ts';
import { json, portalServer } from './support/portal-server.ts';
import { portalSurface } from './support/portal-surface.ts';
import { credentialsPath, profilesPath, remoteProfileFiles } from './support/profile-files.ts';
import { runCliWith } from './support/run-cli-with.ts';

const files = {
  [profilesPath]: JSON.stringify({
    current: 'lvj',
    profiles: { lvj: { url: 'https://lvj.example' } },
  }),
};

function setup(options: { secret?: string; line?: string; stdinInteractive?: boolean } = {}) {
  const bodies: { body: Record<string, unknown>; authorization: string | undefined }[] = [];
  const prompts: string[] = [];
  const fake = createFakeHost({
    files,
    secret: options.secret ?? 'correct horse',
    line: options.line ?? 'jens@example.test',
    stdinInteractive: options.stdinInteractive ?? true,
    handler: portalServer({
      invoke: (body, sent) => {
        bodies.push({ body, authorization: sent.request.headers.authorization });
        return json({ ok: true, value: { token: 'session-token-1', expiresAt: 'later' } });
      },
    }),
  });
  const host = {
    ...fake.host,
    promptLine: async (label: string) => {
      prompts.push(`line ${label}`);
      return fake.host.promptLine(label);
    },
    promptSecret: async (label: string) => {
      prompts.push(`secret ${label}`);
      return fake.host.promptSecret(label);
    },
  };
  return { fake, host, bodies, prompts };
}

describe('login', () => {
  test('finds the login action, asks for its inputs, stores the token field and prints no secret', async () => {
    const { fake, host, bodies, prompts } = setup();
    const run = await runCliWith(['login'], host);
    expect(run.code).toBe(0);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.body).toMatchObject({
      action: 'auth.login',
      input: { email: 'jens@example.test', password: 'correct horse' },
    });
    expect(prompts).toEqual(['line email: ', 'secret password']);
    expect(JSON.parse(fake.files.get(credentialsPath)?.text ?? '{}')).toEqual({
      credentials: { lvj: { token: 'session-token-1' } },
    });
    expect(fake.files.get(credentialsPath)?.mode).toBe(0o600);
    expect(run.stdout).toContain('Signed in to lvj');
    expect(run.stdout + run.stderr).not.toContain('correct horse');
    expect(run.stdout + run.stderr).not.toContain('session-token-1');
  });

  test('inputs given with --input are not asked for', async () => {
    const { host, bodies, prompts } = setup();
    const run = await runCliWith(['login', '--input', '{"email":"ada@example.test"}'], host);
    expect(run.code).toBe(0);
    expect(bodies[0]?.body).toMatchObject({ input: { email: 'ada@example.test' } });
    expect(prompts).toEqual(['secret password']);
  });

  test('a stored credential is not sent to the login that replaces it', async () => {
    const { fake, host, bodies } = setup();
    fake.files.set(credentialsPath, {
      text: JSON.stringify({ credentials: { lvj: { token: 'stale' } } }),
      mode: 0o600,
    });
    const run = await runCliWith(['login'], host);
    expect(run.code).toBe(0);
    expect(bodies[0]?.authorization).toBeUndefined();
    expect(JSON.parse(fake.files.get(credentialsPath)?.text ?? '{}').credentials.lvj.token).toBe(
      'session-token-1',
    );
  });

  test('with standard input not a terminal the secret is read from it', async () => {
    const bodies: Record<string, unknown>[] = [];
    const piped = createFakeHost({
      files,
      stdinInteractive: false,
      stdin: 'from stdin\n',
      handler: portalServer({
        invoke: (body) => {
          bodies.push(body);
          return json({ ok: true, value: { token: 't2' } });
        },
      }),
    });
    const run = await runCliWith(['login', '--input', '{"email":"jens@example.test"}'], piped.host);
    expect(run.code).toBe(0);
    expect(bodies.at(-1)).toMatchObject({
      input: { email: 'jens@example.test', password: 'from stdin' },
    });
  });

  test('with standard input not a terminal a missing e-mail is a usage error, never the password', async () => {
    const bodies: Record<string, unknown>[] = [];
    const piped = createFakeHost({
      files,
      stdinInteractive: false,
      stdin: 'from stdin\n',
      handler: portalServer({
        invoke: (body) => {
          bodies.push(body);
          return json({ ok: true, value: { token: 't2' } });
        },
      }),
    });
    // A prompt that reads the piped stream, as a terminal-less line prompt would.
    const host = { ...piped.host, promptLine: async () => (await piped.host.readStdin()).trim() };
    const run = await runCliWith(['login'], host);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('email');
    expect(run.stderr).toContain('--input');
    expect(bodies).toHaveLength(0);
    expect(piped.files.has(credentialsPath)).toBe(false);
  });

  test('--token stores a pasted token without contacting the deployment', async () => {
    const { fake, host, bodies } = setup({ secret: 'pasted-token' });
    const run = await runCliWith(['login', '--token'], host);
    expect(run.code).toBe(0);
    expect(bodies).toHaveLength(0);
    expect(fake.sent).toHaveLength(0);
    expect(JSON.parse(fake.files.get(credentialsPath)?.text ?? '{}')).toEqual({
      credentials: { lvj: { token: 'pasted-token' } },
    });
  });

  test('a refused login stores nothing and exits with the kind of the error', async () => {
    const fake = createFakeHost({
      files,
      secret: 'wrong',
      line: 'jens@example.test',
      stdinInteractive: true,
      handler: portalServer({
        invoke: () =>
          json({
            ok: false,
            error: {
              kind: 'unauthenticated',
              code: 'auth.invalid_credentials',
              message: 'Wrong e-mail or password.',
              retryable: false,
              requestId: 'r1',
            },
          }),
      }),
    });
    const run = await runCliWith(['login'], fake.host);
    expect(run.code).toBe(4);
    expect(fake.files.has(credentialsPath)).toBe(false);
  });

  test('a login action that is not offered is refused by name', async () => {
    const fake = createFakeHost({ files, handler: portalServer() });
    const run = await runCliWith(['login', '--action', 'accounts.profile.create'], fake.host);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('is not a login action');
  });

  test('a deployment that offers no login action says so', async () => {
    const bare = {
      ...portalSurface,
      actions: portalSurface.actions.map((action) => {
        const { cli: _cli, ...hints } = action.hints;
        return { ...action, hints };
      }),
    };
    const fake = createFakeHost({
      files,
      handler: (sent) => (sent.url.endsWith('/surface') ? json(bare) : portalServer()(sent)),
    });
    const run = await runCliWith(['login'], fake.host);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('offers no login action');
  });

  test('a socket profile has no credential to keep', async () => {
    const fake = createFakeHost({
      files: {
        [profilesPath]: JSON.stringify({
          current: 'local',
          profiles: { local: { url: 'unix:///run/keelwerk.sock' } },
        }),
      },
    });
    const run = await runCliWith(['login', '--token'], fake.host);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('operator socket');
    expect(fake.files.has(credentialsPath)).toBe(false);
  });

  test('in a project without a profile it refuses before loading the deployment', async () => {
    const fake = createFakeHost({
      cwd: '/work/project',
      files: { '/work/project/keelwerk.config.ts': '' },
    });
    const run = await runCliWith(['login'], fake.host);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('named profile');
    expect(fake.sent).toHaveLength(0);
  });

  test('logout removes the credential and says so when there is none', async () => {
    const fake = createFakeHost({ files: remoteProfileFiles });
    const first = await runCliWith(['logout', '--profile', 'lvj'], fake.host);
    expect(first.code).toBe(0);
    expect(first.stdout).toContain('Signed out of lvj');
    expect(JSON.parse(fake.files.get(credentialsPath)?.text ?? '{}')).toEqual({ credentials: {} });
    const again = await runCliWith(['logout', '--profile', 'lvj'], fake.host);
    expect(again.stdout).toContain('No credential stored for lvj');
  });

  test('a profile that names another credential key keeps the token there', async () => {
    const fake = createFakeHost({
      files: {
        [profilesPath]: JSON.stringify({
          current: 'lvj',
          profiles: { lvj: { url: 'https://lvj.example', credential: 'shared' } },
        }),
      },
      secret: 'tok',
      stdinInteractive: true,
    });
    const run = await runCliWith(['login', '--token'], fake.host);
    expect(run.code).toBe(0);
    expect(JSON.parse(fake.files.get(credentialsPath)?.text ?? '{}')).toEqual({
      credentials: { shared: { token: 'tok' } },
    });
  });

  test('http:// to a non-loopback host is refused before anything is sent', async () => {
    const fake = createFakeHost({
      files: {
        [profilesPath]: JSON.stringify({
          current: 'plain',
          profiles: { plain: { url: 'http://lvj.example' } },
        }),
      },
    });
    const run = await runCliWith(['login'], fake.host);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('loopback');
    expect(fake.sent).toHaveLength(0);
  });
});
