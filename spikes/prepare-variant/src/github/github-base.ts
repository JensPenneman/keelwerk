import { defineModuleBase, type ModuleBaseType } from '@keelwerk/core';
import { connection } from './connection.ts';
import { pendingConnect } from './pending-connect.ts';

const githubBaseDef = defineModuleBase({
  id: 'github',
  version: '0.1.0',
  entities: { connection, pendingConnect },
});

export interface GithubBase extends ModuleBaseType<typeof githubBaseDef> {}
export const githubBase: GithubBase = githubBaseDef;
