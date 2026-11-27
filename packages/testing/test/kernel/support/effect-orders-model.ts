import type { run } from './effect-secrets-app.ts';

type Step = (typeof run.script)[number];

const retryLimit = 3;

/** A small seeded generator (mulberry32): the same seed gives the same sample on every machine. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** One run of an effect: what each attempt does, whether something else settles the last hanging attempt meanwhile, and what fails around the settle. */
export interface OrderCase {
  readonly steps: readonly Step[];
  readonly meanwhile: boolean;
  /** `end<k>`: the end unit of attempt k fails once (a store error); `enqueue`: the enqueue of the continuation fails once. */
  readonly injection: 'none' | 'end1' | 'end2' | 'end3' | 'enqueue';
}

/** What the settle of an effect must come to: its status, the code of its error, the attempt it settled at and what its continuation records. */
export interface Expected {
  readonly status: 'succeeded' | 'failed' | 'abandoned';
  readonly code?: string;
  readonly attempts: number;
  /** The highest attempt number among its records: the attempt of the last take that started. */
  readonly started: number;
  /** `none`: the effect was settled by something else, no continuation ran. */
  readonly ledger: 'proof' | 'code' | 'none';
}

/** The model: the outcome of the first attempt that does not end in a retry, or of the last one the policy allows. */
export function expectedOf(order: OrderCase): Expected {
  for (let attempt = 1; attempt <= retryLimit; attempt += 1) {
    const step = order.steps[attempt - 1] ?? 'ok';
    const last = attempt === retryLimit;
    if (step === 'ok')
      return { status: 'succeeded', attempts: attempt, started: attempt, ledger: 'proof' };
    if (step === 'fail') {
      return {
        status: 'failed',
        code: 'core.validation',
        attempts: attempt,
        started: attempt,
        ledger: 'code',
      };
    }
    if (step === 'hang' && order.meanwhile && attempt === order.steps.length) {
      // A row that something else settled keeps the count it had: the kernel wrote none.
      return { status: 'abandoned', attempts: 0, started: attempt, ledger: 'none' };
    }
    if (last) {
      return step === 'unavailable'
        ? {
            status: 'failed',
            code: 'core.unavailable',
            attempts: attempt,
            started: attempt,
            ledger: 'code',
          }
        : {
            status: 'abandoned',
            code: 'core.effect_outcome_unknown',
            attempts: attempt,
            started: attempt,
            ledger: 'code',
          };
    }
  }
  throw new Error('unreachable');
}

/** Every order: a prefix of attempts that end in a retry, then a last step, each with every failure around the settle. */
export function allOrders(): OrderCase[] {
  const retried: Step[] = ['unavailable', 'hang'];
  const prefixes: Step[][] = [
    [],
    ...retried.map((a) => [a]),
    ...retried.flatMap((a) => retried.map((b) => [a, b])),
  ];
  const finals: { step: Step; meanwhile: boolean }[] = [
    { step: 'ok', meanwhile: false },
    { step: 'fail', meanwhile: false },
    { step: 'unavailable', meanwhile: false },
    { step: 'hang', meanwhile: false },
    { step: 'hang', meanwhile: true },
  ];
  const injections = ['none', 'end1', 'end2', 'end3', 'enqueue'] as const;
  return prefixes.flatMap((prefix) =>
    finals.flatMap(({ step, meanwhile }) =>
      injections.map((injection) => ({ steps: [...prefix, step], meanwhile, injection })),
    ),
  );
}

/** `count` of the orders, drawn by the seed (a shuffle, so no order twice). */
export function sampleOf(seed: number, count: number): OrderCase[] {
  const next = random(seed);
  const pool = allOrders();
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const other = Math.floor(next() * (index + 1));
    [pool[index], pool[other]] = [pool[other] as OrderCase, pool[index] as OrderCase];
  }
  return pool.slice(0, count);
}
