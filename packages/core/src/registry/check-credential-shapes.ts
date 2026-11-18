import type { AnyField } from '../fields/field-def.ts';
import { jsonShapeFields } from '../fields/json-shape-fields.ts';
import type { ShapeFields } from '../fields/shape.ts';
import type { StandardSchemaV1 } from '../fields/standard-schema-v1.ts';
import type { ComposableApp } from './composable-app.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';
import type { Registry } from './registry.ts';
import { runtimeModule } from './runtime-module.ts';

/** A credential field found in a shape: where, which, and whether a `json` member holds it. */
interface Found {
  readonly path: string;
  readonly kind: 'secret' | 'verifier';
  readonly inJson: boolean;
}

function visit(field: AnyField, path: string, inJson: boolean, found: Found[]): void {
  if (field.kind === 'secret' || field.kind === 'verifier') {
    found.push({ path, kind: field.kind, inJson });
    return;
  }
  // The element of a list or set is sealed like a member of its own.
  if (field.inner !== null) {
    visit(field.inner, `${path}[]`, inJson, found);
    return;
  }
  const members = jsonShapeFields(field);
  if (members !== undefined) walk(members, `${path}.`, true, found);
}

function walk(fields: ShapeFields, prefix: string, inJson: boolean, found: Found[]): void {
  for (const [name, field] of Object.entries(fields))
    visit(field, `${prefix}${name}`, inJson, found);
}

/** The credential fields of a shape (a schema with no declared fields holds none). */
function credentialsOf(schema: StandardSchemaV1): readonly Found[] {
  const { fields } = schema as { readonly fields?: ShapeFields };
  if (fields === undefined) return [];
  const found: Found[] = [];
  walk(fields, '', false, found);
  return found;
}

/** The problems of the credentials found in one declared shape. */
function problemsOf(
  found: readonly Found[],
  site: { readonly module: string; readonly ref: string; readonly what: string },
  options: { readonly verifiers: boolean },
): readonly CompositionProblem[] {
  const problems: CompositionProblem[] = [];
  for (const credential of found) {
    const { module, ref } = site;
    if (credential.inJson) {
      problems.push(
        compositionError(
          'credentialInJson',
          `${site.what} '${ref}' declares the ${credential.kind} '${credential.path}' inside a json member: the kernel seals a credential only as a top-level member or as an element of a list or set, so the value would be stored unsealed. Move it into a member of its own.`,
          { module, ref },
        ),
      );
    }
    if (credential.kind === 'verifier' && options.verifiers) {
      problems.push(
        compositionError(
          'verifierOutsideEntity',
          `${site.what} '${ref}' declares the verifier '${credential.path}', and a verifier is only a top-level field of an entity: anywhere else it would be stored unsealed. Issue it in the decision that writes it (ctx.secrets.issue) and write it into the entity field there.`,
          { module, ref },
        ),
      );
    }
  }
  return problems;
}

/**
 * `credentialInJson` and `verifierOutsideEntity` (14.7.4): the kernel seals a `field.secret()` or
 * `field.verifier()` only as a top-level member or as an element of a list or set, so a credential
 * inside a `field.json()` member of a shape a module declares (an entity field, a command or effect
 * input or output, a module configuration), or a verifier anywhere but a top-level field of an
 * entity (a command or effect input or output, a module configuration), would be stored in clear in
 * a row, a job, an effect record or a receipt. The shapes the kernel builds are not a module's
 * declaration and are not checked: a generated action, and a row or page output (`entityOutput`,
 * which includes the default output of an entity command).
 */
export function checkCredentialShapes(
  app: ComposableApp,
  registry: Registry,
): readonly CompositionProblem[] {
  const problems: CompositionProblem[] = [];
  const noVerifiers = { verifiers: false };
  const all = { verifiers: true };
  for (const module of app.modules) {
    const runtime = runtimeModule(module);
    const entities = [
      ...Object.entries(runtime.entities).map(
        ([name, entity]) => [`${module.id}.${name}`, entity] as const,
      ),
      ...runtime.contributes.flatMap((contribution) =>
        Object.entries(contribution.entities).map(
          ([name, patch]) => [`${contribution.to.id}.${name}`, patch] as const,
        ),
      ),
      ...runtime.conditional.flatMap((conditional) =>
        Object.entries(conditional.entities).map(
          ([name, patch]) => [`${module.id}.${name}`, patch] as const,
        ),
      ),
    ];
    for (const [ref, entity] of entities) {
      const found: Found[] = [];
      walk(entity.fields, '', false, found);
      problems.push(
        ...problemsOf(found, { module: module.id, ref, what: 'The entity' }, noVerifiers),
      );
    }
    const { config } = runtime.base;
    if (config !== undefined) {
      problems.push(
        ...problemsOf(
          credentialsOf(config as unknown as StandardSchemaV1),
          { module: module.id, ref: `${module.id}.config`, what: 'The configuration' },
          all,
        ),
      );
    }
  }
  for (const action of registry.actions.values()) {
    if (action.kind !== 'command' || action.generated !== undefined) continue;
    const site = { module: action.module, ref: action.ref, what: 'The command' };
    // The default row output of an entity command is kernel-built (`entityOutput`); an output the
    // module declared is checked in full, whatever its members are called.
    const outputs = action.entityOutput === undefined ? credentialsOf(action.output) : [];
    problems.push(
      ...problemsOf(credentialsOf(action.input), site, all),
      ...problemsOf(outputs, site, all),
      ...(action.outcomeWith === undefined
        ? []
        : problemsOf(credentialsOf(action.outcomeWith), site, all)),
    );
  }
  for (const effect of registry.effects.values()) {
    const site = { module: effect.module, ref: effect.ref, what: 'The effect' };
    problems.push(
      ...problemsOf(credentialsOf(effect.input), site, all),
      ...problemsOf(credentialsOf(effect.output), site, all),
    );
  }
  return problems;
}
