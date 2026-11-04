import { sha256 } from '../crypto/sha256.ts';
import type { EffectScene } from '../effects/effect-scene.ts';
import { plannedEffectIds } from '../effects/planned-effect-ids.ts';
import { errors } from '../errors/errors.ts';
import { buildDecisionRecord } from '../events/build-decision-record.ts';
import { buildEventMeta } from '../events/build-event-meta.ts';
import type { EventMeta } from '../events/event-meta.ts';
import type { RecordedRead } from '../events/recorded-read.ts';
import { appendEvents } from '../write-path/append-events.ts';
import { checkWrittenItems } from '../write-path/check-written-items.ts';
import { draftsToEvents } from '../write-path/drafts-to-events.ts';
import { normalizeDecision } from '../write-path/normalize-decision.ts';
import { openDecision } from '../write-path/open-decision.ts';
import { sealDrafts } from '../write-path/seal-drafts.ts';
import { writeStateRows } from '../write-path/write-state-rows.ts';
import type { WrittenRow } from '../write-path/written-row.ts';
import { maxReactionDepth } from './max-reaction-depth.ts';
import { moduleServicePrincipal } from './module-service-principal.ts';
import { reactionActionOf } from './reaction-action-of.ts';
import { reactionDepthError } from './reaction-depth-error.ts';
import type { ReactionEffects } from './reaction-effects.ts';
import { reactionEventsOf } from './reaction-events-of.ts';

/** Inline reactions in module order: by the module's place in the topological order, then by id. */
function inlineReactionsOf(scene: EffectScene) {
  const { registry } = scene.run;
  const order = new Map(registry.modules.map((module) => [module.id, module.order] as const));
  return [...registry.reactions.values()]
    .filter((reaction) => reaction.timing === 'inline')
    .sort(
      (a, b) => (order.get(a.module) ?? 0) - (order.get(b.module) ?? 0) || a.id.localeCompare(b.id),
    );
}

/**
 * Inline reactions (section 7.7), after the owner's `evolve`: for each event the decision wrote,
 * in write order, the reactions that listen to it decide in module order under their module's
 * service principal, never the principal that caused the event; the causing event and command are
 * the causation of what they write. Their drafts become events in this unit (boundary check, evolve,
 * state row, append) and those events are reacted to in turn, up to a depth of 8: a ninth level is
 * `internal`, `core.reaction_depth`. A failing reaction fails the unit. The effects each decision
 * requested come back with the scene to perform them in.
 */
export async function dispatchInlineReactions(
  scene: EffectScene,
  written: readonly WrittenRow[],
  depth = 1,
): Promise<readonly ReactionEffects[]> {
  const reactions = inlineReactionsOf(scene);
  if (reactions.length === 0) return [];
  const { run, unit } = scene;
  const performed: ReactionEffects[] = [];
  // Every module sees the same events in the same order, so one index runs through all of them:
  // event-major, and for each event the reactions in module order.
  const seen = new Map(
    reactions.map((reaction) => [reaction.id, reactionEventsOf(written, reaction.module)] as const),
  );
  const count = Math.max(0, ...[...seen.values()].map((events) => events.length));
  for (let index = 0; index < count; index += 1) {
    for (const reaction of reactions) {
      const event = seen.get(reaction.id)?.[index];
      if (event === undefined || !reaction.on.includes(event.type)) continue;
      if (depth > maxReactionDepth) throw reactionDepthError(`The reaction "${reaction.id}"`);
      const principal = moduleServicePrincipal(reaction.module, run.principal);
      const reactionRun = { ...run, action: reactionActionOf(reaction, run.action), principal };
      const decision = openDecision({ run: reactionRun, unit, form: 'decide', clock: scene.clock });
      const decided = normalizeDecision(await decision.drive(reaction.react(event, decision.ctx)));
      const cause = `${reaction.id}:${event.id}`;
      let meta: EventMeta | undefined;
      const metaOf = (recorded: readonly RecordedRead[]): EventMeta => {
        meta = buildEventMeta({
          principal,
          commandId: scene.commandId,
          action: reaction.id,
          correlationId: run.correlationId ?? run.request.requestId,
          causationId: event.id,
          ...(run.client === undefined ? {} : { client: run.client }),
          ...(run.traceparent === undefined ? {} : { traceparent: run.traceparent }),
          build: run.build,
          flags: [...decision.flags.values()],
          decision: buildDecisionRecord({
            part: reaction.id,
            inputDigest: sha256(event.id),
            reads: recorded,
            answers: decision.answers,
            effects: plannedEffectIds(run.scope, cause, decided.effects),
          }),
        });
        return meta;
      };
      const drafts = await sealDrafts({ registry: run.registry, unit, drafts: decided.drafts });
      const wrote = await draftsToEvents({
        unit,
        registry: run.registry,
        behaviours: run.behaviours,
        drafts,
        authority: reaction.module,
        now: scene.clock.now(),
        meta: metaOf,
        reads: decision.reads,
        loaded: new Map(),
        hybridClock: scene.hybridClock,
      });
      if (meta === undefined) throw errors.internal('the reaction wrote without building its meta');
      await writeStateRows(unit, wrote);
      await appendEvents(unit, wrote);
      await checkWrittenItems({
        unit,
        registry: run.registry,
        rules: run.rules,
        action: reactionRun.action,
        principal,
        scope: run.scope,
        written: wrote,
      });
      performed.push({
        scene: {
          ...scene,
          run: reactionRun,
          module: reaction.module,
          depth,
          causeActor: event.actor,
          cause,
          causeEventId: event.id,
          meta,
          eventIds: wrote.flatMap((item) => item.events.map((one) => one.eventId)),
        },
        effects: decided.effects,
      });
      performed.push(...(await dispatchInlineReactions(scene, wrote, depth + 1)));
    }
  }
  return performed;
}
