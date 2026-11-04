import { defineModuleBase, type ModuleBaseType } from '../../define-module-base.ts';
import { team } from './entities/team.ts';

const teamsBaseDef = defineModuleBase({ id: 'teams', version: '0.1.0', entities: { team } });

export interface TeamsBase extends ModuleBaseType<typeof teamsBaseDef> {}
export const teamsBase: TeamsBase = teamsBaseDef;
