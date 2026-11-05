import { errors } from '../errors/errors.ts';
import type { StoredEvent } from '../events/stored-event.ts';
import type { TraceInput } from './trace-input.ts';
import type { TraceCommand, TraceEffect, TraceEvent, TraceReport } from './trace-report.ts';

const pageSize = 500;
const maxDepth = 16;
const effectType = 'core.effect';

interface Chain {
  readonly byCommand: ReadonlyMap<string, readonly StoredEvent[]>;
  readonly byEffect: ReadonlyMap<string, readonly StoredEvent[]>;
  readonly byCause: ReadonlyMap<string, readonly string[]>;
  readonly byEvent: ReadonlyMap<string, StoredEvent>;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const held = map.get(key);
  if (held === undefined) map.set(key, [value]);
  else held.push(value);
}

async function readChain(input: TraceInput): Promise<Chain> {
  const byCommand = new Map<string, StoredEvent[]>();
  const byEffect = new Map<string, StoredEvent[]>();
  const byCause = new Map<string, string[]>();
  const byEvent = new Map<string, StoredEvent>();
  await input.adapter.unit(
    input.namespace,
    input.scope,
    async (unit) => {
      let after: bigint | null = null;
      for (;;) {
        const batch = await unit.events.readAll(after, { limit: pageSize, includeTransient: true });
        for (const event of batch.events) {
          byEvent.set(event.eventId, event);
          if (event.stream.type === effectType) push(byEffect, event.stream.id, event);
          if (event.commandId !== null) {
            push(byCommand, event.commandId, event);
            if (event.causationId !== null && event.stream.type !== effectType) {
              const caused = byCause.get(event.causationId) ?? [];
              if (!caused.includes(event.commandId))
                push(byCause, event.causationId, event.commandId);
            }
          }
        }
        if (batch.next === null || batch.events.length === 0) return;
        after = batch.next;
      }
    },
    { readOnly: true },
  );
  return { byCommand, byEffect, byCause, byEvent };
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

function effectOf(chain: Chain, id: string, seen: ReadonlySet<string>, depth: number): TraceEffect {
  const events = chain.byEffect.get(id) ?? [];
  let type: string | null = null;
  let status: string | null = null;
  for (const event of events) {
    const values = valuesOf(event);
    if (typeof values.type === 'string') type = values.type;
    if (typeof values.status === 'string') status = values.status;
  }
  return {
    id,
    type,
    status,
    events: events.map(traceEvent),
    continuations: (chain.byCause.get(id) ?? []).flatMap((commandId) =>
      seen.has(commandId) || depth >= maxDepth
        ? []
        : [commandOf(chain, commandId, seen, depth + 1)],
    ),
  };
}

function commandOf(
  chain: Chain,
  commandId: string,
  visited: ReadonlySet<string>,
  depth: number,
): TraceCommand {
  const seen = new Set(visited).add(commandId);
  const all = chain.byCommand.get(commandId) ?? [];
  const own = all.filter((event) => event.stream.type !== effectType);
  const first = all[0];
  const decision = own.find((event) => event.decision !== null)?.decision ?? null;
  const effectIds = new Set<string>();
  for (const event of all) {
    if (event.stream.type === effectType && event.version === 1) effectIds.add(event.stream.id);
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
    effects: [...effectIds].map((id) => effectOf(chain, id, seen, depth)),
    nested: (chain.byCause.get(commandId) ?? []).flatMap((caused) =>
      seen.has(caused) || depth >= maxDepth ? [] : [commandOf(chain, caused, seen, depth + 1)],
    ),
  };
}

/**
 * A command's tree from the chain (section 7.9.6): its events, its effects with their outcomes
 * and the commands they caused. The id may name the command, one of its events or one of its
 * effects; the tree is always the one of the command. The scope is read, never written.
 */
export async function traceCommand(input: TraceInput): Promise<TraceReport> {
  const chain = await readChain(input);
  const { id } = input;
  let kind: TraceReport['requested']['kind'] = 'command';
  let commandId: string | null = null;
  if (chain.byCommand.has(id) && !chain.byEffect.has(id)) {
    commandId = id;
  } else if (chain.byEffect.has(id)) {
    kind = 'effect';
    commandId = chain.byEffect.get(id)?.[0]?.commandId ?? null;
  } else if (chain.byEvent.has(id)) {
    kind = 'event';
    commandId = chain.byEvent.get(id)?.commandId ?? null;
  }
  if (commandId === null) {
    throw errors.not_found(`The scope's chain holds no command, event or effect with id ${id}.`);
  }
  return { requested: { kind, id }, command: commandOf(chain, commandId, new Set(), 0) };
}
