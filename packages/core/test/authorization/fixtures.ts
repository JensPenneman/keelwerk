import type { AuthorizedAction } from '../../src/authorization/authorized-action.ts';
import { normalizeRule } from '../../src/authorization/normalize-rule.ts';
import type { NormalizedRule } from '../../src/authorization/normalized-rule.ts';
import type { ConditionInput } from '../../src/conditions/condition-input.ts';
import type { PrincipalContext } from '../../src/contexts/principal-context.ts';
import type { SubjectId } from '../../src/ids/subject-id.ts';
import type { PrincipalKind } from '../../src/principals/principal-kind.ts';
import type { GeneratedActionKind } from '../../src/registry/generated-action-kind.ts';
import type { RuleEntry } from '../../src/registry/rule-entry.ts';
import type { EntityDescriptor } from '../../src/storage/entity-descriptor.ts';
import type { FieldDescriptor } from '../../src/storage/field-descriptor.ts';
import type { FieldKind } from '../../src/storage/field-kind.ts';
import type { PersonalQuery } from '../../src/storage/personal-query.ts';

interface FieldOptions {
  readonly maskable?: boolean;
  readonly hidden?: boolean;
  readonly personal?: readonly PersonalQuery[];
}

interface RuleOptions {
  readonly id: string;
  readonly effect: 'allow' | 'deny';
  readonly entity?: string;
  readonly module?: string;
  readonly actions?: readonly string[];
  readonly principal?: PrincipalKind | readonly PrincipalKind[];
  readonly where?: (context: PrincipalContext) => unknown;
  readonly check?: (context: PrincipalContext) => unknown;
  readonly when?: (context: PrincipalContext, input: unknown) => boolean;
  readonly fields?: readonly string[];
  readonly reason?: string;
  readonly subject?: RuleEntry['subject'];
  readonly disabled?: boolean;
}

/** A field descriptor with the members the engine reads. */
export function fieldDescriptor(kind: FieldKind, options: FieldOptions = {}): FieldDescriptor {
  return {
    kind,
    column: kind,
    optional: true,
    unique: false,
    indexed: false,
    hidden: options.hidden === true ? { history: false } : false,
    maskable: options.maskable === true,
    stateOnly: false,
    sealed: false,
    merge: 'lww',
    personal:
      options.personal === undefined
        ? false
        : {
            subject: 'id',
            queries: options.personal,
            normalize: { id: 'exact', version: 1 },
            params: {
              eq: { bits: 128 },
              prefix: { min: 1, max: 8 },
              contains: { bits: 32 },
              order: { bytes: 8 },
            },
            keys: 'tenant',
          },
    constraints: {},
    ref: null,
    inner: null,
    codec: null,
    tag: 0,
  };
}

/** An entity descriptor over named fields. */
export function entityDescriptor(
  ref: string,
  fields: Readonly<Record<string, FieldDescriptor>>,
  relations: EntityDescriptor['relations'] = {},
): EntityDescriptor {
  const [module = '', name = ''] = ref.split('.');
  return {
    ref,
    module,
    name,
    history: 'chain',
    tenancy: 'tenant',
    shape: { tracks: [] } as unknown as EntityDescriptor['shape'],
    dataSubject: null,
    table: name,
    fields,
    relations,
    indexes: [],
    partition: null,
    mergeState: false,
    searchIndexes: [],
    derivedIndexes: {},
    external: null,
  };
}

/** A registry rule entry; `entity` is 'module.entity'. */
export function ruleEntry(options: RuleOptions): RuleEntry {
  const [module = 'doc', entity] = (options.entity ?? 'doc.post').split('.');
  return {
    id: options.id,
    module: options.module ?? module,
    effect: options.effect,
    subject: options.subject ?? { module, ...(entity !== undefined && { entity }) },
    actions: options.actions ?? ['*'],
    ...(options.principal !== undefined && { principal: options.principal }),
    ...(options.where !== undefined && {
      where: options.where as (context: unknown) => ConditionInput | boolean,
    }),
    ...(options.check !== undefined && {
      check: options.check as (context: unknown) => ConditionInput | boolean,
    }),
    ...(options.when !== undefined && {
      when: options.when as (context: unknown, input: unknown) => boolean,
    }),
    ...(options.fields !== undefined && { fields: options.fields }),
    ...(options.reason !== undefined && { reason: options.reason }),
    disabled: options.disabled === true,
  };
}

/** A normalised rule. */
export function rule(options: RuleOptions): NormalizedRule {
  return normalizeRule(ruleEntry(options));
}

/** An entity action of the `doc.post` entity (or another). */
export function entityAction(
  name: string,
  options: {
    readonly entity?: string;
    readonly kind?: 'query' | 'command' | 'subscription';
    readonly generated?: GeneratedActionKind;
    readonly instance?: boolean;
  } = {},
): AuthorizedAction {
  const [module = 'doc', entity = 'post'] = (options.entity ?? 'doc.post').split('.');
  const generated = options.generated;
  const kind =
    options.kind ??
    (generated === undefined ||
    ['create', 'update', 'archive', 'restore', 'set'].includes(generated)
      ? 'command'
      : 'query');
  return {
    ref: `${module}.${entity}.${name}`,
    module,
    entity: `${module}.${entity}`,
    name,
    kind,
    ...(generated !== undefined && { generated }),
    instance:
      options.instance ?? (kind === 'command' && generated !== 'create' && generated !== 'set'),
    auth: 'policy',
    scope: 'tenant',
  };
}

/** A module-level action. */
export function moduleAction(
  module: string,
  name: string,
  options: {
    readonly auth?: 'policy' | 'public';
    readonly scope?: 'tenant' | 'backend' | 'deployment';
  } = {},
): AuthorizedAction {
  return {
    ref: `${module}.${name}`,
    module,
    name,
    kind: 'command',
    instance: false,
    auth: options.auth ?? 'policy',
    scope: options.scope ?? 'tenant',
  };
}

/** A principal context in the tenant scope `b1/t1`. */
export function context<Pk extends PrincipalKind = 'user'>(
  kind: Pk | 'user' = 'user',
  subject = 'u1',
): PrincipalContext {
  const base = {
    scope: { backend: 'b1', tenant: 't1' },
    claims: {},
    roles: [],
    memberships: [],
    via: 'test',
    ref: null,
  };
  const principal =
    kind === 'user'
      ? {
          ...base,
          kind: 'user' as const,
          subject: subject as SubjectId,
          subjectRef: null,
          subjectAs: () => null,
        }
      : kind === 'service'
        ? { ...base, kind: 'service' as const, id: subject, idAs: () => null }
        : kind === 'operator'
          ? { ...base, kind: 'operator' as const, id: subject }
          : kind === 'system'
            ? { ...base, kind: 'system' as const, reason: 'test' }
            : { ...base, kind: 'anonymous' as const };
  return {
    principal,
    scope: { level: 'tenant', backendId: 'b1', tenantId: 't1' },
    flags: {},
  } as PrincipalContext;
}
