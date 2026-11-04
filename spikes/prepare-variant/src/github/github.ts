import { defineModule, type ModuleType } from '@keelwerk/core';
import { connectGithub as connectGithubInline } from '../inline-before-load/connect-github.ts';
import { connectLate } from '../inline-before-load/connect-late.ts';
import { connectGithub } from '../separate-prepare/connect-github.ts';
import { exchangeCode } from './exchange-code.ts';
import { githubBase } from './github-base.ts';
import { startConnect } from './start-connect.ts';

const githubDef = defineModule(githubBase, {
  actions: {
    connect: connectGithub,
    connectInline: connectGithubInline,
    connectLate,
    startConnect,
  },
  effects: { exchangeCode },
});

export interface Github extends ModuleType<typeof githubDef> {}
export const github: Github = githubDef;
