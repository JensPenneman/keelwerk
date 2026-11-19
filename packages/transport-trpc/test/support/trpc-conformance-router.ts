import type { TrpcRouterOf } from '../../src/types/trpc-router-of.ts';
import type { TrpcConformanceApp as App } from './trpc-conformance-app.ts';

/** The fragment the generated file of the conformance app would carry: its last line is the declaration the transport writes. */
export type TrpcRouter = TrpcRouterOf<App>;
