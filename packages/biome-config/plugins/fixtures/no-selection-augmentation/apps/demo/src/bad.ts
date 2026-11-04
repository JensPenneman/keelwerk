import type { App } from '@keelwerk/core';

declare module "@keelwerk/core/wire" { // expect: plugin/no-selection-augmentation
  interface Wire {
    extra: string;
  }
}

export type Demo = App;
