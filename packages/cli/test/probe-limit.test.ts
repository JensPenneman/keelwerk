import { describe, expect, test } from 'vitest';
import { resultMarker } from '../src/dev/result-marker.ts';
import { startProbe } from '../src/dev/start-probe.ts';
import { drivenChild } from './support/driven-child.ts';
import { eventLine } from './support/event-line.ts';
import { createFakeHost } from './support/fake-host.ts';
import { probeOptions } from './support/probe-options.ts';
import { quietExit } from './support/quiet-exit.ts';
import { spawningChild } from './support/spawning-child.ts';

describe('the probe limits', () => {
  test('a probe that makes no progress for its limit is killed and names the import it waits on', async () => {
    const child = spawningChild(
      '',
      [
        '@keelwerk-event import - file:///p/.keelwerk/dev-deployment.ts',
        '@keelwerk-event import file:///p/.keelwerk/dev-deployment.ts file:///p/modules/m/src/slow.ts',
      ]
        .map((line) => `${line}\n`)
        .join(''),
      undefined,
    );
    const fake = createFakeHost({ spawn: child.spawn });
    const probing = startProbe(fake.host, probeOptions, 10_000);
    await Promise.resolve();
    // The events the child printed at once restarted the limit; the live timer is the last one.
    const timer = fake.timers.filter((candidate) => !candidate.cancelled);
    expect(timer.map((candidate) => candidate.milliseconds)).toEqual([10_000]);
    timer[0]?.fire();
    const outcome = await probing;
    expect(child.killed).toEqual(['SIGKILL']);
    expect(outcome).toEqual({
      kind: 'failed',
      message:
        'the probe made no progress for 10 seconds, while it evaluated /p/modules/m/src/slow.ts; module definitions must be free of I/O at import time',
    });
  });

  test('a probe that stalls in an import after a step names that import, not the step', async () => {
    const child = spawningChild(
      '',
      [
        '@keelwerk-event import - file:///p/.keelwerk/dev-deployment.ts',
        '@keelwerk-event done file:///p/.keelwerk/dev-deployment.ts',
        '@keelwerk-event step loaded the deployment',
        '@keelwerk-event import - file:///p/modules/m/src/slow.ts',
      ]
        .map((line) => `${line}\n`)
        .join(''),
      undefined,
    );
    const fake = createFakeHost({ spawn: child.spawn });
    const probing = startProbe(fake.host, probeOptions, 10_000);
    await Promise.resolve();
    fake.timers.filter((candidate) => !candidate.cancelled)[0]?.fire();
    expect(await probing).toEqual({
      kind: 'failed',
      message:
        'the probe made no progress for 10 seconds, while it evaluated /p/modules/m/src/slow.ts; module definitions must be free of I/O at import time',
    });
  });

  test('every event restarts it, so a slow probe that keeps progressing is never stopped', async () => {
    const child = drivenChild();
    const fake = createFakeHost({ spawn: child.spawn });
    const probing = startProbe(fake.host, probeOptions, 10_000);
    await Promise.resolve();
    expect(fake.timers.filter((timer) => !timer.cancelled)).toHaveLength(1);
    // Each event arrives before the limit of the previous one passed, however long the whole run takes.
    for (let index = 0; index < 30; index += 1) {
      const pending = fake.timers.filter((timer) => !timer.cancelled);
      child.stderr(eventLine(`import file:///p/a.ts file:///p/m${index}.ts`));
      expect(pending.every((timer) => timer.cancelled)).toBe(true);
      expect(fake.timers.filter((timer) => !timer.cancelled)).toHaveLength(1);
    }
    for (const timer of fake.timers.slice(0, -1)) timer.fire();
    expect(child.killed).toEqual([]);
    const result = { producers: { written: [], notes: [], failures: [] }, sync: undefined };
    child.stdout(`${resultMarker} ${JSON.stringify(result)}\n`);
    child.end(quietExit);
    expect(await probing).toEqual({ kind: 'done', result });
    expect(fake.timers.every((timer) => timer.cancelled)).toBe(true);
    // Before the first event nothing is imported, so the step limit applies; every import after it brings the import limit.
    expect(fake.timers[0]?.milliseconds).toBe(60_000);
    expect(fake.timers.slice(1).every((timer) => timer.milliseconds === 10_000)).toBe(true);
  });

  test('a probe that goes quietExit after progress fails one step limit after its last event, naming the step', async () => {
    const child = drivenChild();
    const fake = createFakeHost({ spawn: child.spawn });
    const probing = startProbe(fake.host, probeOptions, 10_000, 60_000);
    await Promise.resolve();
    child.stderr(eventLine('import - file:///p/.keelwerk/dev-deployment.ts'));
    child.stderr(eventLine('done file:///p/.keelwerk/dev-deployment.ts'));
    child.stderr(eventLine('step loaded the deployment'));
    child.stderr(eventLine('step produced the API surfaces'));
    // No import is in flight: no failure at the import limit, only the step limit is live.
    expect(
      fake.timers.filter((timer) => !timer.cancelled).map((timer) => timer.milliseconds),
    ).toEqual([60_000]);
    for (const timer of fake.timers.slice(0, -1)) timer.fire();
    expect(child.killed).toEqual([]);
    fake.timers.at(-1)?.fire();
    expect(await probing).toEqual({
      kind: 'failed',
      message: 'the probe made no progress for 60 seconds, after it produced the API surfaces',
    });
    expect(child.killed).toEqual(['SIGKILL']);
  });

  test('while an import is in flight the import limit applies and the module is named', async () => {
    const child = drivenChild();
    const fake = createFakeHost({ spawn: child.spawn });
    const probing = startProbe(fake.host, probeOptions, 10_000, 60_000);
    await Promise.resolve();
    expect(fake.timers[0]?.milliseconds).toBe(60_000);
    child.stderr(eventLine('import - file:///p/.keelwerk/dev-deployment.ts'));
    child.stderr(eventLine('step loaded the deployment'));
    child.stderr(eventLine('import file:///p/.keelwerk/dev-deployment.ts file:///p/m/slow.ts'));
    const live = fake.timers.filter((timer) => !timer.cancelled);
    expect(live.map((timer) => timer.milliseconds)).toEqual([10_000]);
    live[0]?.fire();
    expect(await probing).toEqual({
      kind: 'failed',
      message:
        'the probe made no progress for 10 seconds, while it evaluated /p/m/slow.ts; module definitions must be free of I/O at import time',
    });
  });

  test('an import that finishes switches back to the step limit', async () => {
    const child = drivenChild();
    const fake = createFakeHost({ spawn: child.spawn });
    const probing = startProbe(fake.host, probeOptions, 10_000, 60_000);
    await Promise.resolve();
    const liveLimit = (): number[] =>
      fake.timers.filter((timer) => !timer.cancelled).map((timer) => timer.milliseconds);
    child.stderr(eventLine('import - file:///p/a.ts'));
    expect(liveLimit()).toEqual([10_000]);
    child.stderr(eventLine('import file:///p/a.ts file:///p/b.ts'));
    child.stderr(eventLine('done file:///p/b.ts'));
    expect(liveLimit()).toEqual([10_000]);
    child.stderr(eventLine('done file:///p/a.ts'));
    expect(liveLimit()).toEqual([60_000]);
    // A module that was finished before and is imported again is not evaluated again: nothing is in flight.
    child.stderr(eventLine('import file:///p/c.ts file:///p/b.ts'));
    expect(liveLimit()).toEqual([60_000]);
    child.stderr(eventLine('import - file:///p/d.ts'));
    expect(liveLimit()).toEqual([10_000]);
    child.stderr(eventLine('done file:///p/d.ts'));
    expect(liveLimit()).toEqual([60_000]);
    child.end(quietExit);
    await probing;
  });

  test('an import that failed before a step does not pin the import limit or get named', async () => {
    const child = drivenChild();
    const fake = createFakeHost({ spawn: child.spawn });
    const probing = startProbe(fake.host, probeOptions, 10_000, 60_000);
    await Promise.resolve();
    const liveLimit = (): number[] =>
      fake.timers.filter((timer) => !timer.cancelled).map((timer) => timer.milliseconds);
    child.stderr(eventLine('import - file:///p/a.ts'));
    expect(liveLimit()).toEqual([10_000]);
    child.stderr(eventLine('step could not load a'));
    expect(liveLimit()).toEqual([60_000]);
    child.stderr(eventLine('import - file:///p/b.ts'));
    child.stderr(eventLine('done file:///p/b.ts'));
    expect(liveLimit()).toEqual([60_000]);
    fake.timers.at(-1)?.fire();
    const outcome = await probing;
    expect(outcome).toEqual({
      kind: 'failed',
      message: 'the probe made no progress for 60 seconds, after it could not load a',
    });
  });

  test('a timeout does not name an import that failed before the last step', async () => {
    const child = drivenChild();
    const fake = createFakeHost({ spawn: child.spawn });
    const probing = startProbe(fake.host, probeOptions, 10_000, 60_000);
    await Promise.resolve();
    child.stderr(eventLine('import - file:///p/a.ts'));
    child.stderr(eventLine('step could not load a'));
    child.stderr(eventLine('import - file:///p/b.ts'));
    fake.timers.at(-1)?.fire();
    expect(await probing).toEqual({
      kind: 'failed',
      message:
        'the probe made no progress for 10 seconds, while it evaluated /p/b.ts; module definitions must be free of I/O at import time',
    });
  });

  test('a stall at the step limit carries no advice about module definitions', async () => {
    const child = drivenChild();
    const fake = createFakeHost({ spawn: child.spawn });
    const probing = startProbe(fake.host, probeOptions, 10_000, 60_000);
    await Promise.resolve();
    child.stderr(eventLine('import - file:///p/a.ts'));
    child.stderr(eventLine('done file:///p/a.ts'));
    fake.timers.at(-1)?.fire();
    const outcome = await probing;
    expect(outcome).toEqual({
      kind: 'failed',
      message: 'the probe made no progress for 60 seconds, before it reported a step',
    });
  });

  test('the timer is cancelled when the spawn throws', async () => {
    const fake = createFakeHost({
      spawn: () => {
        throw new Error('no such file');
      },
    });
    await expect(startProbe(fake.host, probeOptions, 10_000, 60_000)).rejects.toThrow(
      'no such file',
    );
    expect(fake.timers.length).toBeGreaterThan(0);
    expect(fake.timers.every((timer) => timer.cancelled)).toBe(true);
  });

  test('output that is not an event does not restart it', async () => {
    const child = drivenChild();
    const fake = createFakeHost({ spawn: child.spawn });
    const probing = startProbe(fake.host, probeOptions, 10_000);
    await Promise.resolve();
    const before = fake.timers.length;
    child.stderr('a warning from a module\n');
    child.stdout('some output\n');
    expect(fake.timers).toHaveLength(before);
    fake.timers.at(-1)?.fire();
    expect((await probing).kind).toBe('failed');
    expect(child.killed).toEqual(['SIGKILL']);
  });

  test('an event line split between two chunks restarts it once it is complete', async () => {
    const child = drivenChild();
    const fake = createFakeHost({ spawn: child.spawn });
    const probing = startProbe(fake.host, probeOptions, 10_000);
    await Promise.resolve();
    const first = fake.timers[0];
    child.stderr('@keelwerk-ev');
    expect(first?.cancelled).toBe(false);
    child.stderr('ent step loaded the deployment\n');
    expect(first?.cancelled).toBe(true);
    expect(fake.timers).toHaveLength(2);
    child.end(quietExit);
    await probing;
  });

  test('a probe that never reported anything is still stopped at the step limit, without naming a module', async () => {
    const child = drivenChild();
    const fake = createFakeHost({ spawn: child.spawn });
    const probing = startProbe(fake.host, probeOptions, 10_000, 60_000);
    await Promise.resolve();
    expect(fake.timers[0]?.milliseconds).toBe(60_000);
    fake.timers[0]?.fire();
    expect(await probing).toEqual({
      kind: 'failed',
      message: 'the probe made no progress for 60 seconds, before it reported a step',
    });
  });

  test('the message names the limit that fired, also when an import line arrives before the child ends', async () => {
    const child = drivenChild();
    const fake = createFakeHost({ spawn: child.spawn });
    const probing = startProbe(fake.host, probeOptions, 10_000, 60_000);
    await Promise.resolve();
    fake.timers.at(-1)?.fire();
    // Output that arrives after the timer fired, before the child is gone, restarts nothing and says nothing.
    child.stderr(eventLine('import - file:///p/late.ts'));
    child.end({ code: null, signal: 'SIGKILL' });
    expect(await probing).toEqual({
      kind: 'failed',
      message: 'the probe made no progress for 60 seconds, before it reported a step',
    });
  });

  test('an event glued to the end of a line without a newline is still read', async () => {
    const child = drivenChild();
    const fake = createFakeHost({ spawn: child.spawn });
    const probing = startProbe(fake.host, probeOptions, 10_000, 60_000);
    await Promise.resolve();
    // A project module wrote "partial" without a newline; the event starts with its own newline.
    child.stderr(`partial\n${eventLine('import - file:///p/glued.ts')}`);
    expect(
      fake.timers.filter((timer) => !timer.cancelled).map((timer) => timer.milliseconds),
    ).toEqual([10_000]);
    child.stderr(`\n${eventLine('step did a thing')}`);
    expect(
      fake.timers.filter((timer) => !timer.cancelled).map((timer) => timer.milliseconds),
    ).toEqual([60_000]);
    child.end(quietExit);
    await probing;
  });
});
