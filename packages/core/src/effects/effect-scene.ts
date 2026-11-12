import type { HybridClock } from '../clock/hybrid-clock.ts';
import type { EventMeta } from '../events/event-meta.ts';
import type { Clock } from '../kernel/clock.ts';
import type { ActorRef } from '../principals/actor-ref.ts';
import type { PrincipalRef } from '../principals/principal-ref.ts';
import type { Unit } from '../storage/unit.ts';
import type { RunCommandInput } from '../write-path/run-command-input.ts';
import type { NestedCommandRunner } from './nested-command-runner.ts';

/**
 * What the effects of one decision are performed with. `run` carries the principal the effects act
 * as (the command's, or the module's service principal for a reaction) and the action the decision
 * belongs to.
 */
export interface EffectScene {
  readonly unit: Unit;
  readonly run: RunCommandInput;
  readonly clock: Clock;
  /** The module whose decision requested the effects: its service principal runs the timers. */
  readonly module: string;
  /** Who caused the decision: the command's actor, or the actor of the event a reaction decided on. */
  readonly causeActor: ActorRef;
  /** The reference of the principal whose command the decision belongs to; inherited by inline reactions; absent under a minted service principal. */
  readonly submitter?: PrincipalRef;
  /** The command the decision belongs to. */
  readonly commandId: string;
  /** What the effect ids derive from: the command id, or `<reaction id>:<event id>`. */
  readonly cause: string;
  /** The event a reaction decided on; absent for a command. */
  readonly causeEventId?: string;
  /** The commands nested so far (an `invoke` runs one deeper). */
  readonly depth: number;
  /** The meta of the events the effect records join. */
  readonly meta: EventMeta;
  /** The ids of the events the decision wrote, recorded on the effects it requested. */
  readonly eventIds: readonly string[];
  /** The process clock the events' readings are taken from. */
  readonly hybridClock: HybridClock;
  readonly runNested: NestedCommandRunner;
}
