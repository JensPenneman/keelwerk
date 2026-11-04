import { load } from './load.ts';

await load(); // expect: plugin/no-import-effects
export const bound = 1;
