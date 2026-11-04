import { describe, expect, test } from 'vitest';
import type { AnswerContext } from '../kernel/answer-context.ts';
import type { AllRequest } from '../protocol/all-request.ts';
import type { AnyRequest } from '../protocol/any-request.ts';
import type { IdRequest } from '../protocol/id-request.ts';
import type { LoadRequest } from '../protocol/load-request.ts';
import type { Pending } from '../protocol/pending.ts';
import { answerAll } from './answer-all.ts';
import { answerMaybe } from './answer-maybe.ts';
import { buildMaybeAccessor } from './build-maybe-accessor.ts';
import { createRequest } from './create-request.ts';
import { driveHandler } from './drive-handler.ts';

const load = (id: string): LoadRequest =>
  createRequest<LoadRequest>(new WeakMap(), {
    kind: 'load',
    module: 'm',
    entity: 'e',
    op: 'byId',
    args: [id],
    view: 'module',
    forUpdate: false,
  });

/** Answers each load with `row:<id>` and keeps the order it was asked in. */
function recorder(): {
  readonly asked: string[];
  readonly context: AnswerContext;
  answer(request: AnyRequest): Promise<unknown>;
} {
  const asked: string[] = [];
  const context = {} as { answer?: (request: AnyRequest) => Promise<unknown> };
  const answer = async (request: AnyRequest): Promise<unknown> => {
    if (request.kind === 'load') {
      asked.push(String(request.args[0]));
      return `row:${String(request.args[0])}`;
    }
    if (request.kind === 'all') return answerAll(request, context as unknown as AnswerContext);
    if (request.kind === 'maybe') return answerMaybe(request, context as unknown as AnswerContext);
    throw new Error(`unexpected ${request.kind}`);
  };
  context.answer = answer;
  return { asked, context: context as unknown as AnswerContext, answer };
}

describe('driveHandler', () => {
  test('a plain handler returns its value', async () => {
    const { answer } = recorder();
    expect(await driveHandler({ ok: true }, answer)).toEqual({ ok: true });
    expect(await driveHandler(undefined, answer)).toBeUndefined();
  });

  test('a returned request is answered and its answer is the output', async () => {
    const { answer, asked } = recorder();
    expect(await driveHandler(load('a'), answer)).toBe('row:a');
    expect(asked).toEqual(['a']);
  });

  test('a generator is answered request by request, in yield order', async () => {
    const { answer, asked } = recorder();
    function* handler(): Generator<Pending, string[], unknown> {
      const first = (yield* load('a')) as string;
      const second = (yield* load('b')) as string;
      return [first, second];
    }
    expect(await driveHandler(handler(), answer)).toEqual(['row:a', 'row:b']);
    expect(asked).toEqual(['a', 'b']);
  });

  test('nested yield* delegates through helper generators', async () => {
    const { answer, asked } = recorder();
    function* inner(id: string): Generator<Pending, string, unknown> {
      return `${(yield* load(id)) as string}!`;
    }
    function* outer(): Generator<Pending, string[], unknown> {
      const a = yield* inner('a');
      const b = yield* inner('b');
      return [a, b];
    }
    expect(await driveHandler(outer(), answer)).toEqual(['row:a!', 'row:b!']);
    expect(asked).toEqual(['a', 'b']);
  });

  test('ctx.all answers its members in order, among other requests', async () => {
    const { answer, asked } = recorder();
    const all = createRequest<AllRequest>(new WeakMap(), {
      kind: 'all',
      requests: [load('1'), load('2'), load('3')],
    });
    function* handler(): Generator<Pending, unknown[], unknown> {
      const before = yield* load('0');
      const together = (yield* all) as unknown[];
      return [before, ...together];
    }
    expect(await driveHandler(handler(), answer)).toEqual(['row:0', 'row:1', 'row:2', 'row:3']);
    expect(asked).toEqual(['0', '1', '2', '3']);
  });

  test('ifPresent answers the inner request when the module is selected', async () => {
    const { answer, asked } = recorder();
    const accessor = buildMaybeAccessor(
      'accounts',
      true,
      () => ({ profile: 'loads' }),
      'auth',
      new WeakMap(),
    );
    const called: unknown[] = [];
    function* handler(): Generator<Pending, unknown, unknown> {
      return yield* accessor.ifPresent((present) => {
        called.push(present);
        return load('p');
      });
    }
    expect(await driveHandler(handler(), answer)).toBe('row:p');
    expect(called).toEqual([{ profile: 'loads' }]);
    expect(asked).toEqual(['p']);
  });

  test('ifPresent drives a generator when the function returns one', async () => {
    const { answer } = recorder();
    const accessor = buildMaybeAccessor('accounts', true, () => ({}), 'auth', new WeakMap());
    function* handler(): Generator<Pending, unknown, unknown> {
      return yield* accessor.ifPresent(function* () {
        const a = (yield* load('x')) as string;
        const b = (yield* load('y')) as string;
        return `${a}+${b}`;
      });
    }
    expect(await driveHandler(handler(), answer)).toBe('row:x+row:y');
  });

  test('ifPresent answers undefined without calling the function or the unit when the module is absent', async () => {
    const { answer, asked } = recorder();
    const accessor = buildMaybeAccessor('accounts', false, () => ({}), 'auth', new WeakMap());
    let calls = 0;
    function* handler(): Generator<Pending, unknown, unknown> {
      return yield* accessor.ifPresent(() => {
        calls += 1;
        return load('never');
      });
    }
    expect(await driveHandler(handler(), answer)).toBeUndefined();
    expect(calls).toBe(0);
    expect(asked).toEqual([]);
  });

  test('ctx.all accepts a Maybe request among its members', async () => {
    const { answer } = recorder();
    const absent = buildMaybeAccessor('accounts', false, () => ({}), 'auth', new WeakMap());
    const present = buildMaybeAccessor('teams', true, () => ({}), 'auth', new WeakMap());
    const all = createRequest<AllRequest>(new WeakMap(), {
      kind: 'all',
      requests: [absent.ifPresent(() => load('a')), present.ifPresent(() => load('b'))],
    });
    expect(await driveHandler(all, answer)).toEqual([undefined, 'row:b']);
  });
});

describe('the refusals', () => {
  const refused = async (result: unknown): Promise<unknown> => {
    const { answer } = recorder();
    return driveHandler(result, answer).then(
      () => 'resolved',
      (error: unknown) => error,
    );
  };

  test('a promise is refused with core.request_not_allowed', async () => {
    const error = await refused(Promise.resolve(1));
    expect(error).toMatchObject({ kind: 'internal', code: 'core.request_not_allowed' });
  });

  test('an async generator is refused', async () => {
    async function* handler(): AsyncGenerator<never> {}
    expect(await refused(handler())).toMatchObject({ code: 'core.request_not_allowed' });
  });

  test('a bare yield is refused and closes the generator', async () => {
    let closed = false;
    function* handler(): Generator<unknown, void, unknown> {
      try {
        yield;
      } finally {
        closed = true;
      }
    }
    expect(await refused(handler())).toMatchObject({ code: 'core.request_not_allowed' });
    expect(closed).toBe(true);
  });

  test('a yielded plain object is refused', async () => {
    function* handler(): Generator<unknown, void, unknown> {
      yield { kind: 'load' };
    }
    expect(await refused(handler())).toMatchObject({ code: 'core.request_not_allowed' });
  });

  test('a failed answer aborts the invocation and never throws into the generator', async () => {
    const trace: string[] = [];
    function* handler(): Generator<Pending, void, unknown> {
      try {
        yield* load('a');
        trace.push('after');
      } catch {
        trace.push('caught');
      } finally {
        trace.push('finally');
      }
    }
    const failure = new Error('database gone');
    await expect(
      driveHandler(handler(), async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(trace).toEqual(['finally']);
  });

  test('a forged id request is a request, so the answerer of the form decides', async () => {
    const forged = createRequest<IdRequest>(new WeakMap(), { kind: 'id', entity: 'book' });
    let asked = '';
    await driveHandler(forged, async (request) => {
      asked = request.kind;
      return 'x';
    });
    expect(asked).toBe('id');
  });
});
