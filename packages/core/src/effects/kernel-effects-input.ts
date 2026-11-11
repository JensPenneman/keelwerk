import type { HybridClock } from '../clock/hybrid-clock.ts';
import type { EventMeta } from '../events/event-meta.ts';
import type { Clock } from '../kernel/clock.ts';
import type { ActorRef } from '../principals/actor-ref.ts';
import type { AnyEffect } from '../protocol/any-effect.ts';
import type { Unit } from '../storage/unit.ts';
import type { RunCommandInput } from '../write-path/run-command-input.ts';
import type { WrittenRow } from '../write-path/written-row.ts';
import type { NestedCommandRunner } from './nested-command-runner.ts';

/** What the kernel effects of one decision run with. */
export interface KernelEffectsInput {
  readonly unit: Unit;
  /** The command's run: its principal, action, registry, scope and build. */
  readonly run: RunCommandInput;
  readonly commandId: string;
  readonly clock: Clock;
  /** The meta the decision's events carry; the effect records join it. */
  readonly meta: EventMeta;
  /** What the decision wrote: the events the inline reactions react to. */
  readonly written: readonly WrittenRow[];
  readonly effects: readonly AnyEffect[];
  /** The process clock the events' readings are taken from. */
  readonly hybridClock: HybridClock;
  readonly runNested: NestedCommandRunner;
  /** The commands nested above this one; default 0. */
  readonly depth?: number;
  /** An async reaction job: the event it decided on and the actor that caused it. The effects it requests name them as their cause. */
  readonly cause?: { readonly eventId: string; readonly actor: ActorRef };
}
