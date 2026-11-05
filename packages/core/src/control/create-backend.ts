import { errors } from '../errors/errors.ts';
import type { Shape } from '../fields/shape.ts';
import { newUuidV7 } from '../ids/new-uuid-v7.ts';
import { configSecrets } from '../keys/config-secrets.ts';
import { nestedCredentialField } from '../keys/nested-credential-field.ts';
import type { ControlStore } from './control-store.ts';
import { coreBackendConfig } from './core-backend-config.ts';
import { findControlRows } from './find-control-rows.ts';
import { runGeneratedCreate } from './run-generated-create.ts';

/** A configuration secret waiting to be sealed: where it goes and its plain value. */
interface PendingSecret {
  readonly moduleId: string;
  readonly field: string;
  readonly value: string;
}

/** The validated configuration, and the secrets still to seal into it. */
interface CheckedConfig {
  readonly stored: Record<string, Record<string, unknown>>;
  readonly pending: readonly PendingSecret[];
}

/**
 * Validates `config[moduleId]` against each module's config shape (5.7) and collects the values
 * of `field.secret()` fields, to be sealed under the backend key once everything else is known to
 * hold (S-70): sealing creates the backend's scope key, which no rollback can take back. A module
 * the app does not select, a module without a config shape, a value the shape rejects and a
 * secret held in a list or set are `validation` errors; the validated values (defaults filled)
 * are what is stored.
 */
function checkedConfig(
  config: Readonly<Record<string, unknown>>,
  modules: readonly ConfigurableModule[],
): CheckedConfig {
  const stored: Record<string, Record<string, unknown>> = {};
  const pending: PendingSecret[] = [];
  for (const [moduleId, values] of Object.entries(config)) {
    const module = modules.find((candidate) => candidate.id === moduleId);
    if (module === undefined) {
      throw errors.validation(`The app has no module "${moduleId}" to configure.`, {
        issues: [{ path: [moduleId], message: 'Not a module of this app.' }],
      });
    }
    const schema = module.base?.config ?? (moduleId === 'core' ? coreBackendConfig : undefined);
    if (schema === undefined) {
      throw errors.validation(`Module "${moduleId}" declares no configuration.`, {
        issues: [{ path: [moduleId], message: 'The module declares no config shape.' }],
      });
    }
    const result = schema['~standard'].validate(values);
    if (result instanceof Promise) {
      throw errors.internal(`The config shape of "${moduleId}" is asynchronous.`);
    }
    if (result.issues !== undefined) {
      throw errors.validation(`The configuration of "${moduleId}" is not valid.`, {
        issues: result.issues.map((issue) => ({
          path: [
            moduleId,
            ...(issue.path ?? []).map((part) => String(typeof part === 'object' ? part.key : part)),
          ],
          message: issue.message,
        })),
      });
    }
    const checked: Record<string, unknown> = { ...(result.value as Record<string, unknown>) };
    const nested = nestedCredentialField(schema.fields);
    if (nested !== undefined) {
      throw errors.validation(`${moduleId}.${nested} holds secrets in a list or set.`, {
        issues: [
          { path: [moduleId, nested], message: 'Secrets are sealed one per field, not in a list.' },
        ],
      });
    }
    for (const [name, member] of Object.entries(schema.fields)) {
      const value = checked[name];
      if (member.kind !== 'secret' || value === undefined) continue;
      if (typeof value !== 'string') {
        throw errors.validation(`${moduleId}.${name} takes the secret's value.`, {
          issues: [{ path: [moduleId, name], message: 'Expected the plain value of a secret.' }],
        });
      }
      pending.push({ moduleId, field: name, value });
    }
    stored[moduleId] = checked;
  }
  return { stored, pending };
}

/** What validating configuration needs of a module: its id and its `config` shape, if it declares one. */
export interface ConfigurableModule {
  readonly id: string;
  /** The module's base, which holds the `config` shape (section 5.7). */
  readonly base?: { readonly config?: Shape };
}

/** The values of a new `core.backend` row (S-26). */
export interface BackendInput {
  readonly name: string;
  readonly app: string;
  /** A placement name of the deployment. */
  readonly placement: string;
  readonly apiVersion?: string;
  /** Per-module configuration by module id (5.7): checked against the module's `config` shape; `field.secret()` values are sealed under the backend key (S-70). */
  readonly config?: Readonly<Record<string, unknown>>;
}

/**
 * Creates a backend row through the generated
 * `core.backend.create` (S-26); the name is unique. The
 * backend's `config` is checked against the selected modules' config shapes and the name is checked
 * free before its secrets are sealed, then the row is written.
 */
export async function createBackend(
  store: ControlStore,
  input: BackendInput,
  modules: readonly ConfigurableModule[] = [],
): Promise<{ readonly id: string }> {
  const id = newUuidV7();
  const checked = input.config === undefined ? undefined : checkedConfig(input.config, modules);
  // Everything that can refuse the backend is checked before a secret creates the backend's key.
  if ((await findControlRows(store, 'core.backend', { name: input.name })).length > 0) {
    throw errors.conflict(`A backend named "${input.name}" already exists.`);
  }
  const config = checked?.stored;
  for (const secret of checked?.pending ?? []) {
    const target = config?.[secret.moduleId];
    if (target === undefined) continue;
    target[secret.field] = await configSecrets.seal(
      (scope, info, length) => store.keys.derive(scope, info, length),
      { backendId: id, moduleId: secret.moduleId, field: secret.field },
      secret.value,
    );
  }
  // The id is minted before the row so the config secrets can be bound to it.
  await runGeneratedCreate(
    store,
    'backend',
    {
      name: input.name,
      app: input.app,
      placement: input.placement,
      ...(input.apiVersion === undefined ? {} : { apiVersion: input.apiVersion }),
      ...(config === undefined ? {} : { config }),
    },
    id,
  );
  return { id };
}
