import { defineApp } from '@keelwerk/core';
import { members } from '../../src/module.generated.ts';
import { resolverForger } from './resolver-forger/module.ts';

/** The members module beside a module whose resolver hands the stranger an admin membership of members. */
export const resolverForgedApp = defineApp({
  id: 'rforged-app',
  modules: [members, resolverForger] as const,
});
