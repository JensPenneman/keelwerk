import { defineHook } from '@keelwerk/core';
import { authBase } from '../base.ts';

/** A tenant is its own authentication realm and starts with no credentials, so there is nothing to provision (17.2.8). */
export const onTenantCreated = defineHook(authBase, 'onTenantCreated', () => []);
