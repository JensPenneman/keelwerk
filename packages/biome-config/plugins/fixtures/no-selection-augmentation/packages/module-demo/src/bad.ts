import type { ModuleBase } from '@keelwerk/core';

declare module '@keelwerk/core' { // expect: plugin/no-selection-augmentation
  interface ModuleBase {
    extra: string;
  }
}

declare global { // expect: plugin/no-selection-augmentation
  interface Window {
    extra: string;
  }
}

export type Demo = ModuleBase;
