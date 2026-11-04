import type { CommandResult, DataAdapter } from '@keelwerk/core';
import type { EffectLog } from './create-effect-log.ts';
import { createEffectLog } from './create-effect-log.ts';
import { exchangeHandler } from './exchange-handler.ts';
import type { InlineEffectStub } from './inline-effect-stub.ts';
import { createInlineEffectStub } from './inline-effect-stub.ts';
import { runCall } from './run-call.ts';
import type { SpikeWorld } from './start-spike-world.ts';
import { startSpikeWorld } from './start-spike-world.ts';
import { tracedAdapter } from './traced-adapter.ts';

/** A world, an effect log, the executor calls and an adapter trace, made fresh for a test. */
export interface SpikeKit {
  readonly world: SpikeWorld;
  readonly log: EffectLog;
  /** The codes the stub exchange saw. */
  readonly calls: string[];
  /** Units opened, receipts claimed and row queries, in order. */
  readonly trace: string[];
  /** The stub of the latest call. */
  stub(): InlineEffectStub | undefined;
  /** Runs one command in a form; `over.adapter` wraps the traced adapter. */
  call(
    form: 'separate' | 'inline',
    action: string,
    input: unknown,
    over?: { readonly commandId?: string; readonly wrap?: (inner: DataAdapter) => DataAdapter },
  ): Promise<CommandResult>;
  /** Stops the runtime of the kit's world. */
  stop(): Promise<void>;
}

/** Starts a kit; every kit has its own runtime, so tests do not share rows. */
export async function startSpikeKit(): Promise<SpikeKit> {
  const world = await startSpikeWorld();
  const log = createEffectLog();
  const calls: string[] = [];
  const trace: string[] = [];
  let latest: InlineEffectStub | undefined;
  let counter = 0;
  return {
    world,
    log,
    calls,
    trace,
    stub: () => latest,
    call: (form, action, input, over = {}) => {
      counter += 1;
      const commandId =
        over.commandId ?? `00000000-0000-7000-8000-${String(counter).padStart(12, '0')}`;
      const traced = tracedAdapter(world.runtime.adapter, trace);
      latest = createInlineEffectStub({
        commandId,
        log,
        handlers: {
          'github.exchangeCode': async (effectInput) => {
            trace.push('effect');
            return exchangeHandler(calls)(effectInput);
          },
        },
      });
      return runCall(world, {
        form,
        action,
        input,
        commandId,
        stub: latest,
        adapter: over.wrap === undefined ? traced : over.wrap(traced),
      });
    },
    stop: () => world.runtime.stop(),
  };
}
