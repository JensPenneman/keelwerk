import type { ModuleBase } from 'other-library';

declare module 'other-library' {
  interface ModuleBase {
    extra: string;
  }
}

export type Demo = ModuleBase;
