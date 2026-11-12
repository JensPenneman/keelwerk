import { allOf } from '../authorization/all-of.ts';
import { createRowMatcher } from '../authorization/create-row-matcher.ts';
import type { Condition } from '../conditions/condition.ts';
import { sha256 } from '../crypto/sha256.ts';
import { errors } from '../errors/errors.ts';
import type { StateToken } from '../events/state-token.ts';
import { collectChangedStreams } from '../generated-actions/collect-changed-streams.ts';
import { disclosureRule } from '../generated-actions/disclosure-rule.ts';
import { earlierImagesOf } from '../generated-actions/earlier-images-of.ts';
import type { GeneratedReadInput } from '../generated-actions/generated-read-input.ts';
import { invalidArgument } from '../generated-actions/invalid-argument.ts';
import { projectRow } from '../generated-actions/project-row.ts';
import { readSession } from '../generated-actions/read-session.ts';
import { readSort } from '../generated-actions/read-sort.ts';
import { readableBefore } from '../generated-actions/readable-before.ts';
import { principalContextOf } from '../interpreter/principal-context-of.ts';
import { canonicalizeJson } from '../json/canonicalize-json.ts';
import type { LiveKernel } from '../live/live-kernel.ts';
import type { LiveView } from '../live/live-view.ts';
import type { WatchInput } from '../live/watch-input.ts';
import type { Span } from '../observability/span.ts';
import { isProcessStream } from '../reactions/is-process-stream.ts';
import { callerView } from '../repositories/caller-view.ts';
import type { Position } from '../storage/position.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { Unit } from '../storage/unit.ts';
import { assertTokenScope } from '../tokens/assert-token-scope.ts';
import { currentTokenCheck } from '../tokens/current-token-check.ts';
import { decodeStateToken } from '../tokens/decode-state-token.ts';
import { encodeStateToken } from '../tokens/encode-state-token.ts';
import { tokenCheckHolds } from '../tokens/token-check-holds.ts';
import { tokenScopePart } from '../tokens/token-scope-part.ts';
import type { TokenSelector } from '../tokens/token-selector.ts';
import { encodeEventValue } from '../write-path/encode-event-value.ts';
import type { InvocationSession } from './invocation-session.ts';
import type { InvokerEnv } from './invoker-env.ts';
import { liveFilterGuard } from './live-filter-guard.ts';
import { liveTokenContextOf } from './live-token-context-of.ts';
import { parseWatchInput } from './parse-watch-input.ts';
import { sameSession } from './same-session.ts';
import type { SessionDetails } from './session-details.ts';
import { targetOf } from './stages/target-of.ts';
import { watchActionOf } from './watch-action-of.ts';

/**
 * The kernel access of one entity in one session's scope (15.4.3, 15.4.9): the target's read-only
 * units with the kernel's authority, and the views of a subscriber over it. A view holds what is
 * built once per subscriber: the plan compiled for the principal, the selection, the token check
 * and the quantifier answers of a unit. An `invocation` entity (command receipts, effects) is
 * followed in the session's own scope. `internal` for an entity the app lacks; `unsupported` for a
 * deployment-level scope, which has no id the change feed names.
 */
export function createLiveKernel(
  env: InvokerEnv,
  session: InvocationSession,
  details: SessionDetails,
  entity: string,
  span?: Pick<Span, 'setAttribute'>,
): LiveKernel {
  const app = env.appOf(details.resolved.app);
  const { registry } = app;
  const entry = registry.entities.get(entity);
  if (entry === undefined) throw errors.internal(`"${entity}" is not an entity of this app.`);
  const action = watchActionOf(app, entry);
  const target = targetOf(action, details);
  const { scope } = target;
  if (scope.level === 'deployment') {
    throw errors.unsupported('The changes of a deployment-level scope cannot be followed.');
  }
  const scopeId = scope.level === 'tenant' ? scope.tenantId : scope.backendId;
  const log = env.options.log.child({
    backend: scope.backendId,
    ...(scope.level === 'tenant' ? { tenant: scope.tenantId } : {}),
  });
  const rules = env.rulesOf(registry);
  const epoch = env.options.epochOf === undefined ? 0 : env.options.epochOf(scope);

  const guard = liveFilterGuard(registry, entry);
  /** The views `prepare` built, by the input object they were built for: each is answered once. */
  const prepared = new WeakMap<object, LiveView>();

  const build = async (other: InvocationSession, input: WatchInput<unknown>): Promise<LiveView> => {
    const otherDetails = env.sessions.detailsOf(other);
    if (otherDetails === undefined || !sameSession(other, session)) {
      throw errors.internal('The session is not one this subscription may use.');
    }
    const parsed = parseWatchInput(entry, input);
    // A rule that grants `watch` on such an entity grants the follow of rows by their id only (as it grants `get`), never their enumeration.
    if (entry.descriptor.tenancy === 'invocation' && parsed.ids === undefined) {
      throw invalidArgument('ids', `"${entity}" is followed by the ids of its rows: name them.`);
    }
    if (parsed.filter !== undefined) await guard.check(parsed.filter);
    const { flags, tokens } = await liveTokenContextOf({
      env,
      registry,
      rules,
      action,
      other,
      otherDetails,
      scope,
      epoch,
      log,
      span,
    });
    const caller = callerView({
      entry,
      rules,
      action,
      context: principalContextOf(registry, other.principal, scope, flags),
    });
    const { plan } = caller;
    const idsCondition: Condition | undefined =
      parsed.ids === undefined ? undefined : { op: 'in', field: 'id', value: [...parsed.ids] };
    const wanted = [parsed.filter, idsCondition].filter(
      (condition): condition is Condition => condition !== undefined,
    );
    const selection = caller.select(wanted.length === 0 ? undefined : allOf(wanted), []);
    const planKey = sha256(
      canonicalizeJson(
        encodeEventValue({
          kind: plan.kind,
          where: plan.where,
          maskable: [...plan.maskable].sort(),
          allows: plan.allows.map((clause) => ({
            rule: clause.rule,
            where: clause.where,
            fields: clause.fields === null ? null : [...clause.fields].sort(),
          })),
          fieldDenies: plan.fieldDenies.map((clause) => ({
            rule: clause.rule,
            where: clause.where,
            fields: clause.fields === null ? null : [...clause.fields].sort(),
          })),
        }),
      ),
    );
    const readInput = (unit: Unit): GeneratedReadInput => ({
      unit,
      registry,
      entry,
      action,
      principal: other.principal,
      rules,
      tokens,
      scope,
      input,
      head: 0n,
    });
    const partitionField = entry.descriptor.partition;
    const defaultSort = readSort(undefined, entry);
    const partitionOnly: TokenSelector =
      parsed.partition === undefined ? {} : { partition: parsed.partition };
    const read: TokenSelector = {
      ...partitionOnly,
      ...(parsed.filter === undefined
        ? {}
        : { query: { filter: parsed.filter, sort: defaultSort } }),
    };
    const stream: TokenSelector = {
      ...read,
      live: {
        apiVersion: other.apiVersion,
        ...(parsed.ids === undefined ? {} : { ids: [...parsed.ids] }),
        ...(parsed.fields === undefined ? {} : { fields: [...parsed.fields] }),
        includeArchived: parsed.includeArchived,
      },
    };
    const checks = {
      stream: currentTokenCheck(tokens, entity, scope, stream),
      // What `get` and `changes` answer as `state` (the partition alone), and `query` as
      // `queryState` with the watch's filter and the default sort.
      accepted: new Set([
        currentTokenCheck(tokens, entity, scope, partitionOnly),
        currentTokenCheck(tokens, entity, scope, {
          ...partitionOnly,
          query: { filter: parsed.filter, sort: defaultSort },
        }),
      ]),
    };
    const scopePart = tokenScopePart(scope);
    return {
      entity,
      planKey,
      from: parsed.from,
      after: parsed.after,
      includeArchived: parsed.includeArchived,
      partition: parsed.partition,
      selection,
      inPlan: async (unit: Unit, rows: readonly StorageRow[]) => {
        if (rows.length === 0) return [];
        const { answerer } = readSession(readInput(unit));
        const matches = await createRowMatcher([plan.where], rows, { entity, answerer });
        return rows.map((row) => matches(plan.where, row));
      },
      inFilter: (row: StorageRow) => {
        if (parsed.ids !== undefined && !parsed.ids.has(String(row.id))) return false;
        if (parsed.partition !== undefined) {
          if (partitionField === null || String(row[partitionField]) !== parsed.partition) {
            return false;
          }
        }
        return parsed.filter === undefined || guard.matches(parsed.filter, row);
      },
      inIds: (id: string) => parsed.ids === undefined || parsed.ids.has(id),
      earlier: async (unit, request) => {
        const found = await readableBefore({
          unit,
          registry,
          entry,
          since: request.since,
          where: plan.where,
          ids: request.ids,
          skipArchived: false,
          images: earlierImagesOf(request.share, { unit, registry, entry, since: request.since }),
        });
        return { rows: found.rows, uncertain: found.uncertain };
      },
      present: (unit: Unit, rows: readonly StorageRow[]) =>
        rows.length === 0 ? Promise.resolve([]) : readSession(readInput(unit)).present(rows),
      project: (row: StorageRow) => projectRow(row, parsed.fields),
      token: (position: Position) =>
        encodeStateToken(
          { epoch, position, scope: scopePart, check: checks.stream },
          tokens.sealKey,
        ),
      judge: (token: string, head: Position) => {
        const parts = decodeStateToken(token);
        assertTokenScope(parts, scope);
        if (parts.epoch !== epoch) return 'resync';
        if (
          ![checks.stream, ...checks.accepted].some((check) =>
            tokenCheckHolds(parts, check, tokens.sealKey),
          )
        ) {
          return 'resync';
        }
        return parts.position > head ? 'resync' : parts.position;
      },
      replay: async (unit, replay) => {
        const found = await collectChangedStreams({
          unit,
          entry,
          since: replay.since,
          head: replay.head,
          partition: parsed.partition,
          maxStreams: replay.maxStreams,
        });
        const verdict = await disclosureRule({
          unit,
          registry,
          entry,
          since: replay.since,
          where: selection,
          streams: found.streams,
          earlier: 'unreadable',
          includeArchived: parsed.includeArchived,
        });
        const now = new Map<string, { readonly createdAfter: boolean }>();
        const lost = new Set<string>();
        for (const [id, stream] of found.streams) {
          if (verdict.now.has(id)) now.set(id, stream);
          else if (verdict.before.has(id)) lost.add(id);
        }
        return {
          now,
          lost,
          uncertain: verdict.uncertain,
          through: found.through,
          hasMore: found.hasMore,
        };
      },
    };
  };

  const view = (other: InvocationSession, input: WatchInput<unknown>): Promise<LiveView> => {
    const kept = prepared.get(input);
    if (kept === undefined || other !== session) return build(other, input);
    prepared.delete(input);
    return Promise.resolve(kept);
  };

  const prepare = async (
    input: WatchInput<unknown>,
    resume: StateToken | undefined,
  ): Promise<LiveView> => {
    const built = await build(session, input);
    if (resume !== undefined) assertTokenScope(decodeStateToken(resume), scope);
    prepared.set(input, built);
    return built;
  };

  return {
    entity,
    descriptor: entry.descriptor,
    scopeId,
    audience: session.scope.level === 'tenant' ? session.scope.tenantId : scopeId,
    target,
    log,
    isProcessStream: (streamType) => isProcessStream(registry, streamType),
    read: (fn, options) =>
      target.handle.adapter.unit(target.namespace, scope, fn, {
        readOnly: true,
        timeoutMs: options.timeoutMs,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      }),
    view,
    prepare,
  };
}
