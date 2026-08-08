import crypto from 'crypto';
import { Hono } from 'hono';
import { describeRoute, resolver } from 'hono-openapi';
import type { Updateable } from 'kysely';
import type { AppUser } from '../db/types';
import { bearerToken, skipAuth } from '../middleware/auth';
import { jsonValidator } from '../middleware/jsonValidator';
import { paramValidator } from '../middleware/requestValidator';
import {
  enforceAuthRateLimit,
  enforceResetRateLimit,
  enforceSignupRateLimit,
  enforceVerificationRateLimit,
} from '../middleware/rateLimit';
import { AppError, isUniqueViolation } from '../utils/errors';
import { passwordResetLink } from '../services/webLinks';
import { APP_NAME } from '../config/constants';
import { isValidUuid } from '../types/uuid';
import {
  assignedTasksElsewhere,
  deleteUnsharedProjects,
  lockOwnedProjects,
  memberProjectIds,
  storageKeysOwnedBy,
} from '../services/accountDeletion';
import { avatarUrl } from '../services/avatars';
import {
  crossProjectDependentsOf,
  publishCrossProjectBlockerCounts,
  refreshCrossProjectBlockerCounts,
} from '../services/crossProjectBlockers';
import { getEmailSender } from '../services/email/index';
import { hashPassword, verifyPassword, verifyDummyPassword } from '../services/passwords';
import { PROJECT_COLUMNS, fetchMembers, publishProjectListItem } from '../services/projectListItem';
import {
  emailAddressHash,
  verifyUnsubscribeToken,
  verifyVerificationToken,
} from '../services/emailToken';
import { NOTIFICATION_KINDS, NOTIFY_COLUMN } from '../services/notifications';
import type { NotificationKind } from '../schemas/notifications';
import { enqueueVerificationEmail } from '../services/emailVerification';
import { claimInvitationsForNewAccount } from '../services/invitations';
import { createResetToken, verifyResetTokenDetailed } from '../services/resetToken';
import {
  ACCOUNT_UPDATED,
  SESSIONS_REVOKED,
  USER_UPDATED,
  publishAfterCommit,
} from '../services/realtime/index';
import { deleteStoredObjectsAfterCommit } from '../services/storage/cleanup';
import { fetchTaskRelations, publishTaskRelationsSet } from '../services/taskRelations';
import {
  MAX_PERSONAL_ACCESS_TOKENS_PER_USER,
  generatePersonalAccessToken,
} from '../services/personalAccessTokens';
import { createSession, deleteSessionByTokenHash, hashBearerToken } from '../services/sessions';
import { clearSessionCookie, setSessionCookie } from '../services/sessionCookie';
import { accountExportFilename, buildAccountExport } from '../services/export/account';
import {
  accountExportSchema,
  signupRequestSchema,
  loginRequestSchema,
  authResponseSchema,
  patchMeSchema,
  changePasswordSchema,
  deleteAccountSchema,
  deleteAccountConflictSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  emailTokenRequestSchema,
  notificationSettingsSchema,
  unsubscribeResponseSchema,
  meSchema,
  idSchema,
  createPersonalAccessTokenSchema,
  createdPersonalAccessTokenSchema,
  personalAccessTokensResponseSchema,
  sessionsResponseSchema,
  badRequestErrorResponse,
  unauthorizedErrorResponse,
  notFoundErrorResponse,
  conflictErrorResponse,
  validationErrorResponse,
  validationOrUnprocessableErrorResponse,
  unprocessableErrorResponse,
  tooManyRequestsErrorResponse,
  internalServerErrorResponse,
  type PersonalAccessTokenResponse,
} from '../schemas/index';
import { AppContext, AppHono, PublicContext, PublicHono } from '../types/index';

const router: AppHono = new Hono();

// Signing up, logging in and acting on an emailed token all happen without a
// session, so those routes take the context where `user` may be absent. Both
// routers mount at /api/auth; the marker is per-route precisely so the two can
// share a prefix without one leaking its auth behaviour onto the other.
export const publicAuthRouter: PublicHono = new Hono();

const MAX_TOKEN_LIFETIME_MS = 100 * 365 * 24 * 60 * 60 * 1000;

function toTokenResponse(row: {
  id: string;
  name: string;
  created_at: Date;
  expires_at: Date | null;
  last_used_at: Date | null;
}): PersonalAccessTokenResponse {
  return {
    id: row.id,
    name: row.name,
    created_at: row.created_at.toISOString(),
    expires_at: row.expires_at === null ? null : row.expires_at.toISOString(),
    last_used_at: row.last_used_at === null ? null : row.last_used_at.toISOString(),
  };
}

const INVALID_UNSUBSCRIBE_MESSAGE = 'This unsubscribe link is not valid';

// A null account means the link no longer names a live mailbox — the account is
// gone or has moved. The response is identical either way, which is what keeps
// these endpoints silent about whether an account exists.
async function unsubscribeTarget(
  c: Pick<PublicContext, 'get'>,
  token: string
): Promise<{ kind: NotificationKind; account: { id: string; email: string } | null }> {
  const verification = verifyUnsubscribeToken(token);
  if (verification.status === 'invalid') {
    throw new AppError(422, INVALID_UNSUBSCRIBE_MESSAGE);
  }

  const row = await c
    .get('db')
    .selectFrom('app_user')
    .select('email')
    .where('id', '=', verification.user_id)
    .executeTakeFirst();
  const bound = row !== undefined && emailAddressHash(row.email) === verification.email_hash;

  return {
    kind: verification.kind,
    account: bound && row !== undefined ? { id: verification.user_id, email: row.email } : null,
  };
}

// Only ever writes false. That is what bounds a non-expiring bearer token to
// nothing: replay is idempotent and a leaked link cannot switch anything on.
async function switchOffNotifications(
  c: Pick<PublicContext, 'get'>,
  account: { id: string; email: string },
  kinds: NotificationKind[]
): Promise<void> {
  const changes: Partial<Record<(typeof NOTIFY_COLUMN)[NotificationKind], boolean>> = {};
  for (const kind of kinds) {
    changes[NOTIFY_COLUMN[kind]] = false;
  }

  await c
    .get('db')
    .updateTable('app_user')
    .set(changes)
    .where('id', '=', account.id)
    // Re-asserted rather than locked: an address change committing since it was
    // read would otherwise let a link that move retired write anyway.
    .where('email', '=', account.email)
    .execute();
}

async function applyUnsubscribe(
  c: Pick<PublicContext, 'get'>,
  token: string
): Promise<NotificationKind> {
  const { kind, account } = await unsubscribeTarget(c, token);
  if (account !== null) {
    await switchOffNotifications(c, account, [kind]);
  }

  return kind;
}

// Sessions are deliberately left alone: they are managed from the sessions
// screen, which can revoke them one at a time. Rotating alternative_id is about
// reset links, not sessions — it makes the link that got here single-use.
async function setPassword(
  c: Pick<PublicContext, 'get'>,
  userId: string,
  newPassword: string
): Promise<void> {
  await c
    .get('db')
    .updateTable('app_user')
    .set({ password_hash: await hashPassword(newPassword), alternative_id: crypto.randomUUID() })
    .where('id', '=', userId)
    .execute();
}

function callerTokenHash(c: AppContext): string | null {
  const token = bearerToken(c);
  return token === null ? null : hashBearerToken(token);
}

publicAuthRouter.post(
  '/signup',
  describeRoute({
    tags: ['Auth'],
    summary: 'Sign up',
    description:
      'Create a new user account and start a session. The client supplies the user id. A ' +
      'verification email is sent to the address; the account is usable immediately and ' +
      '`email_verified` starts false. Account creation is capped at 50 an hour per source ' +
      'IP, whatever addresses are used: past that the call answers 429 and creates nothing. ' +
      'Every unexpired invitation outstanding for the address, across every project, takes ' +
      'effect here and the account joins those boards at the invited role.',
    responses: {
      201: {
        description: 'Account created',
        content: {
          'application/json': {
            schema: resolver(authResponseSchema),
          },
        },
      },
      ...validationErrorResponse,
      ...conflictErrorResponse,
      ...tooManyRequestsErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  skipAuth,
  jsonValidator(signupRequestSchema),
  async (c) => {
    const { id, email, password, name } = c.req.valid('json');
    await enforceSignupRateLimit(c);
    await enforceAuthRateLimit(c, email);

    const db = c.get('db');

    const existing = await db
      .selectFrom('app_user')
      .select('id')
      .where((eb) => eb(eb.fn<string>('lower', ['email']), '=', email.toLowerCase()))
      .executeTakeFirst();
    if (existing) {
      throw new AppError(409, 'Email already in use');
    }

    const passwordHash = await hashPassword(password);

    try {
      await db
        .insertInto('app_user')
        .values({ id, email, password_hash: passwordHash, name })
        .execute();
    } catch (err) {
      // Constraint race can bypass the pre-check; covers both the unique
      // lower(email) index and a duplicate client-supplied id.
      if (isUniqueViolation(err)) {
        throw new AppError(409, 'Email or user id already in use');
      }
      throw err;
    }

    const { token } = await createSession(c, id);
    setSessionCookie(c, token);
    enqueueVerificationEmail(c, { id, email });
    await claimInvitationsForNewAccount(c, db, id, email);

    return c.json(
      { token, user: { id, email, name, avatar_url: null, email_verified: false } },
      201
    );
  }
);

publicAuthRouter.post(
  '/login',
  describeRoute({
    tags: ['Auth'],
    summary: 'Log in',
    description: 'Exchange email and password for a session token.',
    responses: {
      200: {
        description: 'Logged in',
        content: {
          'application/json': {
            schema: resolver(authResponseSchema),
          },
        },
      },
      ...validationErrorResponse,
      ...unauthorizedErrorResponse,
      ...tooManyRequestsErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  skipAuth,
  jsonValidator(loginRequestSchema),
  async (c) => {
    const { email, password } = c.req.valid('json');
    await enforceAuthRateLimit(c, email);

    const db = c.get('db');

    const user = await db
      .selectFrom('app_user')
      .select(['id', 'email', 'name', 'avatar_storage_key', 'password_hash', 'email_verified_at'])
      .where((eb) => eb(eb.fn<string>('lower', ['email']), '=', email.toLowerCase()))
      .executeTakeFirst();

    if (!user) {
      await verifyDummyPassword(password);
      throw new AppError(401, 'Invalid email or password');
    }

    const valid = await verifyPassword(user.password_hash, password);
    if (!valid) {
      throw new AppError(401, 'Invalid email or password');
    }

    const { token } = await createSession(c, user.id);
    setSessionCookie(c, token);

    return c.json(
      {
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          avatar_url: avatarUrl(user.avatar_storage_key),
          email_verified: user.email_verified_at !== null,
        },
      },
      200
    );
  }
);

router.post(
  '/logout',
  describeRoute({
    tags: ['Auth'],
    summary: 'Log out',
    description: 'Delete the current session.',
    security: [{ bearerAuth: [] }],
    responses: {
      204: {
        description: 'Session deleted',
      },
      ...unauthorizedErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  async (c) => {
    const hash = callerTokenHash(c);
    if (hash !== null) {
      await deleteSessionByTokenHash(c.get('db'), hash);
    }
    clearSessionCookie(c);
    return c.body(null, 204);
  }
);

router.get(
  '/me',
  describeRoute({
    tags: ['Auth'],
    summary: 'Current user',
    description: 'Return the authenticated user.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Authenticated user',
        content: {
          'application/json': {
            schema: resolver(meSchema),
          },
        },
      },
      ...unauthorizedErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  async (c) => {
    return c.json(c.get('user'), 200);
  }
);

router.patch(
  '/me',
  describeRoute({
    tags: ['Auth'],
    summary: 'Update current user',
    description:
      'Update the name and/or email of the authenticated user. Moving to a different mailbox ' +
      'invalidates any outstanding password-reset tokens, resets `email_verified` to false and ' +
      'sends a verification email to the new address; a change of letter case alone does ' +
      'neither. The verification send shares the resend budget, so an exhausted budget answers ' +
      '429 and changes nothing.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Updated user',
        content: {
          'application/json': {
            schema: resolver(meSchema),
          },
        },
      },
      ...unauthorizedErrorResponse,
      ...conflictErrorResponse,
      ...validationErrorResponse,
      ...tooManyRequestsErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  jsonValidator(patchMeSchema),
  async (c) => {
    const { name, email } = c.req.valid('json');
    const user = c.get('user');
    const db = c.get('db');

    const updates: Updateable<AppUser> = {};
    let newMailbox = false;
    if (name !== undefined && name !== user.name) updates.name = name;
    if (email !== undefined && email !== user.email) {
      updates.email = email;
      if (email.toLowerCase() !== user.email.toLowerCase()) {
        newMailbox = true;
        // New mailbox: rotate so reset tokens sent to the old address die now
        // instead of staying valid for their remaining TTL.
        updates.alternative_id = crypto.randomUUID();
        updates.email_verified_at = null;
      }
    }

    if (Object.keys(updates).length === 0) {
      return c.json(user, 200);
    }

    const newEmail = updates.email;
    if (newEmail !== undefined) {
      const taken = await db
        .selectFrom('app_user')
        .select('id')
        .where((eb) => eb(eb.fn<string>('lower', ['email']), '=', newEmail.toLowerCase()))
        .where('id', '!=', user.id)
        .executeTakeFirst();
      if (taken) {
        throw new AppError(409, 'Email already in use');
      }
    }

    // Ahead of the write: committing the address while dropping the mail would
    // strand the account on an unverified address with no way to learn why.
    if (newMailbox) {
      await enforceVerificationRateLimit(c, user.id);
    }

    try {
      const row = await db
        .updateTable('app_user')
        .set(updates)
        .where('id', '=', user.id)
        .returning(['id', 'email', 'name'])
        .executeTakeFirstOrThrow();
      const publicUser = { id: row.id, name: row.name, avatar_url: user.avatar_url };
      publishAfterCommit(c, USER_UPDATED, null, publicUser);
      const me = {
        ...publicUser,
        email: row.email,
        email_verified: newMailbox ? false : user.email_verified,
      };
      // Gated on the stored address moving at all rather than on newMailbox: a
      // change of letter case alone persists a different string, and this is the
      // only event carrying it, so gating it lower would leave the account's
      // other devices on the old casing indefinitely. The mail and the
      // verification reset stay newMailbox-only.
      if (updates.email !== undefined) {
        publishAfterCommit(c, ACCOUNT_UPDATED, null, me, { recipientUserIds: [row.id] });
      }
      if (newMailbox) {
        enqueueVerificationEmail(c, row);
      }
      return c.json(me, 200);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppError(409, 'Email already in use');
      }
      throw err;
    }
  }
);

router.delete(
  '/me',
  describeRoute({
    tags: ['Auth'],
    summary: 'Delete account',
    description:
      'Permanently delete the authenticated account. The current password must be re-supplied. ' +
      'This removes the account, every session and personal access token, every project the ' +
      'caller created together with its columns, tasks, labels, dependencies, comments, ' +
      'activity, webhooks and images, their memberships and task assignments in other ' +
      "people's projects, their comments and activity entries there, and their submitted " +
      'feedback. Stored avatar and image objects are removed after the transaction commits. ' +
      'It answers 409 with a blocking_projects list while the caller still owns a project ' +
      'that has other members: hand each one over with PUT /api/projects/{id}/owner, or ' +
      'delete it, and retry. Deletion cannot be undone.',
    security: [{ bearerAuth: [] }],
    responses: {
      204: {
        description: 'Account deleted',
      },
      ...unauthorizedErrorResponse,
      409: {
        description: 'The caller still owns projects that have other members',
        content: {
          'application/json': {
            schema: resolver(deleteAccountConflictSchema),
          },
        },
      },
      ...validationErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  jsonValidator(deleteAccountSchema),
  async (c) => {
    const { password } = c.req.valid('json');
    const user = c.get('user');
    const db = c.get('db');

    const row = await db
      .selectFrom('app_user')
      .select(['password_hash', 'avatar_storage_key'])
      .where('id', '=', user.id)
      .executeTakeFirstOrThrow();

    if (!(await verifyPassword(row.password_hash, password))) {
      throw new AppError(401, 'Password is incorrect');
    }

    const owned = await lockOwnedProjects(db, user.id);
    const blocking = owned
      .filter((project) => project.shared)
      .map((project) => ({ id: project.id, name: project.name }));
    if (blocking.length > 0) {
      // Returned, not thrown: errorHandler copies every AppError message into
      // the log line, and this one names boards. Keep the guard ahead of the
      // first write — returning commits the transaction.
      return c.json(
        {
          error:
            'You still own projects that other people are members of: ' +
            `${blocking.map((project) => project.name).join(', ')}. ` +
            'Transfer or delete them first.',
          blocking_projects: blocking,
        },
        409
      );
    }

    const storageKeys = await storageKeysOwnedBy(db, user.id, row.avatar_storage_key);
    const assignedTasks = await assignedTasksElsewhere(db, user.id);
    const affectedProjectIds = [
      ...new Set([
        ...(await memberProjectIds(db, user.id)),
        ...assignedTasks.map((task) => task.project_id),
      ]),
    ];
    const tokenRows = await db
      .selectFrom('personal_access_token')
      .select('personal_access_token.id')
      .where('personal_access_token.user_id', '=', user.id)
      .execute();

    // Read before the cascade, for the same reason project delete does: the
    // tasks these blocked survive in projects this account never owned.
    const remoteDependents = await crossProjectDependentsOf(db, {
      projectIds: owned.map((project) => project.id),
    });

    // project.created_by is ON DELETE RESTRICT, so the owned projects have to go
    // explicitly and first; everything else cascades off these two statements.
    await deleteUnsharedProjects(
      db,
      owned.map((project) => project.id)
    );
    await db.deleteFrom('app_user').where('id', '=', user.id).execute();

    // Absolute rather than deltaed, so a dependent whose project turned out to
    // be shared and survived simply recomputes to the value it already had and
    // the change filter drops it.
    publishCrossProjectBlockerCounts(
      c,
      await refreshCrossProjectBlockerCounts(
        db,
        remoteDependents.map((dependent) => dependent.task_id)
      )
    );

    const survivingProjects =
      affectedProjectIds.length === 0
        ? []
        : await db
            .selectFrom('project')
            .select(PROJECT_COLUMNS)
            .where('id', 'in', affectedProjectIds)
            .execute();
    for (const project of survivingProjects) {
      await publishProjectListItem(c, db, project, await fetchMembers(db, project.id));
    }
    publishTaskRelationsSet(
      c,
      await fetchTaskRelations(
        db,
        assignedTasks.map((task) => task.task_id)
      )
    );

    publishAfterCommit(c, SESSIONS_REVOKED, null, { user_id: user.id });
    // A user-scoped revoke closes session sockets only, so each token needs its
    // own entry or a socket authenticated with it survives its deleted row.
    for (const token of tokenRows) {
      publishAfterCommit(c, SESSIONS_REVOKED, null, {
        user_id: user.id,
        personal_access_token_id: token.id,
      });
    }

    deleteStoredObjectsAfterCommit(c, storageKeys);

    return c.body(null, 204);
  }
);

router.post(
  '/tokens',
  describeRoute({
    tags: ['Auth'],
    summary: 'Create personal access token',
    description:
      'Mint a named personal access token for scripts and agents. The secret is returned ' +
      'once and never again; only its hash is stored. Omit `expires_at` (or send null) for a ' +
      'token that never expires. Tokens carry the same permissions as the user and survive ' +
      'password changes and resets.',
    security: [{ bearerAuth: [] }],
    responses: {
      201: {
        description: 'Token created; the secret is in this response only',
        content: {
          'application/json': {
            schema: resolver(createdPersonalAccessTokenSchema),
          },
        },
      },
      ...unauthorizedErrorResponse,
      ...conflictErrorResponse,
      ...validationOrUnprocessableErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  jsonValidator(createPersonalAccessTokenSchema),
  async (c) => {
    const { id, name, expires_at } = c.req.valid('json');
    const user = c.get('user');
    const db = c.get('db');

    const expiresAt = expires_at == null ? null : new Date(expires_at);
    if (expiresAt !== null) {
      if (expiresAt.getTime() <= Date.now()) {
        throw new AppError(422, 'expires_at must be in the future');
      }
      if (expiresAt.getTime() > Date.now() + MAX_TOKEN_LIFETIME_MS) {
        throw new AppError(422, 'expires_at must be within 100 years');
      }
    }

    const { count } = await db
      .selectFrom('personal_access_token')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('personal_access_token.user_id', '=', user.id)
      .executeTakeFirstOrThrow();
    if (Number(count) >= MAX_PERSONAL_ACCESS_TOKENS_PER_USER) {
      throw new AppError(
        422,
        `You already have ${MAX_PERSONAL_ACCESS_TOKENS_PER_USER} personal access tokens; ` +
          'revoke one before creating another'
      );
    }

    const token = generatePersonalAccessToken();

    try {
      const row = await db
        .insertInto('personal_access_token')
        .values({
          id,
          user_id: user.id,
          name,
          token_hash: hashBearerToken(token),
          expires_at: expiresAt,
        })
        .returning(['id', 'name', 'created_at', 'expires_at', 'last_used_at'])
        .executeTakeFirstOrThrow();
      return c.json({ token, personal_access_token: toTokenResponse(row) }, 201);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppError(409, 'Token id already in use');
      }
      throw err;
    }
  }
);

router.get(
  '/tokens',
  describeRoute({
    tags: ['Auth'],
    summary: 'List personal access tokens',
    description:
      "List the caller's personal access tokens, newest first. Secrets are never returned. " +
      'Expired tokens stay listed until they are revoked. `last_used_at` is null until the ' +
      'token first authenticates, and is accurate to about a minute thereafter.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Personal access tokens',
        content: {
          'application/json': {
            schema: resolver(personalAccessTokensResponseSchema),
          },
        },
      },
      ...unauthorizedErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  async (c) => {
    const rows = await c
      .get('db')
      .selectFrom('personal_access_token')
      .select([
        'personal_access_token.id',
        'personal_access_token.name',
        'personal_access_token.created_at',
        'personal_access_token.expires_at',
        'personal_access_token.last_used_at',
      ])
      .where('personal_access_token.user_id', '=', c.get('user').id)
      .orderBy('personal_access_token.created_at', 'desc')
      .orderBy('personal_access_token.id')
      .execute();

    return c.json({ personal_access_tokens: rows.map(toTokenResponse) }, 200);
  }
);

router.delete(
  '/tokens/:id',
  describeRoute({
    tags: ['Auth'],
    summary: 'Revoke personal access token',
    description:
      'Revoke one of your personal access tokens. Any WebSocket authenticated with that token ' +
      "is closed; other tokens and browser sessions are untouched. Another user's token " +
      'answers 404, the same as one that does not exist.',
    security: [{ bearerAuth: [] }],
    responses: {
      204: {
        description: 'Token revoked',
      },
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...notFoundErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  paramValidator(idSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const user = c.get('user');

    const result = await c
      .get('db')
      .deleteFrom('personal_access_token')
      .where('personal_access_token.id', '=', id)
      .where('personal_access_token.user_id', '=', user.id)
      .executeTakeFirst();

    if (result.numDeletedRows === 0n) {
      throw new AppError(404, 'Token not found');
    }

    publishAfterCommit(c, SESSIONS_REVOKED, null, {
      user_id: user.id,
      personal_access_token_id: id,
    });
    return c.body(null, 204);
  }
);

router.get(
  '/sessions',
  describeRoute({
    tags: ['Auth'],
    summary: 'List sessions',
    description:
      "List the caller's live sessions, newest first, with `is_current` true on the one this " +
      'request was made with. Each carries the `User-Agent` sent when it was created, verbatim ' +
      'and unparsed, or null when the client sent none; no network address is recorded, here ' +
      'or anywhere. Sessions past their expiry are left out — they authenticate nothing, so ' +
      'listing them would misreport where the account is signed in. This lists sessions only: ' +
      'personal access tokens authenticate the same requests and are listed by GET ' +
      '/api/auth/tokens, so neither endpoint alone shows everything that can act as the ' +
      'account. A caller holding a personal access token sees every session and none marked ' +
      'current, since a token is not a session.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Live sessions',
        content: {
          'application/json': {
            schema: resolver(sessionsResponseSchema),
          },
        },
      },
      ...unauthorizedErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  async (c) => {
    const currentHash = callerTokenHash(c);
    const rows = await c
      .get('db')
      .selectFrom('session')
      .select([
        'session.id',
        'session.token_hash',
        'session.user_agent',
        'session.created_at',
        'session.expires_at',
      ])
      .where('session.user_id', '=', c.get('user').id)
      .where('session.expires_at', '>', new Date())
      .orderBy('session.created_at', 'desc')
      .orderBy('session.id')
      .execute();

    return c.json(
      {
        sessions: rows.map((row) => ({
          id: row.id,
          user_agent: row.user_agent,
          created_at: row.created_at.toISOString(),
          expires_at: row.expires_at.toISOString(),
          is_current: currentHash !== null && row.token_hash === currentHash,
        })),
      },
      200
    );
  }
);

router.delete(
  '/sessions/:id',
  describeRoute({
    tags: ['Auth'],
    summary: 'Revoke session',
    description:
      'Revoke one of your own sessions. Its token stops working immediately and any WebSocket ' +
      'authenticated with it is closed; other sessions and every personal access token are ' +
      'untouched. Revoking the session the request was made with is allowed and is a sign-out ' +
      "of this device. Another user's session answers 404, the same as one that does not " +
      'exist.',
    security: [{ bearerAuth: [] }],
    responses: {
      204: {
        description: 'Session revoked',
      },
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...notFoundErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  paramValidator(idSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const user = c.get('user');

    const result = await c
      .get('db')
      .deleteFrom('session')
      .where('session.id', '=', id)
      .where('session.user_id', '=', user.id)
      .executeTakeFirst();

    if (result.numDeletedRows === 0n) {
      throw new AppError(404, 'Session not found');
    }

    publishAfterCommit(c, SESSIONS_REVOKED, null, { user_id: user.id, session_id: id });
    return c.body(null, 204);
  }
);

router.post(
  '/change-password',
  describeRoute({
    tags: ['Auth'],
    summary: 'Change password',
    description:
      'Change the password of the authenticated user. Requires the current password. ' +
      'Existing sessions are left signed in, including this one; revoke them individually ' +
      'from GET /api/auth/sessions.',
    security: [{ bearerAuth: [] }],
    responses: {
      204: {
        description: 'Password changed',
      },
      ...unauthorizedErrorResponse,
      ...validationErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  jsonValidator(changePasswordSchema),
  async (c) => {
    const { current_password, new_password } = c.req.valid('json');
    const user = c.get('user');

    const row = await c
      .get('db')
      .selectFrom('app_user')
      .select('password_hash')
      .where('id', '=', user.id)
      .executeTakeFirstOrThrow();

    const valid = await verifyPassword(row.password_hash, current_password);
    if (!valid) {
      throw new AppError(401, 'Current password is incorrect');
    }

    await setPassword(c, user.id, new_password);

    return c.body(null, 204);
  }
);

publicAuthRouter.post(
  '/forgot-password',
  describeRoute({
    tags: ['Auth'],
    summary: 'Request password reset',
    description:
      'Email a password-reset link if an account with that address exists. Always responds ' +
      '204 so the response never reveals whether the email is registered.',
    responses: {
      204: {
        description: 'Accepted',
      },
      ...validationErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  skipAuth,
  jsonValidator(forgotPasswordSchema),
  async (c) => {
    const { email } = c.req.valid('json');

    if (await enforceResetRateLimit(c, email)) {
      const user = await c
        .get('db')
        .selectFrom('app_user')
        .select(['email', 'alternative_id'])
        .where((eb) => eb(eb.fn<string>('lower', ['email']), '=', email.toLowerCase()))
        .executeTakeFirst();

      if (user) {
        const link = passwordResetLink(createResetToken(user.alternative_id));
        c.get('postCommitHooks').push(() =>
          getEmailSender().send({
            to: user.email,
            subject: `Reset your ${APP_NAME} password`,
            text:
              `We received a request to reset your ${APP_NAME} password.\n\n` +
              `Reset it here (the link expires in 15 minutes): ${link}\n\n` +
              'If you did not request this, you can ignore this email.',
          })
        );
      }
    }

    return c.body(null, 204);
  }
);

publicAuthRouter.post(
  '/reset-password',
  describeRoute({
    tags: ['Auth'],
    summary: 'Reset password',
    description:
      'Set a new password using a token from a password-reset email. On success every ' +
      'outstanding reset token is invalidated. Existing sessions stay signed in; revoke ' +
      'them individually from GET /api/auth/sessions.',
    responses: {
      204: {
        description: 'Password reset',
      },
      ...validationOrUnprocessableErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  skipAuth,
  jsonValidator(resetPasswordSchema),
  async (c) => {
    const { token, new_password } = c.req.valid('json');

    const verification = verifyResetTokenDetailed(token);
    if (verification.status === 'expired') {
      throw new AppError(422, 'Reset token has expired');
    }
    if (verification.status === 'invalid' || !isValidUuid(verification.alternative_id)) {
      throw new AppError(422, 'Invalid reset token');
    }

    const user = await c
      .get('db')
      .selectFrom('app_user')
      .select('id')
      .where('alternative_id', '=', verification.alternative_id)
      .executeTakeFirst();
    // No match: the alternative_id was rotated after the token was issued.
    if (!user) {
      throw new AppError(422, 'Invalid reset token');
    }

    await setPassword(c, user.id, new_password);

    return c.body(null, 204);
  }
);

publicAuthRouter.post(
  '/verify-email',
  describeRoute({
    tags: ['Auth'],
    summary: 'Verify email address',
    description:
      'Mark an email address as verified using a token from a verification email. ' +
      'Unauthenticated: the token authenticates nothing, creates no session and returns ' +
      'nothing about the account. Idempotent — redeeming a token again succeeds without ' +
      'moving the recorded time, and every outstanding token for the address stays usable. ' +
      'A token stops working once the account moves to a different address, and expires ' +
      '24 hours after it was issued.',
    responses: {
      204: {
        description: 'Address verified',
      },
      ...validationOrUnprocessableErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  skipAuth,
  jsonValidator(emailTokenRequestSchema),
  async (c) => {
    const { token } = c.req.valid('json');

    const verification = verifyVerificationToken(token);
    if (verification.status === 'expired') {
      throw new AppError(422, 'Verification link has expired');
    }
    if (verification.status === 'invalid' || !isValidUuid(verification.user_id)) {
      throw new AppError(422, 'Invalid verification link');
    }

    const db = c.get('db');
    const user = await db
      .selectFrom('app_user')
      .select(['id', 'email'])
      .where('id', '=', verification.user_id)
      .executeTakeFirst();
    // Same answer for an unknown account and for an address that has since
    // changed: neither may be distinguishable to an unauthenticated caller.
    if (!user || emailAddressHash(user.email) !== verification.email_hash) {
      throw new AppError(422, 'Invalid verification link');
    }

    // Re-asserted here, not just in the check above: an address change
    // committing between the two statements nulls email_verified_at itself, so
    // it would satisfy the null guard and stamp a mailbox nobody confirmed.
    //
    // RETURNING is what makes the publish below conditional on a real flip: a
    // replayed token, and one whose address moved underneath the read, each
    // match no row, and neither may announce a verification that did not happen.
    const verified = await db
      .updateTable('app_user')
      .set({ email_verified_at: new Date() })
      .where('id', '=', user.id)
      .where('email', '=', user.email)
      .where('email_verified_at', 'is', null)
      .returning(['id', 'name', 'email', 'avatar_storage_key'])
      .executeTakeFirst();

    // The recipient is the account the token names, never the caller, who on
    // this unauthenticated route is nobody.
    if (verified) {
      publishAfterCommit(
        c,
        ACCOUNT_UPDATED,
        null,
        {
          id: verified.id,
          name: verified.name,
          avatar_url: avatarUrl(verified.avatar_storage_key),
          email: verified.email,
          email_verified: true,
        },
        { recipientUserIds: [verified.id] }
      );
    }

    // Outside the guard: redeeming a spent token is a success, not a conflict.
    return c.body(null, 204);
  }
);

router.post(
  '/verify-email/resend',
  describeRoute({
    tags: ['Auth'],
    summary: 'Resend verification email',
    description:
      "Send a fresh verification email to the authenticated user's own address. Takes no " +
      'body. Answers 204 without sending when the address is already verified. Earlier links ' +
      'stay valid. There is deliberately no unauthenticated form of this: verification does ' +
      'not gate signing in, so anyone needing a new link can sign in and ask, and that leaves ' +
      'no endpoint that reveals whether an address has an account.',
    security: [{ bearerAuth: [] }],
    responses: {
      204: {
        description: 'Verification email sent, or already verified',
      },
      ...unauthorizedErrorResponse,
      ...tooManyRequestsErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  async (c) => {
    const user = c.get('user');
    if (user.email_verified) {
      return c.body(null, 204);
    }

    await enforceVerificationRateLimit(c, user.id);
    enqueueVerificationEmail(c, user);

    return c.body(null, 204);
  }
);

router.get(
  '/me/export',
  describeRoute({
    tags: ['Auth'],
    summary: 'Export account data',
    description:
      'Download everything held about the calling account that is not board content, as one ' +
      'JSON file, with Content-Disposition attachment and a fixed filename that carries no ' +
      'user text. It is free, never gated, and a personal access token may fetch it: every ' +
      'collection in it is already readable one endpoint at a time, so this adds no reach, ' +
      'only convenience. format identifies the shape and version is bumped only on a breaking ' +
      'change to it. account carries the profile plus the notification preferences; sessions ' +
      'lists every session row including ones already past expires_at, which the session ' +
      'listing hides because they authenticate nothing; personal_access_tokens and feedback ' +
      'are the metadata and the prose the account submitted; projects names each board the ' +
      'account created or is a member of, with role owner for one it created and joined_at ' +
      'taken from the membership, or from the board itself for one it created. Board content ' +
      'is deliberately absent — cards, labels, assignments and images belong to a project and ' +
      'come out of GET /api/projects/{id}/export, which every member of a board can call. ' +
      'Comments and activity come out of no route at all yet; when they do it will be that ' +
      'one, where a comment arrives attached to its card. ' +
      'Nothing here names another person, and no credential material is included: no password ' +
      'hash, no session or token hash, and no invitation record, since an invitation carries a ' +
      "token hash and an invitee's address. avatar_url is a server-relative path that stops " +
      'resolving once the account is gone; fetch the bytes before deleting the account.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Account export manifest',
        content: {
          'application/json': {
            schema: resolver(accountExportSchema),
          },
        },
      },
      ...unauthorizedErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  async (c) => {
    // One reading, so the manifest timestamp and the filename date agree.
    const now = new Date();

    // One snapshot: under read committed a revoke landing between two of these
    // reads produces a file that contradicts itself and cannot be corrected.
    const payload = await c
      .get('db')
      .transaction()
      .setIsolationLevel('repeatable read')
      .execute((trx) => buildAccountExport(trx, c.get('user').id, now));

    c.header('Content-Disposition', `attachment; filename="${accountExportFilename(now)}"`);
    return c.json(payload, 200);
  }
);

router.get(
  '/me/notification-settings',
  describeRoute({
    tags: ['Auth'],
    summary: 'Read notification settings',
    description:
      'Return which notification emails the authenticated user has switched on. All default ' +
      'to true. They are read here rather than on the user record because that record is ' +
      'published to everyone sharing a project and a preference is private.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Current notification settings',
        content: {
          'application/json': {
            schema: resolver(notificationSettingsSchema),
          },
        },
      },
      ...unauthorizedErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  async (c) => {
    const row = await c
      .get('db')
      .selectFrom('app_user')
      .select(['notify_task_assigned', 'notify_added_to_project', 'notify_bulk_task_assigned'])
      .where('id', '=', c.get('user').id)
      .executeTakeFirstOrThrow();

    return c.json(
      {
        task_assigned: row.notify_task_assigned,
        added_to_project: row.notify_added_to_project,
        bulk_task_assigned: row.notify_bulk_task_assigned,
      },
      200
    );
  }
);

router.put(
  '/me/notification-settings',
  describeRoute({
    tags: ['Auth'],
    summary: 'Set notification settings',
    description:
      'Replace the full set of notification preferences for the authenticated user. A ' +
      'preference stays meaningful while the address is unverified — no mail is sent then ' +
      'either way — so the toggles are never forced off.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Updated notification settings',
        content: {
          'application/json': {
            schema: resolver(notificationSettingsSchema),
          },
        },
      },
      ...unauthorizedErrorResponse,
      ...validationErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  jsonValidator(notificationSettingsSchema),
  async (c) => {
    const settings = c.req.valid('json');

    await c
      .get('db')
      .updateTable('app_user')
      .set({
        notify_task_assigned: settings.task_assigned,
        notify_added_to_project: settings.added_to_project,
        notify_bulk_task_assigned: settings.bulk_task_assigned,
      })
      .where('id', '=', c.get('user').id)
      .execute();

    return c.json(settings, 200);
  }
);

publicAuthRouter.post(
  '/unsubscribe',
  describeRoute({
    tags: ['Auth'],
    summary: 'Unsubscribe from one kind of notification',
    description:
      'Switch off the one notification kind the token names, and report which it was so the ' +
      'landing page can say what it did. Unauthenticated and idempotent: the token proves ' +
      'nothing beyond itself, is refused by every authenticating path, and never expires, ' +
      'because an unsubscribe link has to work in a year-old email. There is deliberately no ' +
      'request shape that switches a preference back on — that is what makes a leaked or ' +
      'replayed link harmless, and it must not be weakened by adding one. The response is the ' +
      'same whether or not the account still exists, so nothing here reveals that.',
    responses: {
      200: {
        description: 'The notification kind that was switched off',
        content: {
          'application/json': {
            schema: resolver(unsubscribeResponseSchema),
          },
        },
      },
      ...validationOrUnprocessableErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  skipAuth,
  jsonValidator(emailTokenRequestSchema),
  async (c) => {
    const { token } = c.req.valid('json');
    const kind = await applyUnsubscribe(c, token);
    return c.json({ kind }, 200);
  }
);

publicAuthRouter.post(
  '/unsubscribe/all',
  describeRoute({
    tags: ['Auth'],
    summary: 'Unsubscribe from every notification',
    description:
      'Switch off every notification email for the account the token names, whatever kind the ' +
      'token itself carries. Same properties as the single-kind form: unauthenticated, ' +
      'idempotent, and incapable of switching anything on.',
    responses: {
      204: {
        description: 'All notification email switched off',
      },
      ...validationOrUnprocessableErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  skipAuth,
  jsonValidator(emailTokenRequestSchema),
  async (c) => {
    const { token } = c.req.valid('json');
    const { account } = await unsubscribeTarget(c, token);
    if (account !== null) {
      await switchOffNotifications(c, account, NOTIFICATION_KINDS);
    }

    return c.body(null, 204);
  }
);

publicAuthRouter.post(
  '/unsubscribe/one-click',
  describeRoute({
    tags: ['Auth'],
    summary: 'One-click unsubscribe (RFC 8058)',
    description:
      'The target of the List-Unsubscribe header on notification email. A mail client posts ' +
      'List-Unsubscribe=One-Click as form data, which is not JSON, so the token comes from the ' +
      'query string and the body is never read. It switches off the kind the token names.',
    parameters: [
      {
        name: 'token',
        in: 'query',
        required: true,
        schema: { type: 'string' },
        description: 'The unsubscribe token from the mailed link',
      },
    ],
    responses: {
      204: {
        description: 'Notification kind switched off',
      },
      ...unprocessableErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  skipAuth,
  async (c) => {
    await applyUnsubscribe(c, c.req.query('token') ?? '');
    return c.body(null, 204);
  }
);

export default router;
