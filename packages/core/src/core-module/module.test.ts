import { describe, expect, test } from 'vitest';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { coreBase } from './base.ts';
import { core } from './module.ts';

describe('the core module (S-11, S-26)', () => {
  test('is the module of the base, with the control entities', () => {
    expect(core.id).toBe('core');
    expect(core.base).toBe(coreBase);
    expect(Object.keys(core.entities)).toEqual([
      'backend',
      'tenant',
      'domain',
      'placement',
      'namespace',
      'operatorToken',
      'commandReceipt',
      'effect',
      'process',
    ]);
  });

  test('every control entity has a distinct TypeID prefix', () => {
    const prefixes = Object.values(core.entities).map((entity) => entity.prefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  test('the control entities live at deployment scope', () => {
    expect(core.entities.backend.tenancy).toBe('deployment');
    expect(core.entities.tenant.tenancy).toBe('deployment');
    expect(core.entities.domain.tenancy).toBe('deployment');
    expect(core.entities.commandReceipt.tenancy).toBe('invocation');
    expect(core.entities.effect.tenancy).toBe('invocation');
  });

  test('mounts the M1 actions', () => {
    expect(Object.keys(core.actions)).toEqual(['introspect', 'composition', 'me', 'capabilities']);
    expect(Object.keys(core.entities.tenant.actions)).toEqual(['enter', 'setApiVersion']);
    expect(Object.keys(core.entities.operatorToken.actions)).toEqual(['revoke']);
    expect(core.actions.introspect.ref).toBe('core.introspect');
    expect(core.entities.tenant.actions.enter.ref).toBe('core.tenant.enter');
  });

  test('the operator commands refuse until their runtime exists', () => {
    const decide = core.entities.tenant.actions.enter.spec as { decide: () => never };
    try {
      decide.decide();
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(KeelwerkError);
      expect((error as KeelwerkError).code).toBe('core.not_implemented');
    }
  });

  test('the transports point is declared for transport modules to fill', () => {
    expect(core.extensionPoints.transports.mode).toBe('set');
  });
});
