// Generated from the module's directories (decision 59b); do not edit.
import { defineModule, type ModuleType } from '../../define-module.ts';
import { teamsBase } from './base.ts';

const moduleDef = defineModule(teamsBase, {});

/** The teams module. */
export interface Teams extends ModuleType<typeof moduleDef> {}

/** The teams module value. */
export const teams: Teams = moduleDef;
