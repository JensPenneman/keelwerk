import { errors } from '../errors/errors.ts';
import { issueStateToken } from '../tokens/issue-state-token.ts';
import { argumentsOf } from './arguments-of.ts';
import { collectChangedStreams } from './collect-changed-streams.ts';
import { disclosureRule } from './disclosure-rule.ts';
import type { GeneratedRead } from './generated-read-input.ts';
import { readSession } from './read-session.ts';
import { readSinceToken } from './read-since-token.ts';
import { readSize } from './read-size.ts';
import { readString } from './read-string.ts';

/**
 * The generated `changes` (section 6.7, algorithm of 15.2.6): the ids created, changed and
 * archived since a `state` token, and the new token. An id the principal never could read is
 * never reported, a row they lost is reported `archived` once, and when the evidence is
 * insufficient (another epoch or visibility, a position past the head, an uncertain stream) the
 * answer is `cannotCalculateChanges` with a fresh `newState`, so the client re-queries.
 */
export const generatedChanges: GeneratedRead = async (input) => {
  const { entry, unit } = input;
  const args = argumentsOf(input.input);
  const sinceState = readString(args.since, 'since');
  if (sinceState === undefined) {
    throw errors.validation('changes needs a since.', {
      issues: [{ path: ['since'], message: 'Required.' }],
    });
  }
  const maxChanges = readSize(args.max, 'max', entry.page.maxSize) ?? entry.page.maxSize;
  const partition = readString(args.partition, 'partition');
  const head = input.head;
  const fresh = (): string =>
    issueStateToken(
      input.tokens,
      entry.ref,
      input.scope,
      head,
      partition === undefined ? {} : { partition },
    );
  const since = readSinceToken(input, sinceState, partition === undefined ? {} : { partition });
  if (!since.ok) return { cannotCalculateChanges: true, reason: since.reason, newState: fresh() };

  const changed = await collectChangedStreams({
    unit,
    entry,
    since: since.position,
    head,
    partition,
    maxStreams: maxChanges,
  });
  const session = readSession(input);
  const verdict = await disclosureRule({
    unit,
    registry: input.registry,
    entry,
    since: since.position,
    where: session.view.plan.where,
    streams: changed.streams,
    earlier: 'unreadable',
  });
  if (verdict.uncertain)
    return { cannotCalculateChanges: true, reason: 'uncertain', newState: fresh() };
  const created: string[] = [];
  const changedIds: string[] = [];
  const archived: string[] = [];
  for (const [id, stream] of changed.streams) {
    if (verdict.now.has(id)) (stream.createdAfter ? created : changedIds).push(id);
    else if (verdict.before.has(id)) archived.push(id);
  }
  return {
    oldState: sinceState,
    newState: issueStateToken(
      input.tokens,
      entry.ref,
      input.scope,
      changed.hasMore ? changed.through : head,
      partition === undefined ? {} : { partition },
    ),
    hasMoreChanges: changed.hasMore,
    created,
    changed: changedIds,
    archived,
  };
};
