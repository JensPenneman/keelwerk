import type { ExecutorContext } from '../contexts/executor-context.ts';
import type { StandardSchemaV1 } from '../fields/standard-schema-v1.ts';
import type { SecretRef } from '../ids/secret-ref.ts';
import { refuseRequest } from '../interpreter/refuse-request.ts';
import type { KeyService } from '../kernel/key-service.ts';
import { configSecrets } from '../keys/config-secrets.ts';
import { secretRefOwner } from '../keys/secret-ref-owner.ts';
import type { Logger } from '../observability/logger.ts';
import type { Scope } from '../storage/scope.ts';
import type { Unit } from '../storage/unit.ts';
import type { EffectConfig } from './effect-config.ts';
import { secretMembersOf } from './secret-members-of.ts';

/**
 * `ExecutorContext.secrets` of one attempt (D10, G4): the one place executor code opens a secret.
 * `reveal(value, reason)` takes a `{ ref }` stamped for the effect's module whose text is the text
 * of a secret member of the effect's input (walked with `schema`) or of the module's own
 * configuration (`config`); a `kwc1` text must also name the
 * module and the backend of the job. The reason must be a non-empty string. Anything else is
 * `refuseRequest`. The value is opened by the key service inside `open` (a read-only unit of the
 * job's scope), which logs `secret revealed` with the reason; this logs `executor reveal` with the
 * effect and the reason too. A key that is gone is `not_found`. Nothing is recorded, and `issue`
 * and `verify` are not offered.
 */
export function executorSecrets(options: {
  readonly keys: KeyService;
  readonly open: <T>(fn: (unit: Unit) => Promise<T>) => Promise<T>;
  readonly module: string;
  readonly scope: Scope;
  readonly schema: StandardSchemaV1;
  readonly input: Readonly<Record<string, unknown>>;
  /** The module's configuration: its own secret members are revealable too (D10 a). */
  readonly config?: EffectConfig;
  readonly effectId: string;
  readonly log: Logger;
  /** The attempt's signal: nothing is revealed once the attempt has ended. */
  readonly signal: AbortSignal;
}): ExecutorContext<unknown>['secrets'] {
  const { module, scope } = options;
  const held = new Map(secretMembersOf(options.schema, options.input));
  const { config } = options;
  if (config?.shape !== undefined && typeof config.value === 'object' && config.value !== null) {
    for (const text of secretMembersOf(
      config.shape,
      config.value as Readonly<Record<string, unknown>>,
    ).keys()) {
      held.set(text, '');
    }
  }
  return {
    reveal: async (value: SecretRef, reason: string): Promise<string> => {
      options.signal.throwIfAborted();
      const ref: unknown = typeof value === 'object' && value !== null ? value.ref : undefined;
      const stamped =
        typeof value === 'object' &&
        value !== null &&
        Reflect.get(value, secretRefOwner) === module;
      if (typeof ref !== 'string' || !stamped || !held.has(ref)) {
        throw refuseRequest(
          'secrets.reveal',
          "it takes a secret reference of this effect's input or of its module's configuration that its module loaded",
        );
      }
      if (configSecrets.isText(ref)) {
        const parsed = configSecrets.parse(ref);
        if (
          parsed === undefined ||
          parsed.moduleId !== module ||
          scope.level === 'deployment' ||
          parsed.backendId !== scope.backendId
        ) {
          throw refuseRequest(
            'secrets.reveal',
            'a configuration secret opens only for its own module and backend',
          );
        }
      }
      if (typeof reason !== 'string' || reason.trim() === '') {
        throw refuseRequest('secrets.reveal', 'it needs the reason for the reveal');
      }
      options.log.info('executor reveal', { effect: options.effectId, reason });
      // A configuration secret opens by its own text (module and backend); a value sealed for the
      // effect opens only for the effect and the member it was sealed under.
      const expected = configSecrets.isText(ref)
        ? undefined
        : { entity: 'core.effect', id: options.effectId, field: held.get(ref) ?? '' };
      return options.open((unit) => options.keys.reveal(unit, value, reason, expected));
    },
  };
}
