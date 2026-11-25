import { fakeControlStore } from './fake-control-store.ts';

const recorded = '0192f3a0-0000-7000-8000-000000000001';

/** Control stores shared by a test and the deployment file it loads: the file's own import is the one that is asked. */
export const sharedControlStores = {
  answering: fakeControlStore({ recorded }),
  silentUnit: fakeControlStore({ recorded, silent: ['unit'] }),
  silentConnect: fakeControlStore({ recorded, silent: ['connect', 'close'] }),
  silentHistory: fakeControlStore({ recorded, silent: ['history'] }),
};
