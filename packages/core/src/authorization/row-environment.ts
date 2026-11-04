/** Where the invoker runs: development and tests fail on a row outside the plan, production drops it. */
export type RowEnvironment = 'development' | 'test' | 'production';
