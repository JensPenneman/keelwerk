import type { ActorRef } from '../principals/actor-ref.ts';
import type { ReactionLineage } from '../reactions/reaction-lineage.ts';
import type { Unit } from '../storage/unit.ts';

/** What caused the request of an effect, as its jobs carry it: the actor, the command, the cause event and the reaction lineage. */
export interface EffectCause {
  readonly actor?: ActorRef;
  readonly causation: {
    readonly commandId: string;
    readonly eventId?: string;
    readonly lineage?: ReactionLineage;
  };
}

/**
 * The cause of an effect that a restore left requested, read from the `requested` event that opens
 * its `core.effect` stream: the actor and the reaction lineage that event carries, and the event
 * that caused it when the request came from a reaction (the causation of an event is the command
 * itself when no event caused it). So a job enqueued again after a restore continues the chain it
 * belonged to: its continuation starts at the lineage's depth and the audit trail names the actor.
 * An effect without a readable record falls back to its command.
 */
export async function effectCauseOf(
  unit: Unit,
  effectId: string,
  commandId: string,
): Promise<EffectCause> {
  const [requested] = await unit.events.readStream(
    { type: 'core.effect', id: effectId },
    { limit: 1 },
  );
  if (requested === undefined) return { causation: { commandId } };
  const eventId =
    requested.causationId !== null && requested.causationId !== commandId
      ? requested.causationId
      : undefined;
  return {
    actor: requested.actor,
    causation: {
      commandId,
      ...(eventId === undefined ? {} : { eventId }),
      ...(requested.lineage === undefined ? {} : { lineage: requested.lineage }),
    },
  };
}
