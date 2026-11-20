import { defineReaction, type SubjectId } from '@keelwerk/core';
import { auditBase } from '../base.ts';
import { entry } from '../entities/entry.ts';
import { clipText } from '../lib/clip-text.ts';

/**
 * Writes one entry for every event of a tenant but the entry's own. What it keeps of the event is
 * named below: never its data, its previous values or the row; the request metadata comes from the
 * receipt through the kernel, and the address and the agent are kept only with the data subject
 * they belong to, which a personal value needs. The unique event id and the load make a second job
 * for the same event write nothing.
 */
export const recordEvent = defineReaction(auditBase, {
  on: 'all',
  except: [
    'audit.entry.archived',
    'audit.entry.changed',
    'audit.entry.created',
    'audit.entry.erased',
    'audit.entry.restored',
  ],
  *react(event, ctx) {
    if (ctx.scope.level !== 'tenant') return [];
    const existing = yield* ctx.load.audit.entry.one({ where: { eventId: event.id } });
    if (existing !== undefined) return [];
    const id = yield* ctx.newId(entry);
    const { actor, request, subject } = event;
    const named = actor.kind === 'service' || actor.kind === 'operator';
    return [
      ctx.write.audit.entry.create({
        id,
        eventId: event.id,
        eventType: event.type,
        streamType: event.stream.type,
        streamId: event.stream.id,
        streamVersion: event.version,
        at: event.at,
        ...(event.action === null ? {} : { action: event.action }),
        ...(event.commandId === null ? {} : { commandId: event.commandId }),
        ...(event.causationId === null ? {} : { causationId: event.causationId }),
        actorKind: actor.kind,
        actorVia: actor.via,
        ...(named && actor.id !== null ? { actorId: actor.id } : {}),
        ...(subject === null ? {} : { subject: subject as SubjectId }),
        ...(request === null ? {} : { transport: request.transport }),
        ...(subject !== null && request?.remoteAddress != null
          ? { remoteAddress: clipText(request.remoteAddress, 64) }
          : {}),
        ...(subject !== null && request?.userAgent != null
          ? { userAgent: clipText(request.userAgent, 512) }
          : {}),
      }),
    ];
  },
});
