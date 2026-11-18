import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createLocalClient,
  durablePgliteFactory,
  startTestRuntime,
  testPrincipal,
} from '@keelwerk/testing';
import { libraryApp } from '@keelwerk/testing/fixtures';
import { afterEach, expect, test } from 'vitest';
import { checkEpochBumps } from '../../src/doctor/check-epoch-bumps.ts';
import { controlReaderOf } from '../../src/doctor/control-reader-of.ts';
import type { DeploymentFacts } from '../../src/doctor/deployment-facts.ts';
import type { DeploymentInput } from '../../src/doctor/deployment-input.ts';

const roots: string[] = [];
const stops: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.allSettled(stops.splice(0).map((stop) => stop()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test('doctor lists the bump of a restored placement, read through the control store of the restored deployment', {
  timeout: 180_000,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'kw-doctor-epoch-'));
  roots.push(root);
  const boot = async (join_?: { backendId: string; tenants: Record<string, string> }) => {
    const runtime = await startTestRuntime(libraryApp, {
      external: {
        factory: durablePgliteFactory({ dataDirOf: (placement) => join(root, placement.id) }),
        url: 'pglite',
      },
      tenants: ['acme'],
      ...(join_ === undefined ? {} : { join: join_ }),
    });
    stops.push(() => runtime.stop(1000));
    return runtime;
  };
  const add = (runtime: Awaited<ReturnType<typeof boot>>, isbn: string) =>
    createLocalClient(runtime, { principal: testPrincipal('ada') }).invoke('library.addBook', {
      title: `Book ${isbn}`,
      isbn,
    });

  const first = await boot();
  await add(first, '1');
  const ids = { backendId: first.backendId, tenants: { acme: first.tenants.acme.id } };
  await first.stop(1000);
  stops.length = 0;
  await cp(join(root, 'main'), join(root, 'backup'), { recursive: true });

  const second = await boot(ids);
  await add(second, '2');
  await add(second, '3');
  await second.stop(1000);
  stops.length = 0;
  await rm(join(root, 'main'), { recursive: true, force: true });
  await cp(join(root, 'backup'), join(root, 'main'), { recursive: true });

  const third = await boot(ids);
  const reader = controlReaderOf(
    {
      read: (fn) =>
        third.control.adapter.unit(third.control.namespace, { level: 'deployment' }, fn, {
          readOnly: true,
        }),
      entity: () => undefined as never,
    },
    () => Temporal.Now.instant(),
  );
  const found = await checkEpochBumps(
    { reader } as unknown as DeploymentInput,
    {} as DeploymentFacts,
    Temporal.Now.instant(),
  );
  expect(found.length).toBeGreaterThan(0);
  expect(found.every((finding) => finding.check === 'epoch-bumps')).toBe(true);
  expect(found.map((finding) => finding.subject)).toContain(third.namespace.id);
  expect(found[0]?.message).toContain('highest epoch 2');
});
