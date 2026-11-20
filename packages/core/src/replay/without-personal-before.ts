import { personalFieldsOf } from '../encryption/personal-fields-of.ts';
import type { Registry } from '../registry/registry.ts';
import type { ComparableEvent } from './comparable-event.ts';

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * With `byPresence`: the events without the personal fields of their before-image, as the entity
 * of each event's stream declares them. The recorded event holds each of them sealed or, for a
 * field made personal since, in plain text; a before-image leaves a field out when the value did
 * not change, so keeping one would tell a guess that equals the previous value from every other
 * guess. A before-image left empty is `null`.
 * Otherwise the events as they are.
 */
export function withoutPersonalBefore(
  registry: Registry,
  byPresence: boolean,
): (events: readonly ComparableEvent[]) => readonly ComparableEvent[] {
  if (!byPresence) return (events) => events;
  return (events) =>
    events.map((event) => {
      const entry = registry.entities.get(event.stream.slice(0, event.stream.indexOf('/')));
      if (entry === undefined || !isRecord(event.before)) return event;
      const names = new Set(personalFieldsOf(entry.descriptor).map(({ name }) => name));
      const kept = Object.entries(event.before).filter(([name]) => !names.has(name));
      return { ...event, before: kept.length === 0 ? null : Object.fromEntries(kept) };
    });
}
