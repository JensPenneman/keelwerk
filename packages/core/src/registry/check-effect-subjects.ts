import { effectDataSubject } from '../effects/effect-data-subject.ts';
import { personalInputField } from '../effects/personal-input-field.ts';
import type { AnyField } from '../fields/field-def.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';
import { dataSubjectPathProblem } from './data-subject-path-problem.ts';
import type { EffectEntry } from './effect-entry.ts';
import type { EntityEntry } from './entity-entry.ts';
import type { PathHead } from './path-head.ts';
import { referenceTarget } from './reference-target.ts';

type Fields = Readonly<Record<string, AnyField>>;

function fieldsOf(schema: unknown): Fields {
  const fields = (schema as { readonly fields?: Fields }).fields;
  return fields ?? {};
}

/** The input fields as the path walk reads them (the effect's module resolves own references). */
function inputHead(module: string, input: Fields): PathHead {
  return {
    label: 'its input',
    field: (name) => {
      const field = Object.hasOwn(input, name) ? input[name] : undefined;
      if (field === undefined) return undefined;
      const target = referenceTarget(field.ref, module);
      return {
        kind: field.kind,
        personal: effectDataSubject({}, field) !== undefined,
        sealed: field.kind === 'secret' || field.kind === 'verifier',
        target: target === null ? null : `${target.module}.${target.entity}`,
      };
    },
  };
}

/**
 * `effectInputNeedsSubject` and `personalEffectOutput` (S-127): every personal input member names a
 * subject path that resolves as a whole: its first segment is a non-personal input field holding an
 * id (a subject, a reference or a string, never a secret, a verifier, json or a number), each hop
 * is a reference through the entities of the app, and the last segment is `id` or a field that is
 * neither personal nor sealed; an effect output declares no personal field.
 */
export function checkEffectSubjects(
  effects: ReadonlyMap<string, EffectEntry>,
  entities: ReadonlyMap<string, EntityEntry>,
): readonly CompositionProblem[] {
  const describe = (ref: string) => entities.get(ref)?.descriptor;
  const problems: CompositionProblem[] = [];
  for (const entry of effects.values()) {
    const site = { module: entry.module, ref: entry.ref };
    const input = fieldsOf(entry.input);
    const reported = new Set<string>();
    for (const [name, field] of Object.entries(input)) {
      const path = effectDataSubject(entry, field);
      if (path === undefined) continue;
      if (path === null) {
        problems.push(
          compositionError(
            'effectInputNeedsSubject',
            `'${entry.ref}' declares the personal input field '${name}' and names no data subject; declare dataSubject (a path in its input) or .personal({ subject }).`,
            site,
          ),
        );
        continue;
      }
      if (reported.has(path)) continue;
      reported.add(path);
      const reason = dataSubjectPathProblem(describe, inputHead(entry.module, input), path);
      if (reason !== undefined) {
        problems.push(
          compositionError(
            'effectInputNeedsSubject',
            `'${entry.ref}' names the data subject '${path}', ${reason}`,
            site,
          ),
        );
      }
    }
    const personalOutput = personalInputField(entry.output);
    if (personalOutput !== undefined) {
      problems.push(
        compositionError(
          'personalEffectOutput',
          `'${entry.ref}' outputs the personal field '${personalOutput}'; an effect record keeps its output with secrets sealed and nothing else, so leave the field out.`,
          site,
        ),
      );
    }
  }
  return problems;
}
