/**
 * The run setting that every Vitest project whose tests use a PostgreSQL container spreads into its
 * `test` options. The files of such a project share a container (or start their own) that accepts
 * 200 connections (packages/testing/src/postgres/start-postgres.ts), and each file opens pools of
 * up to ten connections, more while it restarts a runtime; run at once on every core they exhausted
 * it. With `fileParallelism: false` Vitest gives the project one worker, whatever `--maxWorkers`
 * the command line passes. Vitest 5.1.0 puts every single-worker isolated project into one
 * sequential group that runs after the projects that run in parallel, so the PostgreSQL files of
 * all such projects run one at a time together, not only within their own project. The
 * setting lives in the project configs, so the pre-push hook, `pnpm check`, CI and every wrapper
 * get it.
 */
export const postgresProjectRun: { readonly fileParallelism: false } = { fileParallelism: false };
