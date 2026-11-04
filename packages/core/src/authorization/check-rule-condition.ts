import type { Condition } from '../conditions/condition.ts';
import { compositionRefusal } from '../dsl/composition-refusal.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { EntityDescriptor } from '../storage/entity-descriptor.ts';

const systemFields: ReadonlySet<string> = new Set([
  'id',
  'version',
  'createdAt',
  'updatedAt',
  'archivedAt',
]);
const orderOps: ReadonlySet<string> = new Set(['lt', 'lte', 'gt', 'gte']);
const equalityOps: ReadonlySet<string> = new Set(['eq', 'ne', 'in', 'nin']);
const approximateOrderKinds: ReadonlySet<string> = new Set(['string', 'text', 'enum']);

function personalOperator(rule: string, field: string, op: string, why: string): KeelwerkError {
  return new KeelwerkError({
    kind: 'unsupported',
    code: 'core.personal_operator',
    message: `Rule "${rule}": the personal field "${field}" does not support ${op} in a rule (${why}).`,
    issues: [{ path: [field], message: `${op}: ${why}` }],
  });
}

function checkPersonal(rule: string, entity: EntityDescriptor, field: string, op: string): void {
  const descriptor = entity.fields[field];
  if (descriptor === undefined || descriptor.personal === false) return;
  const queries = descriptor.personal.queries;
  if (op === 'isNull') return;
  if (equalityOps.has(op)) {
    if (!queries.includes('eq')) throw personalOperator(rule, field, op, 'it declares no eq');
    return;
  }
  if (op === 'startsWith') {
    // The kernel evaluates a prefix in memory over the rows the rest of the condition selects (S-37).
    if (!queries.includes('prefix'))
      throw personalOperator(rule, field, op, 'it declares no prefix');
    return;
  }
  if (op === 'contains') {
    const element = descriptor.kind === 'set' || descriptor.kind === 'list';
    if (element && (queries.includes('eq') || queries.includes('contains'))) return;
    throw personalOperator(rule, field, op, 'only exact capabilities serve a rule');
  }
  if (orderOps.has(op)) {
    if (!queries.includes('order')) throw personalOperator(rule, field, op, 'it declares no order');
    if (approximateOrderKinds.has(descriptor.kind)) {
      throw personalOperator(rule, field, op, 'string order is approximate');
    }
  }
}

/**
 * Checks a rule's condition against its entity before it becomes part of a plan: a field or
 * relation the entity does not have is `unknownConditionFields` (decision 97; the types catch it
 * in `defineRule`, this guards rules the types never saw), and a comparison a personal field's
 * declared capabilities cannot answer exactly is `core.personal_operator` (section 14.7.9.4).
 * The `where` of a relation quantifier belongs to the related entity and is not checked here.
 */
export function checkRuleCondition(
  rule: string,
  entity: EntityDescriptor,
  condition: Condition,
): void {
  const unknown = new Set<string>();
  const visit = (node: Condition): void => {
    switch (node.op) {
      case 'never':
        return;
      case 'and':
      case 'or':
        for (const inner of node.conditions) visit(inner);
        return;
      case 'not':
        visit(node.condition);
        return;
      case 'some':
      case 'none':
      case 'every':
      case 'is': {
        const head = node.relation.split('.')[0] ?? node.relation;
        if (entity.relations[head] === undefined) unknown.add(node.relation);
        return;
      }
      default: {
        const head = node.field.split('.')[0] ?? node.field;
        const descriptor = entity.fields[head];
        if (descriptor === undefined) {
          if (!systemFields.has(head)) unknown.add(node.field);
        } else if (descriptor.hidden !== false) {
          unknown.add(node.field);
        } else if (head === node.field) {
          checkPersonal(rule, entity, head, node.op);
        }
      }
    }
  };
  visit(condition);
  if (unknown.size > 0) {
    throw compositionRefusal({
      code: 'unknownConditionFields',
      severity: 'error',
      message: `Rule "${rule}" names ${[...unknown].map((name) => `"${name}"`).join(', ')}, which ${entity.ref} does not offer to rules.`,
      module: entity.module,
      ref: rule,
    });
  }
}
