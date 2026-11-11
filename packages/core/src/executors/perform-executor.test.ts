import process from 'node:process';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { inertSpan, type LoggedLine, recordingLogger } from '../../test/executor-kit.ts';
import type { ExecutorContext } from '../contexts/executor-context.ts';
import { errors } from '../errors/errors.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import type { Job } from '../jobs/job.ts';
import type { RunJobContext } from '../worker/run-job.ts';
import type { EffectAttemptJob } from './effect-attempt-job.ts';
import { performExecutor } from './perform-executor.ts';

const personal = 'ada.personal-marker@example.org';
const output = shape({ status: field.integer() });

function targetOf(run: (input: unknown, context: ExecutorContext<unknown>) => Promise<unknown>) {
  return {
    stored: { scope: { level: 'deployment' }, attempt: { attempt: 1 } },
    registry: { actions: new Map() },
    effectId: 'eff-1',
    requestId: 'req-1',
    executor: { run },
    entry: { ref: 'mail.send', module: 'mail', input: shape({}), output },
  } as unknown as EffectAttemptJob;
}

const context = {
  keys: {},
  source: { handle: { adapter: {} }, namespace: {} },
  egress: undefined,
} as unknown as RunJobContext;

function jobOf(controller: AbortController): Job {
  return { stored: {}, signal: controller.signal, heartbeat: () => undefined } as unknown as Job;
}

function run(controller: AbortController, target: EffectAttemptJob, lines: LoggedLine[] = []) {
  return performExecutor(jobOf(controller), context, target, {
    input: {},
    config: { value: {}, shape: undefined },
    span: inertSpan(),
    log: recordingLogger(lines),
  });
}

const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown): void => {
  unhandled.push(reason);
};

beforeEach(() => {
  unhandled.length = 0;
  process.on('unhandledRejection', onUnhandled);
});

afterEach(() => {
  process.off('unhandledRejection', onUnhandled);
});

describe('performExecutor', () => {
  test('never calls the executor when the job signal has already aborted', async () => {
    let calls = 0;
    const controller = new AbortController();
    const reason = new Error('the worker is stopping');
    controller.abort(reason);
    const result = await run(
      controller,
      targetOf(() => {
        calls += 1;
        return Promise.resolve({ status: 200 });
      }),
    );
    expect(calls).toBe(0);
    expect(result).toEqual({ ok: false, error: reason });
  });

  test('an executor abandoned at the deadline that rejects later is caught and logged once, with its code and never its text', async () => {
    const controller = new AbortController();
    const lines: LoggedLine[] = [];
    let rejectLate: (error: unknown) => void = () => undefined;
    const target = targetOf(
      () =>
        new Promise((_resolve, reject) => {
          rejectLate = reject;
        }),
    );
    const pending = run(controller, target, lines);
    controller.abort(errors.unavailable('The attempt ran out of time.'));
    const result = await pending;
    expect(result.ok).toBe(false);
    rejectLate(
      new KeelwerkError({
        kind: 'validation',
        code: 'mail.rejected_ada',
        message: `550 ${personal}`,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(unhandled).toEqual([]);
    const late = lines.filter((line) => line.message.includes('after its attempt ended'));
    expect(late).toHaveLength(1);
    expect(late[0]).toMatchObject({
      level: 'warn',
      fields: { effect: 'eff-1', code: 'core.validation' },
    });
    expect(JSON.stringify(lines)).not.toContain(personal);
  });

  test('an executor that fails before any abort is not logged as late', async () => {
    const lines: LoggedLine[] = [];
    const result = await run(
      new AbortController(),
      targetOf(() => Promise.reject(errors.unavailable('down'))),
      lines,
    );
    expect(result.ok).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(lines.filter((line) => line.message.includes('after its attempt ended'))).toEqual([]);
  });

  test('a fetch or a reveal the executor makes after the attempt ended is refused and sends nothing', async () => {
    let held: ExecutorContext<unknown> | undefined;
    const result = await run(
      new AbortController(),
      targetOf((_input, ctx) => {
        held = ctx;
        return Promise.resolve({ status: 200 });
      }),
    );
    expect(result).toEqual({ ok: true, output: { status: 200 } });
    expect(held?.signal.aborted).toBe(true);
    await expect(held?.egress.fetch('http://127.0.0.1:1/')).rejects.toMatchObject({
      kind: 'unavailable',
      message: 'The attempt of this effect has ended.',
    });
    await expect(held?.secrets.reveal({ ref: 'x' } as never, 'late')).rejects.toMatchObject({
      message: 'The attempt of this effect has ended.',
    });
  });

  test('an answer that does not fit the output shape is a failure after the destination acted', async () => {
    const result = await run(
      new AbortController(),
      targetOf(() => Promise.resolve({ status: '200' })),
    );
    expect(result).toMatchObject({ ok: false, acted: true });
  });

  test('an error the executor throws is no failure after the destination acted', async () => {
    const result = await run(
      new AbortController(),
      targetOf(() => Promise.reject(errors.validation('no'))),
    );
    expect(result).toMatchObject({ ok: false });
    expect(Object.hasOwn(result, 'acted')).toBe(false);
  });
});
