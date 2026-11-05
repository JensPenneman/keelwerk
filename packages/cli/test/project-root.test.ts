import { describe, expect, test } from 'vitest';
import { projectRootOf } from '../src/context/project-root-of.ts';
import { createFakeHost } from './support/fake-host.ts';
import { runCliWith } from './support/run-cli-with.ts';

const workspace = '/work/keelwerk';
const portal = `${workspace}/examples/portal`;
const files = {
  [`${workspace}/pnpm-workspace.yaml`]: 'packages:\n  - examples/*\n',
  [`${portal}/.launchway/deployment.ts`]: 'export default {};\n',
};

describe('one project root (S-115)', () => {
  test('the root of a deployment file is the project, not the .launchway directory', () => {
    expect(projectRootOf(`${portal}/.launchway/deployment.ts`)).toBe(portal);
    expect(projectRootOf(`${portal}/keelwerk.config.ts`)).toBe(portal);
  });

  test('dev run from examples/portal keeps its state there, not at the workspace root', async () => {
    const fake = createFakeHost({
      cwd: portal,
      files,
      spawn: () => {
        throw new Error('no processes in this test');
      },
    });
    await runCliWith(['dev', '--no-types'], fake.host);
    const written = [...fake.files.keys()].filter((path) => path.includes('/.keelwerk/'));
    expect(written.length).toBeGreaterThan(0);
    for (const path of written) expect(path.startsWith(`${portal}/.keelwerk/`)).toBe(true);
  });

  test('call from examples/portal finds the dev socket in the same directory', async () => {
    const socket = `${portal}/.keelwerk/dev.sock`;
    const fake = createFakeHost({
      cwd: portal,
      files: { ...files, [socket]: '' },
      handler: () =>
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    });
    // The canned answers carry no surface; the first request is the socket probe, which is all this test reads.
    await runCliWith(['call', 'auth.whoami', '--output', 'json'], fake.host).catch(() => undefined);
    expect(fake.sent.length).toBeGreaterThan(0);
    expect(fake.sent[0]?.socketPath).toBe(socket);
  });
});
