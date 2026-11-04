import type { CreateDraft } from '../protocol/create-draft.ts';
import type { ExternalEffect } from '../protocol/external-effect.ts';
import type { EffectEntry } from '../registry/effect-entry.ts';

/** The `requested` row of a `core.effect` stream (section 7.9.6). */
export function requestedEffectDraft(
  scene: { readonly commandId: string; readonly eventIds: readonly string[] },
  effect: ExternalEffect,
  entry: EffectEntry,
  id: string,
  input: unknown,
): CreateDraft {
  return Object.freeze({
    kind: 'create',
    type: 'created',
    target: 'core.effect',
    entity: 'core.effect',
    id,
    expectedVersion: 0,
    values: {
      type: entry.ref,
      commandId: scene.commandId,
      status: 'requested',
      attempts: 0,
      performer: entry.performer,
      input,
      eventIds: scene.eventIds,
      ...(effect.continueWith === undefined ? {} : { continuation: effect.continueWith }),
      ...(effect.with === undefined ? {} : { continuationWith: effect.with }),
      ...(effect.key === undefined ? {} : { key: effect.key }),
      ...(effect.runAt === undefined ? {} : { runAt: effect.runAt }),
      ...(effect.deadline === undefined ? {} : { deadline: effect.deadline }),
    },
  });
}
