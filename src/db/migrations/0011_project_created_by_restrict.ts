import { sql } from 'kysely';
import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table project drop constraint project_created_by_fkey`.execute(db);
  await sql`
    alter table project
    add constraint project_created_by_fkey
    foreign key (created_by) references app_user (id) on delete restrict
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table project drop constraint project_created_by_fkey`.execute(db);
  await sql`
    alter table project
    add constraint project_created_by_fkey
    foreign key (created_by) references app_user (id) on delete cascade
  `.execute(db);
}
