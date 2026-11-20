import { describe, expect, test } from 'vitest';
import { aloneApp } from './support/boot-audit.ts';

describe('the stored format of an audit entry', () => {
  test('the stored fields of audit.entry are the final ones', () => {
    const descriptor = aloneApp.registry.entities.get('audit.entry')?.descriptor;
    if (descriptor === undefined) throw new Error('no audit.entry');
    const shown = Object.fromEntries(
      Object.entries(descriptor.fields).map(([name, member]) => [
        name,
        {
          kind: member.kind,
          optional: member.optional,
          personal: member.personal !== false,
          unique: member.unique,
          indexed: member.indexed,
          maxLength: member.constraints.maxLength ?? null,
        },
      ]),
    );
    expect({
      table: descriptor.table,
      history: descriptor.history,
      tenancy: descriptor.tenancy,
      dataSubject: descriptor.dataSubject,
      fields: shown,
    }).toMatchInlineSnapshot(`
      {
        "dataSubject": "subject",
        "fields": {
          "action": {
            "indexed": false,
            "kind": "string",
            "maxLength": null,
            "optional": true,
            "personal": false,
            "unique": false,
          },
          "actorId": {
            "indexed": false,
            "kind": "string",
            "maxLength": null,
            "optional": true,
            "personal": false,
            "unique": false,
          },
          "actorKind": {
            "indexed": false,
            "kind": "enum",
            "maxLength": null,
            "optional": false,
            "personal": false,
            "unique": false,
          },
          "actorVia": {
            "indexed": false,
            "kind": "string",
            "maxLength": null,
            "optional": false,
            "personal": false,
            "unique": false,
          },
          "at": {
            "indexed": false,
            "kind": "instant",
            "maxLength": null,
            "optional": false,
            "personal": false,
            "unique": false,
          },
          "causationId": {
            "indexed": false,
            "kind": "string",
            "maxLength": null,
            "optional": true,
            "personal": false,
            "unique": false,
          },
          "commandId": {
            "indexed": false,
            "kind": "string",
            "maxLength": null,
            "optional": true,
            "personal": false,
            "unique": false,
          },
          "eventId": {
            "indexed": false,
            "kind": "string",
            "maxLength": null,
            "optional": false,
            "personal": false,
            "unique": true,
          },
          "eventType": {
            "indexed": false,
            "kind": "string",
            "maxLength": null,
            "optional": false,
            "personal": false,
            "unique": false,
          },
          "remoteAddress": {
            "indexed": false,
            "kind": "string",
            "maxLength": 64,
            "optional": true,
            "personal": true,
            "unique": false,
          },
          "streamId": {
            "indexed": false,
            "kind": "string",
            "maxLength": null,
            "optional": false,
            "personal": false,
            "unique": false,
          },
          "streamType": {
            "indexed": false,
            "kind": "string",
            "maxLength": null,
            "optional": false,
            "personal": false,
            "unique": false,
          },
          "streamVersion": {
            "indexed": false,
            "kind": "integer",
            "maxLength": null,
            "optional": false,
            "personal": false,
            "unique": false,
          },
          "subject": {
            "indexed": true,
            "kind": "subject",
            "maxLength": null,
            "optional": true,
            "personal": false,
            "unique": false,
          },
          "transport": {
            "indexed": false,
            "kind": "string",
            "maxLength": null,
            "optional": true,
            "personal": false,
            "unique": false,
          },
          "userAgent": {
            "indexed": false,
            "kind": "string",
            "maxLength": 512,
            "optional": true,
            "personal": true,
            "unique": false,
          },
        },
        "history": "state",
        "table": "audit__entry",
        "tenancy": "tenant",
      }
    `);
  });
});
