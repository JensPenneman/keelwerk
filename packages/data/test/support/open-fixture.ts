import { PGlite } from '@electric-sql/pglite';
import { frameworkTablesDdl } from '../../src/sql/postgres/framework-tables.ts';
import { fixtureDdl } from './fixture-ddl.ts';
import { id } from './id.ts';
import { insertRow } from './insert-row.ts';
import { member } from './member.ts';
import { note } from './note.ts';
import { noteRow } from './note-row.ts';
import { notes } from './notes.ts';
import { stamp } from './stamp.ts';
import { team } from './team.ts';
import { teamBlue } from './team-blue.ts';
import { teamOther } from './team-other.ts';
import { teamRed } from './team-red.ts';
import { tenant1 } from './tenant1.ts';
import { tenant2 } from './tenant2.ts';

/** An in-process PostgreSQL holding the fixture entities of two tenants. */
export async function openFixture(): Promise<PGlite> {
  const pg = new PGlite();
  for (const statement of frameworkTablesDdl('app')) await pg.exec(statement);
  await pg.exec(fixtureDdl);
  for (const row of notes) await insertRow(pg, note, tenant1, row);
  await insertRow(pg, note, tenant2, noteRow(50, { title: 'alpha', count: 1 }));
  await insertRow(pg, team, tenant1, { id: teamRed, name: 'red' });
  await insertRow(pg, team, tenant1, { id: teamBlue, name: 'blue' });
  await insertRow(pg, team, tenant2, { id: teamOther, name: 'red' });
  const members: [number, string, string, boolean][] = [
    [801, teamRed, 'admin', false],
    [802, teamRed, 'user', false],
    [803, teamBlue, 'user', false],
    [804, teamBlue, 'admin', true],
  ];
  for (const [n, teamId, role, archived] of members) {
    await insertRow(pg, member, tenant1, {
      id: id(n),
      teamId,
      userId: `u${n}`,
      role,
      ...(archived ? { archivedAt: stamp } : {}),
    });
  }
  await pg.query('insert into app.kw_positions (scope_id, next, epoch) values ($1, 42, 1)', [
    tenant1,
  ]);
  return pg;
}
