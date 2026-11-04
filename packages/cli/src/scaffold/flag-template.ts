import { camelFromKebab } from '@keelwerk/core';
import { usageFailure } from '../context/usage-failure.ts';
import { expectNames } from './expect-names.ts';
import { nameAt } from './name-at.ts';
import { renderImports } from './render-imports.ts';
import type { ScaffoldPlan } from './scaffold-plan.ts';
import type { ScaffoldRequest } from './scaffold-request.ts';

const KINDS = ['boolean', 'string', 'number', 'json', 'variant'] as const;
const LEVELS = ['deployment', 'backend', 'tenant', 'principal'] as const;
const PURPOSES = ['release', 'experiment', 'operational', 'kill-switch', 'permission'] as const;

function oneOf(flag: string, value: string, allowed: readonly string[]): string {
  if (!allowed.includes(value)) {
    throw usageFailure(`--${flag} is one of ${allowed.join(', ')}, not "${value}".`);
  }
  return value;
}

function defaults(kind: string): string[] {
  switch (kind) {
    case 'string':
      return ["default: ''"];
    case 'number':
      return ['default: 0'];
    case 'json':
      return ['schema: shape({})', 'default: {}'];
    case 'variant':
      return ["variants: ['control', 'variant']", "default: 'control'"];
    default:
      return ['default: false'];
  }
}

/**
 * `keelwerk new flag <module>.<flag> --kind boolean --level tenant --purpose release --expires
 * 2027-01-31`: `src/flags/<flag>.ts`. A typed declaration in M1: a request answers the declared
 * default (S-23). The base lists it by hand.
 */
export function flagTemplate(request: ScaffoldRequest): ScaffoldPlan {
  const file = nameAt(expectNames('flag', request.names, [1], '<module>.<flag>'), 0);
  const kind = oneOf('kind', request.options.kind ?? 'boolean', KINDS);
  const level = oneOf('level', request.options.level ?? 'tenant', LEVELS);
  const purpose = oneOf('purpose', request.options.purpose ?? 'release', PURPOSES);
  const { expires } = request.options;
  if ((purpose === 'release' || purpose === 'experiment') && expires === undefined) {
    throw usageFailure(`A ${purpose} flag needs --expires <YYYY-MM-DD> (section 20.2).`);
  }
  if (expires !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(expires)) {
    throw usageFailure(`--expires is a date (YYYY-MM-DD), not "${expires}".`);
  }
  const name = camelFromKebab(file);
  const fields = [
    `kind: '${kind}'`,
    ...defaults(kind),
    `level: '${level}'`,
    `purpose: '${purpose}'`,
    ...(expires === undefined ? [] : [`expires: '${expires}'`]),
  ];
  const imports = renderImports([
    { from: '@keelwerk/core', names: ['defineFlag', ...(kind === 'json' ? ['shape'] : [])] },
  ]);
  const text = `${imports}

export const ${name} = defineFlag({
${fields.map((line) => `  ${line},`).join('\n')}
});
`;
  return {
    files: [{ path: `${request.root}/src/flags/${file}.ts`, text }],
    handEdits: [
      {
        file: `${request.root}/src/base.ts`,
        reason: `the base lists the flag, which is then ${request.target}.${name}`,
        lines: [`import { ${name} } from './flags/${file}.ts';`, `flags: { ${name} },`],
      },
    ],
  };
}
