import type { Condition } from '../conditions/condition.ts';
import { errors } from '../errors/errors.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { EntityDescriptor } from '../storage/entity-descriptor.ts';
import { eqTag } from './eq-tag.ts';
import { normalizedText } from './normalized-text.ts';
import { normalizerOf } from './normalizer-of.ts';
import { personalOperatorError } from './personal-operator-error.ts';
import type { PlannedCondition } from './planned-condition.ts';
import type { SealingContext } from './sealing-context.ts';

interface State {
  touched: boolean;
  scan: boolean;
  approximate: boolean;
  quantified: boolean;
}

const fullBits = 128;

function codePoints(text: string): number {
  return [...text].length;
}

/** The entity a (possibly dotted) relation path reaches, or `undefined` when a hop is unknown. */
function relatedEntity(
  context: SealingContext,
  entity: EntityDescriptor,
  path: string,
): EntityDescriptor | undefined {
  let current: EntityDescriptor | undefined = entity;
  for (const hop of path.split('.')) {
    const relation: EntityDescriptor['relations'][string] | undefined = current?.relations[hop];
    if (relation === undefined) return undefined;
    current = context.describe(relation.target);
  }
  return current;
}

async function leaf(
  context: SealingContext,
  state: State,
  entity: EntityDescriptor,
  condition: Extract<Condition, { readonly field: string }>,
  positive: boolean,
  exact: boolean,
): Promise<Condition> {
  const { field: name, op } = condition;
  const field = Object.hasOwn(entity.fields, name) ? entity.fields[name] : undefined;
  if (field === undefined || field.personal === false) return condition;
  const { personal } = field;
  if (op === 'isNull') return condition;
  const refuse = (why: string): KeelwerkError => personalOperatorError(entity.ref, name, op, why);
  if (op === 'startsWith') {
    if (!personal.queries.includes('prefix')) throw refuse('it declares no prefix');
    if (!positive || exact) throw refuse('a prefix runs only in a positive position of the query');
    const operand = condition.value;
    if (typeof operand !== 'string') {
      throw errors.validation(`${entity.ref}.${name}: startsWith takes text.`);
    }
    const text = normalizerOf(context, personal).normalize(operand);
    if (codePoints(text) < personal.params.prefix.min) {
      throw new KeelwerkError({
        kind: 'unsupported',
        code: 'core.personal_needle_short',
        message: `${entity.ref}.${name}: a prefix needs at least ${personal.params.prefix.min} characters.`,
        issues: [{ path: [name], message: `At least ${personal.params.prefix.min} characters.` }],
      });
    }
    state.touched = true;
    state.scan = true;
    // The rows the rest of the condition selects, present at least; the unsealed value decides.
    return { op: 'isNull', field: name, value: false };
  }
  if (op !== 'eq' && op !== 'ne' && op !== 'in' && op !== 'nin') {
    throw refuse(
      op === 'contains'
        ? 'it declares no contains'
        : 'order needs the order capability, which arrives with M5',
    );
  }
  const derived = Object.values(entity.derivedIndexes).find(
    (index) => index.field === name && index.query === 'eq',
  );
  if (derived === undefined) throw refuse('it declares no eq');
  const truncated = personal.params.eq.bits < fullBits;
  if (truncated && (exact || !positive || op === 'ne' || op === 'nin')) {
    throw refuse('a truncated equality tag answers only a positive position of the query');
  }
  const normalizer = normalizerOf(context, personal);
  const key = await context.indexKeys.fieldKey(entity, name, personal, derived);
  const tagOf = (operand: unknown): Uint8Array => {
    const text = normalizedText(field, normalizer, operand);
    if (text === undefined) {
      throw errors.validation(`${entity.ref}.${name}: the ${op} operand is not a ${field.kind}.`, {
        issues: [{ path: [name], message: `Not a ${field.kind}.` }],
      });
    }
    return eqTag(key, text, personal.params.eq.bits);
  };
  state.touched = true;
  if (truncated) state.approximate = true;
  if (op === 'in' || op === 'nin') {
    const list = condition.value;
    if (!Array.isArray(list)) throw errors.validation(`${entity.ref}.${name}: ${op} takes a list.`);
    return { op, field: derived.column, value: list.map(tagOf) };
  }
  return { op, field: derived.column, value: tagOf(condition.value) };
}

async function walk(
  context: SealingContext,
  state: State,
  entity: EntityDescriptor,
  condition: Condition,
  positive: boolean,
  exact: boolean,
): Promise<Condition> {
  switch (condition.op) {
    case 'never':
      return condition;
    case 'and':
    case 'or': {
      const inner: Condition[] = [];
      for (const part of condition.conditions) {
        inner.push(await walk(context, state, entity, part, positive, exact));
      }
      return { op: condition.op, conditions: inner };
    }
    case 'not':
      return {
        op: 'not',
        condition: await walk(context, state, entity, condition.condition, !positive, exact),
      };
    case 'some':
    case 'none':
    case 'every':
    case 'is': {
      state.quantified = true;
      const target = relatedEntity(context, entity, condition.relation);
      if (target === undefined) return condition;
      // The database evaluates the quantifier: exact capabilities only, no verification afterwards.
      return {
        op: condition.op,
        relation: condition.relation,
        where: await walk(context, state, target, condition.where, true, true),
      };
    }
    default:
      return leaf(context, state, entity, condition, positive, exact);
  }
}

/**
 * The encryption planner (14.7.9.5): rewrites the comparisons on personal fields of a condition
 * onto the derived index fields of the entity descriptor. `eq`, `ne`, `in` and `nin` become the same
 * operator on the `__eq` column over the tag of the normalised operand, `isNull` stays on the
 * sealed column, and `startsWith` on a field that declares `prefix` becomes a presence test plus
 * the bounded scan of S-37 (M1 adapters declare no tag sets). Anything else is
 * `core.personal_operator`; a comparison inside a relation quantifier must be exact.
 */
export async function planEncryption(
  context: SealingContext,
  entity: EntityDescriptor,
  condition: Condition,
): Promise<PlannedCondition> {
  const state: State = { touched: false, scan: false, approximate: false, quantified: false };
  const planned = await walk(context, state, entity, condition, true, false);
  if (state.quantified && (state.scan || state.approximate)) {
    throw personalOperatorError(
      entity.ref,
      '*',
      'a relation condition',
      'a prefix or truncated tag cannot be combined with a relation quantifier',
    );
  }
  return {
    condition: planned,
    verify: state.touched && !state.quantified,
    scan: state.scan,
    approximate: state.approximate,
  };
}
