import { defineContribution } from '@keelwerk/core';
import { members } from '../../../src/module.generated.ts';

/** What the test postbox adds to members: a delivery filler for invitations. */
export const toMembers = defineContribution(members, {});
