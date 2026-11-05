import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LayoutWorkspace } from '../layout/layout-workspace.ts';
import type { DeclarationBudget } from './declaration-budget.ts';
import type { DoctorFinding } from './doctor-finding.ts';
import { findingOf } from './finding-of.ts';
import { measureDeclarations } from './measure-declarations.ts';

async function budgetOf(root: string): Promise<DeclarationBudget | undefined> {
  try {
    const parsed: unknown = JSON.parse(
      await readFile(join(root, 'scripts', 'type-budgets', 'budgets.json'), 'utf8'),
    );
    return (parsed as { declarations?: DeclarationBudget }).declarations;
  } catch {
    return undefined;
  }
}

/**
 * Declaration sizes within budget (section 13.11): 6 KB per `module.generated.d.ts` and 16 KB per
 * module package, read from the budgets file of the type-budgets gate. A package that has not been
 * built (no `dist/`) is skipped; `pnpm budgets` measures a clean emit.
 */
export async function checkDeclarationSizes(
  workspace: LayoutWorkspace,
): Promise<readonly DoctorFinding[]> {
  const budget = await budgetOf(workspace.root);
  if (budget === undefined) return [];
  const found: DoctorFinding[] = [];
  for (const module of workspace.modules) {
    if (budget.exempt.some((prefix) => module.dir.startsWith(prefix))) continue;
    const size = await measureDeclarations(workspace.root, module.dir);
    if (size === undefined) continue;
    if (size.manifestBytes > budget.manifestBytes) {
      found.push(
        findingOf(
          'declaration-sizes',
          'error',
          module.dir,
          `module.generated.d.ts is ${size.manifestBytes} bytes, the budget is ${budget.manifestBytes}`,
          'split the module, or name the types its manifest copies',
        ),
      );
    }
    if (size.totalBytes > budget.packageBytes) {
      found.push(
        findingOf(
          'declaration-sizes',
          'error',
          module.dir,
          `the declarations are ${size.totalBytes} bytes, the budget is ${budget.packageBytes}`,
          'name the types the declarations copy (section 4.1), or split the module',
        ),
      );
    }
  }
  return found;
}
