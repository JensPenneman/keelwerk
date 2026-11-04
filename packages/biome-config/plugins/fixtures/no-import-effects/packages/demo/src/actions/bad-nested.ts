import { run } from './run.ts';

if (run) {
  run(); // expect: plugin/no-import-effects
}

try {
  run(); // expect: plugin/no-import-effects
} catch {
  run(); // expect: plugin/no-import-effects
}

export class Boot {
  static {
    run(); // expect: plugin/no-import-effects
  }

  constructor() {
    run();
  }

  get value(): number {
    run();
    return 1;
  }
}
