import { allOf } from '../authorization/all-of.ts';
import { checkItem } from '../authorization/check-item.ts';
import { compilePlan } from '../authorization/compile-plan.ts';
import { createRowMatcher } from '../authorization/create-row-matcher.ts';
import { evaluateGate } from '../authorization/evaluate-gate.ts';
import { forbiddenError } from '../authorization/forbidden-error.ts';
import { itemAction } from '../authorization/item-action.ts';
import { conditionFields } from '../conditions/condition-fields.ts';
import { errors } from '../errors/errors.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { chainSelect } from '../events/chain-select.ts';
import type { StandardSchemaV1 } from '../fields/standard-schema-v1.ts';
import { principalContextOf } from '../interpreter/principal-context-of.ts';
import type { AnyDraft } from '../protocol/any-draft.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import { createEntityRepository } from '../repositories/entity-repository.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { Unit } from '../storage/unit.ts';
import { assertTokenScope } from '../tokens/assert-token-scope.ts';
import { currentTokenCheck } from '../tokens/current-token-check.ts';
import { decodeStateToken } from '../tokens/decode-state-token.ts';
import { issueStateToken } from '../tokens/issue-state-token.ts';
import type { OpenedDecision } from '../write-path/open-decision.ts';
import type { RunCommandInput } from '../write-path/run-command-input.ts';
import { argumentsOf } from './arguments-of.ts';
import { createDraftOf } from './create-draft-of.ts';
import { instanceDraftOf } from './instance-draft-of.ts';
import { isRowId } from './is-row-id.ts';
import { readString } from './read-string.ts';

type Operation = 'create' | 'update' | 'archive' | 'restore';

function invalid(path: string, message: string): KeelwerkError {
  return errors.validation(message, { issues: [{ path: [path], message }] });
}

function itemError(error: unknown): { kind: string; code: string; message: string } {
  if (error instanceof KeelwerkError) {
    return { kind: error.kind, code: error.code, message: error.message };
  }
  throw error;
}

function recordOf(value: unknown, path: string): Readonly<Record<string, unknown>> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value))
    throw invalid(path, 'It must be an object.');
  return value as Readonly<Record<string, unknown>>;
}

/** An operation's items: a list; absent is empty. */
function listOf(value: unknown, path: string): readonly unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw invalid(path, 'It must be a list.');
  return value;
}

/** The id an instance item names. */
function idOf(item: Readonly<Record<string, unknown>>, path: string): string {
  if (typeof item.id !== 'string') throw invalid(`${path}.id`, 'An id must be a string.');
  return item.id;
}

/** The `ifVersion` of an item: absent, or an integer. */
function versionOf(item: Readonly<Record<string, unknown>>, path: string): number | undefined {
  if (item.ifVersion === undefined || item.ifVersion === null) return undefined;
  if (typeof item.ifVersion !== 'number' || !Number.isInteger(item.ifVersion)) {
    throw invalid(`${path}.ifVersion`, 'It must be an integer.');
  }
  return item.ifVersion;
}

/** An item checked against the schema of its operation (the one the single action uses); the validated value. */
async function validated(
  schema: StandardSchemaV1 | undefined,
  value: unknown,
  path: string,
): Promise<Readonly<Record<string, unknown>>> {
  if (schema === undefined) throw errors.unsupported(`${path} is switched off for this entity.`);
  const result = await schema['~standard'].validate(value);
  if (result.issues !== undefined) {
    throw errors.validation('The item is not valid.', {
      issues: result.issues.map((issue) => ({
        path: [
          path,
          ...(issue.path ?? []).map((part) => String(typeof part === 'object' ? part.key : part)),
        ],
        message: issue.message,
      })),
    });
  }
  return recordOf(result.value, path);
}

/** The collection-level `ifInState` (section 6.7): refused unless nothing of the type changed after the token. */
async function assertState(input: GeneratedSetInput, token: string): Promise<void> {
  const { run, unit, entry } = input;
  const scope = run.scope;
  const parts = decodeStateToken(token);
  assertTokenScope(parts, scope);
  const context = {
    registry: run.registry,
    rules: run.rules,
    principal: run.principal,
    epoch: run.epoch ?? 0,
  };
  const stale =
    parts.epoch !== context.epoch ||
    parts.check !== currentTokenCheck(context, entry.ref, scope) ||
    ((await unit.events.head({ streamTypes: [entry.ref] })) ?? 0n) > parts.position;
  if (stale) {
    throw new KeelwerkError({
      kind: 'conflict',
      code: 'core.state_mismatch',
      message: 'The collection changed since the expected state.',
      details: { ifInState: true, entity: entry.ref },
    });
  }
}

/** What the batch is decided with: the write path's run, its unit and the open decision. */
export interface GeneratedSetInput {
  readonly run: RunCommandInput;
  readonly unit: Unit;
  readonly entry: EntityEntry;
  readonly decision: OpenedDecision;
}

/**
 * The generated `set` (section 6.7): `create`, `update` (a patch), `archive` and `restore` of many
 * rows in one unit, each item validated against the schema of the single action, and authorized
 * against its own operation (the gate per operation, the selection of the target through its
 * plan, the item check after the write), with per-item `ifVersion` and a collection-level
 * `ifInState`. An item that fails before it writes is listed under `failed` with its operation,
 * its id when it has one, and the error; the rest commit. A failure after the write (the item
 * check of a created row) fails the unit. Neither `ifVersion` nor `ifInState` is retried.
 */
export async function generatedSet(input: GeneratedSetInput): Promise<unknown> {
  const { run, unit, entry, decision } = input;
  const args = argumentsOf(run.input);
  const token = readString(args.ifInState, 'ifInState');
  if (token !== undefined) await assertState(input, token);
  const oldState = issueStateToken(
    { registry: run.registry, rules: run.rules, principal: run.principal, epoch: run.epoch ?? 0 },
    entry.ref,
    run.scope,
    (await unit.events.head()) ?? 0n,
  );

  const context = principalContextOf(run.registry, run.principal, run.scope);
  const setAction = run.action;
  const allowed = new Map<Operation, KeelwerkError | undefined>();
  const gate = (operation: Operation): KeelwerkError | undefined => {
    if (!allowed.has(operation)) {
      const action = itemAction(setAction, operation);
      const verdict = evaluateGate({
        rules: run.rules,
        action,
        context,
        transport: null,
        input: run.input,
      });
      allowed.set(
        operation,
        verdict.allowed
          ? undefined
          : forbiddenError({ rules: verdict.rules, reason: verdict.reason, action: action.ref }),
      );
    }
    return allowed.get(operation);
  };
  const schemaOf = (operation: 'create' | 'update'): StandardSchemaV1 | undefined =>
    run.registry.actions.get(`${entry.ref}.${operation}`)?.input;

  const events: AnyDraft[] = [];
  const ids = {
    created: [] as string[],
    updated: [] as string[],
    archived: [] as string[],
    restored: [] as string[],
  };
  const failed: { operation: Operation; id?: string; code: string; message: string }[] = [];
  const fail = (operation: Operation, id: string | undefined, error: unknown): void => {
    const { code, message } = itemError(error);
    failed.push({ operation, ...(id === undefined ? {} : { id }), code, message });
  };
  const used = new Set<string>();

  for (const [index, raw] of listOf(args.create, 'create').entries()) {
    try {
      if (!entry.generated.includes('create')) {
        throw errors.unsupported(`create.${index} is switched off for this entity.`);
      }
      const refusal = gate('create');
      if (refusal !== undefined) throw refusal;
      const values = await validated(schemaOf('create'), raw, `create.${index}`);
      const id = (await decision.drive(
        (decision.ctx as { newId(entity: string): unknown }).newId(entry.ref),
      )) as string;
      const plan = compilePlan({
        rules: run.rules,
        action: itemAction(setAction, 'create'),
        entity: entry.descriptor,
        context,
      });
      const conditions = [...plan.allows, ...plan.denies].map((clause) => clause.where);
      if (conditions.every((condition) => conditionFields(condition).quantifiers.length === 0)) {
        const row: StorageRow = { ...run.behaviours(entry.ref)?.defaults, ...values, id };
        const matches = await createRowMatcher(conditions, [row], { entity: entry.ref });
        const verdict = checkItem(plan, { post: row, matchers: { post: matches } });
        if (!verdict.allowed) {
          throw forbiddenError({
            rules: verdict.rules,
            reason: verdict.reason,
            action: `${entry.ref}.create`,
          });
        }
      }
      events.push(createDraftOf(entry.ref, id, values));
      used.add(id);
      ids.created.push(id);
    } catch (error) {
      fail('create', undefined, error);
    }
  }

  const transition = async (
    operation: Exclude<Operation, 'create'>,
    raw: unknown,
    path: string,
    draftOf: (row: StorageRow, item: Readonly<Record<string, unknown>>) => Promise<AnyDraft>,
    into: string[],
  ): Promise<void> => {
    let id: string | undefined;
    try {
      const item = recordOf(raw, path);
      id = idOf(item, path);
      const ifVersion = versionOf(item, path);
      const refusal = gate(operation);
      if (refusal !== undefined) throw refusal;
      if (used.has(id)) throw invalid(`${path}.id`, 'An id can be named once in a set.');
      if (!isRowId(id)) throw errors.not_found(`${entry.ref} ${id} does not exist`);
      const plan = compilePlan({
        rules: run.rules,
        action: itemAction(setAction, operation),
        entity: entry.descriptor,
        context,
      });
      const found = await createEntityRepository(unit, entry).find({
        where: allOf([{ op: 'eq', field: 'id', value: id }, plan.where]),
        select: chainSelect(Object.keys(entry.descriptor.fields)),
        page: { first: 1 },
        forUpdate: true,
        ...(operation === 'restore' ? { includeArchived: true } : {}),
      });
      const row = found.rows[0];
      if (row === undefined) throw errors.not_found(`${entry.ref} ${id} does not exist`);
      decision.reads.push({ at: found.position });
      if (ifVersion !== undefined && Number(row.version) !== ifVersion) {
        throw new KeelwerkError({
          kind: 'conflict',
          code: 'core.version_mismatch',
          message: 'The row is not at the version the request named.',
          details: { ifVersion: true, entity: entry.ref, id },
        });
      }
      if (operation === 'restore' && (row.archivedAt === undefined || row.archivedAt === null)) {
        throw invalid(`${path}.id`, 'The row is not archived.');
      }
      events.push(await draftOf(row, item));
      used.add(id);
      into.push(id);
    } catch (error) {
      fail(operation, id, error);
    }
  };

  for (const [index, raw] of listOf(args.update, 'update').entries()) {
    await transition(
      'update',
      raw,
      `update.${index}`,
      async (row, item) => {
        const patch = recordOf(item.patch, `update.${index}.patch`);
        const checked = await validated(
          schemaOf('update'),
          { id: String(row.id), patch },
          `update.${index}`,
        );
        return instanceDraftOf('update', entry.ref, row, recordOf(checked.patch, 'patch'));
      },
      ids.updated,
    );
  }
  for (const operation of ['archive', 'restore'] as const) {
    const into = operation === 'archive' ? ids.archived : ids.restored;
    for (const [index, raw] of listOf(args[operation], operation).entries()) {
      await transition(
        operation,
        raw,
        `${operation}.${index}`,
        async (row) => instanceDraftOf(operation, entry.ref, row, {}),
        into,
      );
    }
  }
  return { events, result: { oldState, ...ids, failed } };
}
