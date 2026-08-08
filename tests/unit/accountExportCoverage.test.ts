import { sql } from 'kysely';
import { describe, it, expect } from 'vitest';
import { db } from '../helpers/database';

// Every foreign key into app_user, each decided once. A new user-keyed table
// fails this until someone decides which side it belongs on.
//
// Foreign keys only: personal data keyed by email address — the shape
// project_invitation already uses — or by a token or any soft reference is
// invisible here, so this bounds the rot, it does not end it.
const DECIDED: Record<string, 'in' | 'out'> = {
  'feedback.user_id': 'in',
  'pending_assignment_notification.actor_user_id': 'out',
  'pending_assignment_notification.recipient_user_id': 'out',
  'personal_access_token.user_id': 'in',
  'project.created_by': 'in',
  'project_invitation.invited_by': 'out',
  'project_member.user_id': 'in',
  'project_user_position.user_id': 'out',
  'project_user_seen.user_id': 'out',
  'session.user_id': 'in',
  'task_activity.actor_user_id': 'out',
  'task_assignee.user_id': 'out',
  'task_comment.user_id': 'out',
  'task_series.created_by': 'out',
  'task_series_assignee.user_id': 'out',
};

// Every column of the four account-owned tables the export reads, each decided
// once. A new column on one of them is the likelier rot — the two notification
// preferences arrived exactly that way. "in" means the value reaches the file.
//
// project and project_member are out of this census on purpose: the export takes
// a pointer list from them, so their columns churn for board reasons that say
// nothing about what is held about a person.
const EXPORT_READS = ['app_user', 'feedback', 'personal_access_token', 'session'];
const DECIDED_COLUMNS: Record<string, 'in' | 'out'> = {
  'app_user.alternative_id': 'out',
  'app_user.avatar_content_type': 'out',
  'app_user.avatar_storage_key': 'in',
  'app_user.created_at': 'in',
  'app_user.email': 'in',
  'app_user.email_verified_at': 'in',
  'app_user.id': 'in',
  'app_user.name': 'in',
  'app_user.notify_added_to_project': 'in',
  'app_user.notify_bulk_task_assigned': 'in',
  'app_user.notify_task_assigned': 'in',
  'app_user.password_hash': 'out',
  'feedback.created_at': 'in',
  'feedback.id': 'in',
  'feedback.message': 'in',
  'feedback.page_path': 'in',
  'feedback.user_id': 'out',
  'personal_access_token.created_at': 'in',
  'personal_access_token.expires_at': 'in',
  'personal_access_token.id': 'in',
  'personal_access_token.last_used_at': 'in',
  'personal_access_token.name': 'in',
  'personal_access_token.token_hash': 'out',
  'personal_access_token.user_id': 'out',
  'session.created_at': 'in',
  'session.expires_at': 'in',
  'session.id': 'in',
  'session.token_hash': 'out',
  'session.user_agent': 'in',
  'session.user_id': 'out',
};

describe('account export coverage', () => {
  it('has a decision recorded for every foreign key into app_user', async () => {
    const { rows } = await sql<{ column_ref: string }>`
      select src.relname || '.' || att.attname as column_ref
      from pg_constraint con
      join pg_class src on src.oid = con.conrelid
      join pg_class tgt on tgt.oid = con.confrelid
      cross join lateral unnest(con.conkey) as k(attnum)
      join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k.attnum
      where con.contype = 'f'
        and tgt.relname = 'app_user'
        and tgt.relnamespace = 'public'::regnamespace
      order by 1
    `.execute(db);

    const live = rows.map((row) => row.column_ref).sort();
    const decided = Object.keys(DECIDED).sort();

    expect(live.filter((ref) => !decided.includes(ref))).toEqual([]);
    expect(decided.filter((ref) => !live.includes(ref))).toEqual([]);
  });

  it('has a decision recorded for every column of the tables it reads', async () => {
    const { rows } = await sql<{ column_ref: string }>`
      select rel.relname || '.' || att.attname as column_ref
      from pg_class rel
      join pg_attribute att on att.attrelid = rel.oid
      where rel.relname::text = any(${sql.val(EXPORT_READS)})
        and rel.relnamespace = 'public'::regnamespace
        and rel.relkind = 'r'
        and att.attnum > 0
        and not att.attisdropped
      order by 1
    `.execute(db);

    const live = rows.map((row) => row.column_ref).sort();
    const decided = Object.keys(DECIDED_COLUMNS).sort();

    expect(live.filter((ref) => !decided.includes(ref))).toEqual([]);
    expect(decided.filter((ref) => !live.includes(ref))).toEqual([]);
  });
});
