import { appTemplate } from '../scaffold/app-template.ts';
import { moduleTemplate } from '../scaffold/module-template.ts';
import type { NewKind } from '../scaffold/new-kind.ts';
import type { ScaffoldFile } from '../scaffold/scaffold-file.ts';
import type { ScaffoldRequest } from '../scaffold/scaffold-request.ts';
import { formatJson } from './format-json.ts';
import type { InitNames } from './init-names.ts';
import { scaffoldOptionsOf } from './scaffold-options-of.ts';
import { baseTsconfig } from './templates/base-tsconfig.ts';
import { biomeJson } from './templates/biome-json.ts';
import { composeYaml } from './templates/compose-yaml.ts';
import { deploymentTs } from './templates/deployment-ts.ts';
import { gitIgnore } from './templates/git-ignore.ts';
import { knipJson } from './templates/knip-json.ts';
import { launchwayTs } from './templates/launchway-ts.ts';
import { launchwayTsconfig } from './templates/launchway-tsconfig.ts';
import { rootPackageJson } from './templates/root-package-json.ts';
import { rootTsconfig } from './templates/root-tsconfig.ts';
import { vitestConfig } from './templates/vitest-config.ts';
import { workspaceYaml } from './templates/workspace-yaml.ts';

function requestOf(names: InitNames, kind: NewKind, target: string, root: string): ScaffoldRequest {
  return {
    kind,
    target,
    host: target,
    names: [],
    root,
    scope: names.scope,
    coreSibling: false,
    packagesLayout: false,
    files: new Set(),
    options: scaffoldOptionsOf(kind === 'app' ? [names.module] : []),
  };
}

/** The scaffolds write JSON the way `JSON.stringify` lays it out; Biome lays short arrays out on one line. */
function formatted(file: ScaffoldFile): ScaffoldFile {
  return file.path.endsWith('.json')
    ? {
        path: file.path,
        text: formatJson(JSON.parse(file.text), file.path.endsWith('package.json')),
      }
    : file;
}

/**
 * Every file of a new project (section 23.1): the workspace, the base TypeScript configuration,
 * the Biome preset, `knip.json`, the `.launchway/` directory, one module and one app. The module
 * and the app are the scaffolds of `keelwerk new`, so the two commands can never disagree.
 */
export function planInit(names: InitNames): readonly ScaffoldFile[] {
  const module = moduleTemplate(
    requestOf(names, 'module', names.module, `modules/${names.module}`),
  ).files;
  const app = appTemplate(requestOf(names, 'app', names.app, `apps/${names.app}`)).files;
  return [
    { path: 'package.json', text: formatJson(rootPackageJson(names), true) },
    { path: 'pnpm-workspace.yaml', text: workspaceYaml() },
    { path: 'tsconfig.base.json', text: formatJson(baseTsconfig()) },
    { path: 'tsconfig.json', text: formatJson(rootTsconfig(names)) },
    { path: 'biome.json', text: formatJson(biomeJson()) },
    { path: 'knip.json', text: formatJson(knipJson(names)) },
    { path: 'vitest.config.ts', text: vitestConfig() },
    { path: '.gitignore', text: gitIgnore() },
    { path: '.launchway/deployment.ts', text: deploymentTs(names) },
    { path: '.launchway/launchway.ts', text: launchwayTs() },
    { path: '.launchway/tsconfig.json', text: formatJson(launchwayTsconfig(names)) },
    { path: '.launchway/compose.yaml', text: composeYaml() },
    ...[...module, ...app].map(formatted),
  ];
}
