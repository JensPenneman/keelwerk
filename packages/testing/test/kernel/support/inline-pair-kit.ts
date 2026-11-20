import type {
  ActionEntry,
  CommandResult,
  DataAdapter,
  EffectEntry,
  Principal,
} from '@keelwerk/core';
import { field, shape } from '@keelwerk/core';
import { runDirect } from './command-kit.ts';
import { command, effectsKit, externalEffect, registryWith } from './effects-kit.ts';
import { userOf } from './run-read-kit.ts';

/** The command input of these tests: members a prepare derives its effect inputs from. */
const commandInput = shape({
  to: field.string().optional(),
  dest: field.string().optional(),
  owner: field.string().optional(),
  key: field.secret().optional(),
  code: field.secret().optional(),
});

/** What a prepare in these tests yields, loads and performs. */
export interface PairContext {
  readonly load: {
    readonly library: { readonly book: { count(): Generator<never, number, unknown> } };
  };
  perform(effect: unknown): Generator<never, unknown, unknown>;
}

/** A draft of the inline effect `library.<name>`. */
export const draftOf = (name: string, input: Record<string, unknown>) => ({
  kind: 'external',
  type: `library.${name}`,
  input,
});

/** A named caller: its principal carries a reference, so its rows record a submitter. */
export const namedPrincipal = (id: string): Principal =>
  ({ ...userOf(id), ref: { resolver: 'test.principal', principalId: id } }) as Principal;

/** What `bootPair` is given. */
export interface PairOptions {
  readonly prepare: (
    input: Readonly<Record<string, unknown>>,
    ctx: PairContext,
  ) => Generator<never, unknown, unknown>;
  /** Runs inside the ping executor, after it was recorded (a test aborts the run from here). */
  readonly onPing?: (count: number) => void;
  /** Overrides of the ping effect (its input shape, its data subject). */
  readonly ping?: Partial<EffectEntry>;
  readonly pong?: Partial<EffectEntry>;
  /** Overrides of the action (a `timeoutMs`). */
  readonly action?: Partial<ActionEntry>;
  /** A second command, `library.probeB`, with the same prepare and these overrides. */
  readonly second?: Partial<ActionEntry>;
  /** The decide handler; default: no events. */
  readonly decide?: ActionEntry['handler'];
}

/** The app of these tests: two inline effects, `library.ping` and `library.pong`, and the command `library.probe`. */
export interface Pair {
  readonly adapter: DataAdapter;
  readonly registry: ReturnType<typeof registryWith>;
  /** The inputs the executors were run with. */
  readonly pings: unknown[];
  readonly pongs: unknown[];
  run(
    commandId: string,
    input: Record<string, unknown>,
    over?: Partial<Parameters<typeof runDirect>[0]>,
  ): Promise<CommandResult>;
}

export function bootPair(options: PairOptions): Pair {
  const pings: unknown[] = [];
  const pongs: unknown[] = [];
  const ping = externalEffect(
    'ping',
    async (input) => {
      pings.push(input);
      options.onPing?.(pings.length);
      return { ok: true };
    },
    { inline: true },
    options.ping,
  );
  const pong = externalEffect(
    'pong',
    async (input) => {
      pongs.push(input);
      return { ok: true };
    },
    { inline: true },
    options.pong,
  );
  const registry = registryWith({
    effects: [ping.effect, pong.effect],
    executors: [ping.executor, pong.executor],
    actions: [
      command('probe', options.decide ?? ((() => []) as never), {
        input: commandInput,
        prepare: options.prepare as never,
        ...options.action,
      }),
      ...(options.second === undefined
        ? []
        : [
            command('probeB', options.decide ?? ((() => []) as never), {
              input: commandInput,
              prepare: options.prepare as never,
              ...options.second,
            }),
          ]),
    ],
  });
  const { adapter } = effectsKit(registry);
  return {
    adapter,
    registry,
    pings,
    pongs,
    run: (commandId, input, over = {}) =>
      runDirect({ registry, adapter, action: 'library.probe', input, commandId, ...over }),
  };
}

/** A run that is cut once the first ping executor has run: its signal aborts from inside that executor, so no receipt is written. */
export function cutAfterPing(): {
  readonly signal: AbortSignal;
  readonly reason: Error;
  readonly onPing: (count: number) => void;
} {
  const controller = new AbortController();
  const reason = new Error('the run was cut');
  return {
    signal: controller.signal,
    reason,
    onPing: (count) => {
      if (count === 1) controller.abort(reason);
    },
  };
}
