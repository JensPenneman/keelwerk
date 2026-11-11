import type { ErrorIssue } from '../errors/error-issue.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { isEmptyShape } from '../fields/is-empty-shape.ts';
import { issuesOf } from '../invoker/stages/issues-of.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import { entityPositions } from './entity-positions.ts';
import { fieldChangesOf } from './field-changes-of.ts';
import { headNameIssues } from './head-name-issues.ts';
import { issueMemberIndex } from './issue-member-index.ts';
import { mechanicalInput } from './mechanical-input.ts';
import { rowsAt } from './rows-at.ts';
import type { VersionTranslation } from './version-translation.ts';

type Path = readonly (string | number)[];

/**
 * `validate` at the session's version (section 18.2): the input checked as the version sees it.
 * The names the version lacks are refused (`is not a field of this shape`), the input is renamed
 * to the head's names and validated against the head schema, the issues on a required member the
 * version does not have are ignored (the translation supplies it), and the paths of the others
 * are mapped back to the version's names. Throws `validation` (`core.validation`); resolves when
 * the input fits.
 */
export async function checkVersionInput(
  translation: VersionTranslation,
  action: ActionEntry,
  input: unknown,
): Promise<void> {
  const value = input === undefined && isEmptyShape(action.input) ? {} : input;
  const positions = entityPositions(action);
  const issues: ErrorIssue[] = [];
  const supplied = new Set<string>();
  const renames: { readonly from: string; readonly to: string }[] = [];
  if (positions !== undefined) {
    for (const change of translation.lacking) {
      for (const item of fieldChangesOf(change)) {
        if (item.entity !== positions.entity) continue;
        if (item.kind === 'renamed') renames.push({ from: item.field, to: item.was });
        for (const path of positions.inputRows) {
          for (const { row, path: at } of rowsAt(value, path)) {
            if (item.kind !== 'removed' && Object.hasOwn(row, item.field)) {
              issues.push({ path: [...at, item.field], message: 'is not a field of this shape' });
            }
            if (item.kind === 'added') supplied.add(JSON.stringify([...at, item.field]));
          }
        }
      }
    }
  }
  if (positions !== undefined) {
    issues.push(...headNameIssues(translation.registry, translation.lacking, positions, value));
  }
  let translated = value;
  translation.lacking.forEach((change, index) => {
    translated = mechanicalInput(
      translation.registry,
      change,
      action,
      translated,
      translation.lacking.slice(index + 1),
    );
  });
  const result = await action.input['~standard'].validate(translated);
  if (result.issues !== undefined) {
    for (const issue of issuesOf(result.issues)) {
      if (supplied.has(JSON.stringify(issue.path))) continue;
      const path = [...issue.path] as Path[number][];
      for (const position of positions?.inputRows ?? []) {
        const index = issueMemberIndex(path, position);
        if (index < 0) continue;
        for (const rename of [...renames].reverse()) {
          if (path[index] === rename.from) path[index] = rename.to;
        }
        break;
      }
      issues.push({ path, message: issue.message });
    }
  }
  if (issues.length === 0) return;
  throw new KeelwerkError({
    kind: 'validation',
    code: 'core.validation',
    message: `The input of "${translation.versionRefs.get(action.ref) ?? action.ref}" does not match its schema.`,
    issues,
  });
}
