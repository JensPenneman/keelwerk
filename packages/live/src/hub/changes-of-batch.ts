import type { Emitted, EntityChange, LiveView, Position, StoredEvent } from '@keelwerk/core';
import { planGroupKey } from './plan-group-key.ts';
import type { ReaderBatch } from './reader-batch.ts';
import type { VisibilitySet } from './visibility-set.ts';

interface Touched {
  readonly id: string;
  /** Events of the stream in the batch after the floor, in position order. */
  readonly events: StoredEvent[];
}

const lifecycle: ReadonlySet<string> = new Set(['created', 'imported', 'archived', 'restored']);

function lastSegment(type: string): string {
  return type.slice(type.lastIndexOf('.') + 1);
}

function present(value: unknown): boolean {
  return value !== undefined && value !== null;
}

/** What one batch means for one subscriber. */
export interface BatchChanges {
  /** The items to send, in the order of the streams' last positions. */
  readonly items: readonly Emitted<EntityChange<unknown>>[];
  /** Ids the subscriber now holds as visible. */
  readonly visible: readonly string[];
  /** Ids the subscriber was told are gone. */
  readonly gone: readonly string[];
  /** Streams that are not visible now, are not in a partial set and whose plan group has not been asked what it selected before the batch (the reader asks once for the group). */
  readonly unknown: readonly string[];
  /** The judgement said the evidence did not suffice: the stream must reset. */
  readonly uncertain: boolean;
}

/**
 * The items of one batch for one subscriber (15.4.2, 15.4.3 step 3, D6). Per changed stream of the
 * subscriber's entity (and partition, and ids) after `floor`, in the order of its last position: a
 * row that is gone is `removed` `purged`, one outside the plan or the filter `removed` `left-view`,
 * an erased one `removed` `erased`, an archived one `archived` without a row (with its row when
 * archived rows are followed), anything else `created`, `changed` or `restored` with its version, its
 * cause and its presented, projected row. A removal is sent only for an id the set holds. A set that
 * is partial decides the others from what the plan selected before the batch (`batch.earlier`, asked
 * once for the plan group), with the subscriber's own filter applied in memory; a stream no answer
 * covers is returned as `unknown`. Nothing here changes the set: the caller applies `visible` and `gone`.
 */
export function changesOfBatch(input: {
  readonly view: LiveView;
  readonly batch: ReaderBatch;
  readonly set: VisibilitySet;
  readonly floor: Position;
}): BatchChanges {
  const { view, batch, set } = input;
  const touched = new Map<string, Touched>();
  /** Streams that also changed at or before the floor: the state at the start of the batch is not theirs. */
  const beforeFloor = new Set<string>();
  for (const event of batch.events) {
    if (event.stream.type !== view.entity) continue;
    if (view.partition !== undefined && event.partition !== view.partition) continue;
    // A stream outside the subscriber's ids never changes that, so it never was in its view.
    if (!view.inIds(event.stream.id)) continue;
    if (event.position <= input.floor) {
      beforeFloor.add(event.stream.id);
      continue;
    }
    const known = touched.get(event.stream.id) ?? { id: event.stream.id, events: [] };
    known.events.push(event);
    touched.set(event.stream.id, known);
  }
  const rows = batch.rows.get(view.entity);
  const verdicts = batch.verdicts.get(planGroupKey(view));
  const ordered = [...touched.values()].sort((a, b) => {
    const left = a.events.at(-1)?.position ?? 0n;
    const right = b.events.at(-1)?.position ?? 0n;
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const items: Emitted<EntityChange<unknown>>[] = [];
  const visible: string[] = [];
  const gone: string[] = [];
  const unknown: string[] = [];
  let uncertain = false;
  for (const stream of ordered) {
    const last = stream.events.at(-1);
    if (last === undefined) continue;
    const { id } = stream;
    const post = rows?.get(id);
    const state = view.token(last.position);
    const cause = lastSegment(last.type);
    const created = stream.events.some((event) => lastSegment(event.type) === 'created');
    const archived = post !== undefined && present(post.archivedAt);
    const shown = verdicts?.get(id);
    let outcome: 'visible' | 'purged' | 'erased' | 'left-view' | 'archived';
    if (post === undefined) outcome = 'purged';
    else if (shown === undefined || !view.inFilter(post)) outcome = 'left-view';
    else if (present(post.kwErasedAt)) outcome = 'erased';
    else if (archived && !view.includeArchived) outcome = 'archived';
    else outcome = 'visible';
    if (outcome === 'visible' && shown !== undefined && post !== undefined) {
      const delivered = set.has(id);
      const lastLifecycle = stream.events
        .map((event) => lastSegment(event.type))
        .filter((name) => lifecycle.has(name))
        .at(-1);
      const type = archived
        ? 'archived'
        : lastLifecycle === 'created' && !delivered
          ? 'created'
          : lastLifecycle === 'restored'
            ? 'restored'
            : 'changed';
      items.push({
        event: {
          type,
          id,
          version: Number(post.version),
          cause,
          row: view.project(shown),
        } as EntityChange<unknown>,
        state,
      });
      visible.push(id);
      continue;
    }
    if (set.has(id)) {
      items.push({
        event:
          outcome === 'archived'
            ? ({
                type: 'archived',
                id,
                version: Number(post?.version),
                cause,
              } as EntityChange<unknown>)
            : ({
                type: 'removed',
                id,
                reason: outcome === 'purged' || outcome === 'erased' ? outcome : 'left-view',
              } as EntityChange<unknown>),
        state,
      });
      gone.push(id);
      continue;
    }
    if (set.exact || created) continue;
    const asked = batch.earlier.get(planGroupKey(view));
    if (asked === undefined || !asked.asked.has(id)) {
      unknown.push(id);
      continue;
    }
    if (asked.earlier.uncertain || beforeFloor.has(id)) {
      uncertain = true;
      continue;
    }
    const was = asked.earlier.rows.get(id);
    // Held before the batch: selected by the plan, by the subscriber's filter and, unless archived rows are followed, not archived.
    if (
      was === undefined ||
      !view.inFilter(was) ||
      (present(was.archivedAt) && !view.includeArchived)
    ) {
      continue;
    }
    // Lost to the readers of the range, yet only archived and still selected: told as archived (D6).
    items.push({
      event:
        outcome === 'archived'
          ? ({
              type: 'archived',
              id,
              version: Number(post?.version),
              cause,
            } as EntityChange<unknown>)
          : ({ type: 'removed', id, reason: 'left-view' } as EntityChange<unknown>),
      state,
    });
    gone.push(id);
  }
  return { items, visible, gone, unknown, uncertain };
}
