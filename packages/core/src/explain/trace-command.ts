import { errors } from '../errors/errors.ts';
import type { EventMatch } from '../events/event-match.ts';
import type { StoredEvent } from '../events/stored-event.ts';
import type { Position } from '../storage/position.ts';
import type { Unit } from '../storage/unit.ts';
import type { TraceInput } from './trace-input.ts';
import type { TraceCommand, TraceEffect, TraceEvent, TraceReport } from './trace-report.ts';

const maxDepth = 16;
const effectType = 'core.effect';
const uuidShape = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const lookupPage = 500;

/** Every event the match names, page by page, so no command or cause loses events to a cut. */
async function findAll(unit: Unit, match: EventMatch): Promise<readonly StoredEvent[]> {
  const all: StoredEvent[] = [];
  let after: Position | null = null;
  do {
    const page = await unit.events.find(match, { after, limit: lookupPage });
    all.push(...page.events);
    after = page.next;
  } while (after !== null);
  return all;
}

async function findOne(unit: Unit, match: EventMatch): Promise<StoredEvent | undefined> {
  return (await unit.events.find(match, { after: null, limit: 1 })).events[0];
}

async function readEffect(unit: Unit, id: string): Promise<readonly StoredEvent[]> {
  return unit.events.readStream({ type: effectType, id });
}

/** The ids of the commands whose causation is `causeId`; effect records are not commands of their own. */
async function commandsCausedBy(unit: Unit, causeId: string): Promise<readonly string[]> {
  const caused = await findAll(unit, { causationId: causeId });
  const ids = new Set<string>();
  for (const event of caused) {
    if (event.commandId !== null && event.stream.type !== effectType) ids.add(event.commandId);
  }
  return [...ids];
}

function traceEvent(event: StoredEvent): TraceEvent {
  return {
    eventId: event.eventId,
    position: event.position.toString(),
    stream: `${event.stream.type}/${event.stream.id}`,
    version: event.version,
    type: event.type,
    recordedAt: event.recordedAt.toString(),
    hash: event.hash,
  };
}

function valuesOf(event: StoredEvent): Record<string, unknown> {
  const { data } = event;
  if (typeof data !== 'object' || data === null) return {};
  const values: unknown = Reflect.get(data, 'values');
  return typeof values === 'object' && values !== null ? (values as Record<string, unknown>) : {};
}

async function effectOf(
  unit: Unit,
  id: string,
  seen: ReadonlySet<string>,
  depth: number,
): Promise<TraceEffect> {
  const events = await readEffect(unit, id);
  let type: string | null = null;
  let status: string | null = null;
  for (const event of events) {
    const values = valuesOf(event);
    if (typeof values.type === 'string') type = values.type;
    if (typeof values.status === 'string') status = values.status;
  }
  const continuations: TraceCommand[] = [];
  for (const commandId of await commandsCausedBy(unit, id)) {
    if (seen.has(commandId) || depth >= maxDepth) continue;
    continuations.push(await commandOf(unit, commandId, seen, depth + 1));
  }
  return { id, type, status, events: events.map(traceEvent), continuations };
}

async function commandOf(
  unit: Unit,
  commandId: string,
  visited: ReadonlySet<string>,
  depth: number,
): Promise<TraceCommand> {
  const seen = new Set(visited).add(commandId);
  const all = await findAll(unit, { commandId });
  const own = all.filter((event) => event.stream.type !== effectType);
  const first = all[0];
  const decision = own.find((event) => event.decision !== null)?.decision ?? null;
  const effectIds = new Set<string>();
  for (const event of all) {
    if (event.stream.type === effectType && event.version === 1) effectIds.add(event.stream.id);
  }
  const effects: TraceEffect[] = [];
  for (const id of effectIds) effects.push(await effectOf(unit, id, seen, depth));
  const nested: TraceCommand[] = [];
  for (const caused of await commandsCausedBy(unit, commandId)) {
    if (seen.has(caused) || depth >= maxDepth) continue;
    nested.push(await commandOf(unit, caused, seen, depth + 1));
  }
  return {
    commandId,
    action: first?.action ?? null,
    actor: { kind: first?.actor.kind ?? 'system', id: first?.actor.id ?? null },
    events: own.map(traceEvent),
    decision:
      decision === null
        ? null
        : { part: decision.part, inputDigest: decision.inputDigest, effects: decision.effects },
    effects,
    nested,
  };
}

/**
 * A command's tree from the chain (section 7.9.6): its events, its effects with their outcomes
 * and the commands they caused. The id may name the command, one of its events or one of its
 * effects; the tree is always the one of the command. The scope is read, never written, and only
 * the events the tree names are read: the store finds them by command and causation id.
 */
export async function traceCommand(input: TraceInput): Promise<TraceReport> {
  const { id } = input;
  return input.adapter.unit(
    input.namespace,
    input.scope,
    async (unit) => {
      let kind: TraceReport['requested']['kind'] = 'command';
      let commandId: string | null = null;
      // A stream id is a UUID column on SQL stores; any other text cannot name an effect.
      const effect = uuidShape.test(id) ? await readEffect(unit, id) : [];
      if (effect.length > 0) {
        kind = 'effect';
        commandId = effect[0]?.commandId ?? null;
      } else if ((await findOne(unit, { commandId: id })) !== undefined) {
        commandId = id;
      } else {
        const event = await findOne(unit, { eventId: id });
        if (event !== undefined) {
          kind = 'event';
          commandId = event.commandId;
        }
      }
      if (commandId === null) {
        throw errors.not_found(
          `The scope's chain holds no command, event or effect with id ${id}.`,
        );
      }
      return { requested: { kind, id }, command: await commandOf(unit, commandId, new Set(), 0) };
    },
    { readOnly: true },
  );
}
