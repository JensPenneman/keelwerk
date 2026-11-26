import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function tracked(...patterns: string[]): string[] {
  const output = execFileSync('git', ['ls-files', '-z', '--', ...patterns], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  return output.split('\0').filter((path) => path !== '');
}

// The forms of a read: `x.roles` or `x?.roles` (an alias of the principal included), `x['roles']`,
// and `roles` taken out of an object by destructuring, nested one level or not, in a declaration or in a parameter. An object
// literal that gives `roles` a value (an enricher's answer) is none of these.
const roleReads = [
  /(?<!\.)\??\.\s*roles\b(?!['"`])/,
  /\[\s*['"`]roles['"`]\s*\]/,
  /\{[^;]*?\broles\b[^;]*?\}\s*(?::[^=;]*)?=(?![=>])/,
  /\(\s*\{[^;()]*?\broles\b[^;()]*?\}\s*[:),]/,
];

/** True when a source reads a list of roles by any name. Comments are not read. */
function readsRoles(source: string): boolean {
  const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
  return roleReads.some((form) => form.test(code));
}

// Any module may add any role to a principal, so a module that ships with keelwerk grants by a
// membership of its owner's kind or by its own state, never by the list of roles (architecture.md, 8.5).
test("no source of a shipped module reads a principal's roles", () => {
  const sources = tracked(
    'packages/module-*/src/**/*.ts',
    'packages/live/src/**/*.ts',
    'packages/core/src/core-module/**/*.ts',
  ).filter((path) => !/\.test(-d)?\.ts$/.test(path));
  expect(sources.length).toBeGreaterThan(100);
  const readers = sources.filter((path) =>
    readsRoles(readFileSync(join(repositoryRoot, path), 'utf8')),
  );
  expect(readers).toEqual([]);
});

test('the guard sees a read of roles in every form and no object literal that gives roles', () => {
  const caught = [
    'const ok = ctx.principal.roles.includes("admin");',
    'const { via, claims, roles } = ctx.principal;',
    'const { roles: held } = ctx.principal;',
    'const where = ({ principal: { roles } }: Ctx) => roles.includes("admin");',
    'const { principal: { roles } } = ctx;',
    'const where = ({ roles }: { roles: string[] }) => roles.length > 0;',
    'const who = ctx.principal; const ok = who.roles.length > 0;',
    'const ok = ctx.principal["roles"].length > 0;',
    'const ok = ctx.principal[`roles`].length > 0;',
  ];
  for (const source of caught) expect(readsRoles(source), source).toBe(true);
  const fine = [
    'return { roles: [row.role], memberships };',
    'function hasRole(...roles: readonly string[]) { return roles.length > 0; }',
    'const { memberships } = ctx.principal;',
    "const id = 'members.roles';",
  ];
  for (const source of fine) expect(readsRoles(source), source).toBe(false);
});
