import { expectTypeOf, test } from 'vitest';
import type { AdmissionInput, AdmissionRule } from '../edge/admission-rule.ts';
import type { AdmissionVerdict } from '../edge/admission-verdict.ts';
import type { BucketDemand } from '../edge/bucket-demand.ts';
import type { PrincipalEnricher } from '../edge/principal-enricher.ts';
import type { PrincipalResolution } from '../edge/principal-resolution.ts';
import type { PrincipalResolver } from '../edge/principal-resolver.ts';
import type { TenantResolver } from '../edge/tenant-resolver.ts';
import type { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { WireError } from '../errors/wire-error.ts';
import type { StateToken } from '../events/state-token.ts';
import type { Gen } from '../protocol/gen.ts';
import type { Registry } from '../registry/registry.ts';
import type { DeploymentDefinition } from '../runtime/deployment-definition.ts';
import type { Runtime, StartRuntime } from '../runtime/runtime.ts';
import type { RuntimeOptions } from '../runtime/runtime-options.ts';
import type { Scope } from '../storage/scope.ts';
import type { FieldNode } from '../surface/field-node.ts';
import type { ResponseHint } from '../surface/response-hint.ts';
import type { Artifact } from '../transport/artifact.ts';
import type { HostFetchOptions } from '../transport/host-fetch-options.ts';
import type { HttpContext } from '../transport/http-context.ts';
import type { HttpHandler } from '../transport/http-handler.ts';
import type { TransportHost } from '../transport/transport-host.ts';
import type { WebSocketHandler } from '../transport/web-socket-handler.ts';
import type { CapabilitiesDocument } from './capabilities-document.ts';
import type { Carrier } from './carrier.ts';
import type { CommandReceipt } from './command-receipt.ts';
import type { InvocationSession } from './invocation-session.ts';
import type { InvokeResponse } from './invoke-response.ts';
import type { Invoker } from './invoker.ts';
import type { Emitted, LiveFrame, StreamControl } from './live-frame.ts';
import type { Outcome } from './outcome.ts';

test('Outcome narrows on ok', () => {
  const outcome = null as unknown as Outcome<number>;
  if (outcome.ok) {
    expectTypeOf(outcome.value).toEqualTypeOf<number>();
    expectTypeOf(outcome.receipt).toEqualTypeOf<CommandReceipt | undefined>();
    expectTypeOf(outcome.replayed).toEqualTypeOf<true | undefined>();
    expectTypeOf(outcome).not.toHaveProperty('error');
  } else {
    expectTypeOf(outcome.error).toEqualTypeOf<KeelwerkError>();
    expectTypeOf(outcome).not.toHaveProperty('value');
  }
});

test('the invoker opens sessions and returns outcomes', () => {
  expectTypeOf<ReturnType<Invoker['open']>>().toEqualTypeOf<Promise<Outcome<InvocationSession>>>();
  expectTypeOf<ReturnType<Invoker['invoke']>>().toEqualTypeOf<Promise<Outcome<unknown>>>();
  expectTypeOf<ReturnType<Invoker['subscribe']>>().toEqualTypeOf<
    AsyncIterable<LiveFrame<unknown>>
  >();
});

test('InvocationSession carries apiVersion, deprecation and revalidate', () => {
  expectTypeOf<InvocationSession['apiVersion']>().toEqualTypeOf<string>();
  expectTypeOf<InvocationSession['deprecation']>().toEqualTypeOf<{
    readonly at: string;
    readonly sunset?: string;
  } | null>();
  expectTypeOf<ReturnType<InvocationSession['revalidate']>>().toEqualTypeOf<
    Promise<Outcome<InvocationSession>>
  >();
});

test('the carrier carries the listener members of gap G1', () => {
  expectTypeOf<Carrier>().toHaveProperty('connection');
  expectTypeOf<Carrier>().toHaveProperty('sasl');
  expectTypeOf<Carrier>().toHaveProperty('scopeKey');
  expectTypeOf<Carrier>().toHaveProperty('local');
  expectTypeOf<Carrier>().toHaveProperty('transport');
});

test('a PrincipalResolver returns a generator, never a promise', () => {
  type Returned = ReturnType<PrincipalResolver['resolve']>;
  expectTypeOf<Returned>().toExtend<Generator>();
  expectTypeOf<Returned>().not.toExtend<PromiseLike<unknown>>();
  expectTypeOf<ReturnType<PrincipalEnricher['enrich']>>().toExtend<Generator>();
  expectTypeOf<ReturnType<PrincipalEnricher['enrich']>>().not.toExtend<PromiseLike<unknown>>();
});

test('an AdmissionRule returns a verdict or a generator of one, never a promise', () => {
  type Returned = ReturnType<AdmissionRule>;
  expectTypeOf<Returned>().toEqualTypeOf<AdmissionVerdict | Gen<AdmissionVerdict>>();
  expectTypeOf<Returned>().not.toExtend<PromiseLike<unknown>>();
});

test('a TenantResolver is refused by kind, scopeKey and path included', () => {
  expectTypeOf<TenantResolver['kind']>().toEqualTypeOf<
    'hostname' | 'header' | 'scopeKey' | 'path'
  >();
});

test('FieldNode kinds cover the table of section 16.2.3', () => {
  expectTypeOf<FieldNode['kind']>().toEqualTypeOf<
    | 'string'
    | 'text'
    | 'integer'
    | 'decimal'
    | 'serial'
    | 'boolean'
    | 'float'
    | 'instant'
    | 'date'
    | 'timeZone'
    | 'subject'
    | 'richText'
    | 'binary'
    | 'blob'
    | 'secret'
    | 'void'
    | 'enum'
    | 'id'
    | 'ref'
    | 'list'
    | 'set'
    | 'shape'
    | 'json'
    | 'page'
    | 'foreign'
  >();
  const node = null as unknown as FieldNode;
  if (node.kind === 'shape')
    expectTypeOf(node.fields).toEqualTypeOf<Readonly<Record<string, FieldNode>>>();
  if (node.kind === 'enum') expectTypeOf(node.values).toEqualTypeOf<readonly string[]>();
  if (node.kind === 'integer') expectTypeOf(node.wide).toEqualTypeOf<boolean>();
});

test('TransportHost uses web-standard Request and Response only', () => {
  expectTypeOf<HttpHandler>().toEqualTypeOf<
    (request: Request, ctx: HttpContext) => Promise<Response>
  >();
  expectTypeOf<Parameters<TransportHost['route']>[1]>().toEqualTypeOf<HttpHandler>();
  expectTypeOf<HttpContext['session']>().toEqualTypeOf<InvocationSession>();
});

test('startRuntime takes a deployment and options and returns a runtime', () => {
  expectTypeOf<StartRuntime>().toEqualTypeOf<
    (deployment: DeploymentDefinition, options: RuntimeOptions) => Promise<Runtime>
  >();
  expectTypeOf<RuntimeOptions['role']>().toEqualTypeOf<'serve' | 'work' | 'all'>();
  expectTypeOf<Runtime['invoker']>().toEqualTypeOf<Invoker>();
  expectTypeOf<Runtime['registry']>().toEqualTypeOf<(appId: string) => Registry>();
});

test('PrincipalResolver.resolve receives the scope and a clock', () => {
  expectTypeOf<Parameters<PrincipalResolver['resolve']>[1]>().toEqualTypeOf<{
    readonly scope: Scope;
    readonly clock: { now(): Temporal.Instant };
  }>();
});

test('InvokeResponse narrows on ok', () => {
  const response = null as unknown as InvokeResponse;
  if (response.ok) {
    expectTypeOf(response.value).toEqualTypeOf<unknown>();
    expectTypeOf(response.commandId).toEqualTypeOf<string | undefined>();
    expectTypeOf(response).not.toHaveProperty('error');
  } else {
    expectTypeOf(response.error).toEqualTypeOf<WireError>();
    expectTypeOf(response).not.toHaveProperty('value');
  }
});

test('AdmissionVerdict narrows on kind', () => {
  const verdict = null as unknown as AdmissionVerdict;
  if (verdict.kind === 'charge') expectTypeOf(verdict.demand).toEqualTypeOf<BucketDemand>();
  else expectTypeOf(verdict.error).toEqualTypeOf<KeelwerkError>();
});

test('ResponseHint narrows on kind', () => {
  const hint = null as unknown as ResponseHint;
  if (hint.kind === 'raw') expectTypeOf(hint.contentType).toEqualTypeOf<string>();
  if (hint.kind === 'redirect')
    expectTypeOf(hint.status).toEqualTypeOf<302 | 303 | 307 | undefined>();
  if (hint.kind === 'empty') expectTypeOf(hint.status).toEqualTypeOf<202 | 204 | undefined>();
  if (hint.kind === 'json') expectTypeOf(hint).not.toHaveProperty('from');
});

test('Artifact narrows on kind', () => {
  const artifact = null as unknown as Artifact;
  if (artifact.kind === 'file') expectTypeOf(artifact.path).toEqualTypeOf<string>();
  else expectTypeOf(artifact).not.toHaveProperty('path');
});

test('StreamControl narrows on control and LiveFrame joins items to controls', () => {
  const control = null as unknown as StreamControl;
  if (control.control === 'head') expectTypeOf(control.state).toEqualTypeOf<StateToken>();
  if (control.control === 'reset') {
    expectTypeOf(control.reason).toEqualTypeOf<'overflow' | 'expired' | 'resync'>();
  }
  if (control.control === 'gap') expectTypeOf(control.missed).toEqualTypeOf<number | undefined>();
  expectTypeOf<StreamControl>().toExtend<LiveFrame<number>>();
  expectTypeOf<Emitted<number>>().toExtend<LiveFrame<number>>();
});

test('Carrier.local is a socket or in-process', () => {
  type Local = NonNullable<Carrier['local']>;
  expectTypeOf<Local>().toEqualTypeOf<{ readonly socket: string } | { readonly inProcess: true }>();
  const local = null as unknown as Local;
  if ('socket' in local) expectTypeOf(local.socket).toEqualTypeOf<string>();
  else expectTypeOf(local.inProcess).toEqualTypeOf<true>();
});

test('TenantResolver narrows to the header variant', () => {
  const resolver = null as unknown as TenantResolver;
  if (resolver.kind === 'header') {
    expectTypeOf(resolver.header).toEqualTypeOf<string>();
    expectTypeOf(resolver.backendHeader).toEqualTypeOf<string | undefined>();
  } else {
    expectTypeOf(resolver).not.toHaveProperty('header');
  }
});

test('the contract carries the resolved-by, input, cookie and upgrade members', () => {
  expectTypeOf<InvocationSession['resolvedBy']>().toEqualTypeOf<
    'hostname' | 'header' | 'scopeKey' | 'path' | 'local'
  >();
  expectTypeOf<AdmissionInput['input']>().toEqualTypeOf<unknown>();
  expectTypeOf<PrincipalResolution['clearCookies']>().toEqualTypeOf<
    readonly string[] | undefined
  >();
  expectTypeOf<TransportHost['fetch']>().toEqualTypeOf<
    (request: Request, options?: HostFetchOptions) => Promise<Response>
  >();
  expectTypeOf<Parameters<TransportHost['upgrade']>[1]>().toEqualTypeOf<WebSocketHandler>();
  expectTypeOf<CapabilitiesDocument['apiVersions'][number]['status']>().toEqualTypeOf<
    'current' | 'deprecated' | 'retired'
  >();
  expectTypeOf<DeploymentDefinition['apps']>().toEqualTypeOf<readonly { readonly id: string }[]>();
});
