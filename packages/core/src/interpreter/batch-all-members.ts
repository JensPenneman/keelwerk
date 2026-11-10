import type { ConditionInput } from '../conditions/condition-input.ts';
import { normalizeCondition } from '../conditions/normalize-condition.ts';
import { errors } from '../errors/errors.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { RecordedRead } from '../events/recorded-read.ts';
import type { AnswerContext } from '../kernel/answer-context.ts';
import type { AllRequest } from '../protocol/all-request.ts';
import type { LoadRequest } from '../protocol/load-request.ts';
import { answerAll } from './answer-all.ts';
import type { AnswerDeps } from './answer-deps.ts';
import { assertLoadVisible } from './assert-load-visible.ts';
import { authorityOf } from './authority-of.ts';
import { createRequest } from './create-request.ts';
import { isRequest } from './is-request.ts';
import { refuseRequest } from './refuse-request.ts';

/** The most rows one `many` load answers (section 7.9.3); a group splits into chunks of at most this many distinct ids. */
const batchLimit = 1000;

/** The canonical lowercase uuid form the database returns; any other spelling is answered alone with the exact `byId` semantics. */
const canonicalId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The id a member asks for when it can join a batch: `byId(<string>)`, or `one` whose where normalises to `{ op: 'eq', field: 'id', value: <string> }`; else undefined. Never throws. */
function batchIdOf(member: LoadRequest): string | undefined {
  try {
    const [first] = member.args;
    if (member.op === 'byId')
      return typeof first === 'string' && canonicalId.test(first) ? first : undefined;
    if (member.op !== 'one') return undefined;
    const { where } = (first ?? {}) as { readonly where?: unknown };
    if (typeof where !== 'object' || where === null) return undefined;
    const condition = normalizeCondition(where as ConditionInput);
    if (
      condition.op === 'eq' &&
      condition.field === 'id' &&
      typeof condition.value === 'string' &&
      canonicalId.test(condition.value)
    ) {
      return condition.value;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** `<module>.<entity>\n<view>\n<authority>` for a member that can join a batch: a load, `forUpdate` false, a `batchIdOf` id, and `assertLoadVisible` passes (caught: a refused member is not batchable); else undefined. */
function batchKeyOf(member: unknown, context: AnswerContext, deps: AnswerDeps): string | undefined {
  if (!isRequest(member) || member.kind !== 'load' || member.forUpdate) return undefined;
  if (batchIdOf(member) === undefined) return undefined;
  try {
    assertLoadVisible(member, context, deps.authorities);
  } catch {
    return undefined;
  }
  const authority = authorityOf(deps.authorities, member, context.module);
  return `${member.module}.${member.entity}\n${member.view}\n${authority}`;
}

interface Settled {
  readonly read: RecordedRead;
  readonly row: unknown;
}

/** One derived `many` load for a chunk of ids; undefined when the load is refused, so the member answers alone. */
async function answerBatch(
  first: LoadRequest,
  ids: readonly string[],
  context: AnswerContext,
  deps: AnswerDeps,
): Promise<
  { readonly read: RecordedRead; readonly byId: ReadonlyMap<string, unknown> } | undefined
> {
  const authority = authorityOf(deps.authorities, first, context.module);
  const derived = createRequest<LoadRequest>(
    deps.authorities,
    {
      kind: 'load',
      module: first.module,
      entity: first.entity,
      op: 'many',
      args: [{ where: { id: { in: ids } }, limit: ids.length }],
      view: first.view,
      forUpdate: false,
    },
    authority,
  );
  const captured: RecordedRead[] = [];
  const capturing: AnswerContext = {
    ...context,
    record: { ...context.record, read: (read) => captured.push(read) },
  };
  let answered: unknown;
  try {
    answered = await deps.answerer.load(derived, capturing);
  } catch (failure) {
    if (failure instanceof KeelwerkError && failure.code === 'core.request_not_allowed') {
      return undefined;
    }
    throw failure;
  }
  const [read] = captured;
  if (captured.length !== 1 || read === undefined) {
    throw errors.internal(
      `A batched load of "${first.module}.${first.entity}" recorded ${captured.length} reads; one was expected.`,
    );
  }
  const byId = new Map<string, unknown>();
  for (const row of answered as readonly { readonly id: unknown }[]) {
    byId.set(String(row.id), row);
  }
  return { read, byId };
}

/**
 * Answers `ctx.all` (section 7.9.3: "answered together, batched where the adapter can"; open
 * point 472, S-138). Members that are unlocked `byId` loads, or `one` loads whose where is an
 * equality on `id`, of the same entity, view and authority are answered by one positioned `many`
 * load with `{ id: { in: ids } }` through `deps.answerer.load`; every other member is answered on
 * its own through `context.answer`, in order. Each member records its read at its own turn, so the
 * decision record holds one read per member in member order, each batched member at its batch's
 * position. With no group of two or more it is `answerAll`.
 */
export async function batchAllMembers(
  request: AllRequest,
  context: AnswerContext,
  deps: AnswerDeps,
): Promise<readonly unknown[]> {
  const members = request.requests;
  const keys = members.map((member) => batchKeyOf(member, context, deps));
  const counts = new Map<string, number>();
  for (const key of keys) {
    if (key !== undefined) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (![...counts.values()].some((count) => count >= 2)) return answerAll(request, context);

  const settledAt = new Map<number, Settled>();
  const answers: unknown[] = [];
  for (const [index, member] of members.entries()) {
    if (!isRequest(member)) throw refuseRequest('all', 'every member must be a request');
    const key = keys[index];
    if (key === undefined || (counts.get(key) ?? 0) < 2) {
      answers[index] = await context.answer(member);
      continue;
    }
    if (!settledAt.has(index)) {
      const chunk: number[] = [];
      const ids = new Set<string>();
      for (let next = index; next < members.length; next++) {
        if (keys[next] !== key || settledAt.has(next)) continue;
        const id = batchIdOf(members[next] as LoadRequest) as string;
        if (!ids.has(id) && ids.size >= batchLimit) break;
        ids.add(id);
        chunk.push(next);
      }
      const rows = await answerBatch(member as LoadRequest, [...ids], context, deps);
      if (rows === undefined) {
        answers[index] = await context.answer(member);
        continue;
      }
      for (const next of chunk) {
        const id = batchIdOf(members[next] as LoadRequest) as string;
        settledAt.set(next, { read: rows.read, row: rows.byId.get(id) });
      }
    }
    const settled = settledAt.get(index) as Settled;
    context.record.read(settled.read);
    answers[index] = settled.row;
  }
  return answers;
}
