import { expect } from 'vitest';
import { createLocalClient } from '../../../src/harness/create-local-client.ts';
import { testPrincipal } from '../../../src/harness/test-principal.ts';
import type { TestRuntime } from '../../../src/harness/test-runtime.ts';
import type { DumpQuery } from '../../../src/index.ts';
import { gapMarker, dumpMarker as marker } from './erasure-dump-markers.ts';
import type { erasureDumpApp } from './erasure-probe-module.ts';
import { recoverMarkers } from './erasure-readers.ts';

type Runtime = TestRuntime<typeof erasureDumpApp>;

/** What planting left: the people, their threads and the commands planted, by name, with their input. */
interface Planted {
  readonly ada: string;
  readonly bea: string;
  readonly adaSession: string;
  readonly adaThread: string;
  readonly beaThread: string;
  readonly commands: ReadonlyMap<string, { readonly action: string; readonly input: unknown }>;
}

/**
 * Plants a marker through every path that can hold a personal value of Ada: a row with sealed and
 * tagged columns, a thread and a reply of another subject, a personal stream element, a declared
 * error, an asynchronous command, a timer, a job that cannot finish, a sealed effect input, an
 * effect settled with an output and one that was refused, a job key and a reaction key built from
 * personal values, the relay process, a stream ticket and a flag rule. Then lets the workers run.
 */
async function plantMarkers(
  runtime: Runtime,
  operator: ReturnType<typeof createLocalClient<Runtime['app']>>,
  queries: readonly DumpQuery[],
  settle: () => Promise<void>,
): Promise<Planted> {
  const idOf = (answer: unknown, key: string): string =>
    String((answer as Record<string, unknown>)[key]);
  /** The commands planted, by name, with their input: their plain fingerprints are looked for. */
  const planted = new Map<string, { readonly action: string; readonly input: unknown }>();
  const plant = (name: string, action: string, input: unknown): void => {
    planted.set(name, { action, input });
  };
  const run = async (action: string, input: Record<string, unknown>, name = action) => {
    plant(name, action, input);
    return await operator.invoke(action as never, input as never);
  };
  const ada = idOf(
    await operator.invoke('probe.enrol', {
      name: 'Ada',
      email: marker.email,
      notes: marker.notes,
      vip: true,
      token: marker.token,
    }),
    'personId',
  );
  const bea = idOf(
    await operator.invoke('probe.enrol', { name: 'Bea', email: 'bea@example.test' }),
    'personId',
  );
  const adaThread = idOf(
    await run('probe.open', { ownerId: ada, title: 'a', topic: marker.topic }),
    'threadId',
  );
  const beaThread = idOf(
    await operator.invoke('probe.open', { ownerId: bea as never, title: 'b' }),
    'threadId',
  );
  await run(
    'probe.answer',
    { threadId: adaThread, replierId: bea, reply: marker.beaReply },
    'probe.answer.bea',
  );
  await run(
    'probe.answer',
    { threadId: beaThread, replierId: ada, reply: marker.adaReply },
    'probe.answer.ada',
  );
  await run('probe.jot', { threadId: adaThread, tag: marker.tag });
  plant('probe.claim', 'probe.claim', { ownerId: ada, email: marker.claim });
  const claimed = await operator.attempt('probe.claim', {
    ownerId: ada as never,
    email: marker.claim,
  });
  expect(claimed.ok).toBe(false);
  plant('probe.subscribe', 'probe.subscribe', { address: marker.address, ownerId: ada });
  await operator.invoke(
    'probe.subscribe',
    { address: marker.address, ownerId: ada as never },
    { prefer: 'async' },
  );
  // The job completes without keeping its input: its sealed member is read while it is queued.
  const queued = await recoverMarkers(runtime, queries, adaThread);
  expect(queued.address, 'the queued job input opens before the job runs').toBe(marker.address);
  await run('probe.send', { threadId: adaThread, to: marker.deliver });
  // A timer seals the personal member of its command under the subject's key like any job.
  await operator.invoke('probe.arm', { threadId: adaThread as never });
  await run('probe.armPersonal', { ownerId: ada, address: marker.timed });
  // A job that cannot finish: its personal member waits, sealed, in the queue.
  plant('probe.defer', 'probe.defer', { address: marker.deadAddress, ownerId: ada });
  await operator.invoke(
    'probe.defer',
    { address: marker.deadAddress, ownerId: ada as never },
    { prefer: 'async' },
  );
  // A module built a job key from a personal value, and a reaction was keyed by the topic.
  await run('probe.remind', { threadId: adaThread, ownerId: ada, address: gapMarker.jobKey });
  // A module chose the key of an external effect from a personal value: the record stores a digest.
  await run(
    'probe.notify',
    { threadId: adaThread, to: 'neutral', key: gapMarker.effectKey },
    'probe.notify.keyed',
  );
  // A client wrote Ada's address through a generated update of another person, and the write failed
  // (a version conflict): the failed receipt keeps a fingerprint, which must not be the plain
  // digest.
  const refusedUpdate = { id: bea, ifVersion: 99, patch: { email: marker.email } };
  plant('probe.person.update', 'probe.person.update', refusedUpdate);
  const refused = await operator.attempt('probe.person.update' as never, refusedUpdate as never);
  expect(refused, 'the generated update fails on its version').toMatchObject({
    ok: false,
    error: { code: 'core.version_mismatch' },
  });
  // An effect settled with a secret in its output, and one that its executor refused.
  await run(
    'probe.notify',
    { threadId: adaThread, to: marker.effectOutput },
    'probe.notify.output',
  );
  await run(
    'probe.notify',
    { threadId: adaThread, to: `refuse:${marker.effectRefusal}` },
    'probe.notify.refusal',
  );
  // The subject signs in: the session row it owns is the principal id its requests are stored by.
  const adaSession = idOf(
    await operator.invoke('probe.signIn', { ownerId: ada as never }),
    'sessionId',
  );
  const user = createLocalClient(runtime, {
    principal: testPrincipal(ada, { principalId: adaSession }),
    tenant: 'acme',
  });
  plant('relay.send', 'relay.send', {
    channel: 'dump',
    text: 'hello',
    owner: ada,
    contact: marker.contact,
  });
  await user.invoke('relay.send', {
    channel: 'dump',
    text: 'hello',
    owner: ada as never,
    contact: marker.contact,
  });
  // The session asks for a delivery with a deadline: its effect names the session as the submitter.
  await user.invoke('probe.reachOut', {
    threadId: adaThread as never,
    to: marker.deliver,
    deadline: Temporal.Now.instant().add({ hours: 2 }),
  });
  // A stream ticket of the subject's session.
  await user.invoke('live.ticket', {});
  const flag = await runtime.invoker.invoke<unknown, { id: string }>({
    action: 'core.flag.set',
    input: {
      key: 'probe.beta',
      backendId: runtime.backendId,
      targeting: {
        enabled: true,
        rules: [{ id: 'ada', principals: [ada], serve: { value: true } }],
        fallthrough: { value: false },
      },
      reason: 'dump',
    },
    carrier: { transport: 'test', local: { inProcess: true } },
    requestId: crypto.randomUUID(),
    commandId: crypto.randomUUID(),
    signal: new AbortController().signal,
  });
  if (!flag.ok) throw flag.error;
  for (let round = 0; round < 3; round += 1) {
    await settle();
    await runtime.drainJobs();
  }
  return { ada, bea, adaSession, adaThread, beaThread, commands: planted };
}

export type { Planted };
export { plantMarkers };
