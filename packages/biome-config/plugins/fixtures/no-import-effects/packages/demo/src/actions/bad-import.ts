import 'reflect-metadata'; // expect: plugin/no-import-effects
import { run } from './run.ts';

export const bound = run;
