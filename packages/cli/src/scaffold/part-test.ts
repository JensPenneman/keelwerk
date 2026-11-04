import { camelFromKebab } from '@keelwerk/core';
import type { MountAssertion } from './mount-assertion.ts';
import type { PartPlacement } from './part-placement.ts';
import { relativeImport } from './relative-import.ts';
import { renderImports } from './render-imports.ts';
import type { ScaffoldFile } from './scaffold-file.ts';
import type { ScaffoldRequest } from './scaffold-request.ts';

/**
 * The test beside an action, rule or reaction (section 23.14): it reads the generated module
 * value, so it passes once `keelwerk generate` has mounted the part and the base lists what the
 * part needs.
 */
export function partTest(
  request: ScaffoldRequest,
  placement: PartPlacement,
  reference: string,
  assertion: MountAssertion,
): ScaffoldFile {
  const moduleName = camelFromKebab(request.host);
  const imports = renderImports([
    { from: 'vitest', names: ['expect', 'test'] },
    {
      from: relativeImport(placement.inSource, 'module.generated.ts'),
      names: [moduleName],
    },
  ]);
  const lines: string[] = [];
  if (placement.scoped) {
    const member = request.options.from === undefined ? 'conditional' : 'contributes';
    lines.push(
      `  const scoped: readonly { readonly key: string }[] = ${moduleName}.${member};`,
      `  expect(scoped.map((entry) => entry.key)).toContain('${placement.scopeKey ?? ''}');`,
    );
  } else {
    lines.push(
      `  const mounted: Readonly<Record<string, unknown>> = ${moduleName}.${assertion.member};`,
      `  expect(mounted).toHaveProperty('${assertion.path}');`,
    );
  }
  return {
    path: placement.path.replace(/\.ts$/, '.test.ts'),
    text: `${imports}\n\ntest('${reference} is mounted by the generated manifest', () => {\n${lines.join('\n')}\n});\n`,
  };
}
