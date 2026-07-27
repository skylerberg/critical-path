import crypto from 'crypto';
import { Hono } from 'hono';
import { describeRoute, resolver } from 'hono-openapi';
import type { Updateable } from 'kysely';
import type { AppUser } from '../db/types';
import { authMiddleware } from '../middleware/auth';
import { jsonValidator } from '../middleware/jsonValidator';
import { paramValidator } from '../middleware/requestValidator';
import { enforceAuthRateLimit, enforceResetRateLimit } from '../middleware/rateLimit';
import { AppError, isUniqueViolation } from '../utils/errors';
import { env } from '../config/env';
import { APP_NAME } from '../config/constants';
import { isValidUuid } from '../types/uuid';
import { avatarUrl } from '../services/avatars';
import { getEmailSender } from '../services/email/index';
import { hashPassword, verifyPassword, verifyDummyPassword } from '../services/passwords';
import { createResetToken, verifyResetTokenDetailed } from '../services/resetToken';
import { SESSIONS_REVOKED, USER_UPDATED, publishAfterCommit } from '../services/realtime/index';
import {
  MAX_PERSONAL_ACCESS_TOKENS_PER_USER,
  generatePersonalAccessToken,
} from '../services/personalAccessTokens';
import { createSession, deleteSessionByTokenHash, hashBearerToken } from '../services/sessions';
import {
  signupRequestSchema,
  loginRequestSchema,
  authResponseSchema,
  patchMeSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  userSchema,
  idSchema,
  createPersonalAccessTokenSchema,
  createdPersonalAccessTokenSchema,
  personalAccessTokensResponseSchema,
  badRequestErrorResponse,
  unauthorizedErrorResponse,
  notFoundErrorResponse,
  conflictErrorResponse,
  validationErrorResponse,
  validationOrUnprocessableErrorResponse,
  tooManyRequestsErrorResponse,
  internalServerErrorResponse,
  type PersonalAccessTokenResponse,
} from '../schemas/index';
import { AppContext, AppHono } from '../types/index';

const router: AppHono = new Hono();

// Keeps an absurd year from landing outside timestamptz range, which would be a 500.
const MAX_TOKEN_LIFETIME_MS = 100 * 365 * 24 * 60 * 60 * 1000;

function toTokenResponse(row: {
  id: string;
  name: string;
  created_at: Date;
  expires_at: Date | null;
}): PersonalAccessTokenResponse {
  return {
    id: row.id,
    name: row.name,
    created_at: row.created_at.toISOString(),
    expires_at: row.expires_at === null ? null : row.expires_at.toISOString(),
  };
}

async function setPasswordAndRevokeSessions(
  c: Pick<AppContext, 'get'>,
  userId: string,
  newPassword: string
): Promise<void> {
  const db = c.get('db');
  await db
    .updateTable('app_user')
    .set({ password_hash: await hashPassword(newPassword), alternative_id: crypto.randomUUID() })
    .where('id', '=', userId)
    .execute();
  await db.deleteFrom('session').where('user_id', '=', userId).execute();
  publishAfterCommit(c, SESSIONS_REVOKED, null, { user_id: userId });
}

router.post(
  '/signup',
  describeRoute({
    tags: ['Auth'],
    summary: 'Sign up',
    description: 'Create a new user account and start a session. The client supplies the user id.',
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
  jsonValidator(signupRequestSchema),
  async (c) => {
    const { id, email, password, name } = c.req.valid('json');
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

    const token = await createSession(db, id);

    return c.json({ token, user: { id, email, name, avatar_url: null } }, 201);
  }
);

router.post(
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
  jsonValidator(loginRequestSchema),
  async (c) => {
    const { email, password } = c.req.valid('json');
    await enforceAuthRateLimit(c, email);

    const db = c.get('db');

    const user = await db
      .selectFrom('app_user')
      .select(['id', 'email', 'name', 'avatar_storage_key', 'password_hash'])
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

    const token = await createSession(db, user.id);

    return c.json(
      {
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          avatar_url: avatarUrl(user.avatar_storage_key),
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
  authMiddleware,
  async (c) => {
    const token = (c.req.header('Authorization') ?? '').substring(7);
    await deleteSessionByTokenHash(c.get('db'), hashBearerToken(token));
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
            schema: resolver(userSchema),
          },
        },
      },
      ...unauthorizedErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  authMiddleware,
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
      'Update the name and/or email of the authenticated user. Changing the email address ' +
      'invalidates any outstanding password-reset tokens.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Updated user',
        content: {
          'application/json': {
            schema: resolver(userSchema),
          },
        },
      },
      ...unauthorizedErrorResponse,
      ...conflictErrorResponse,
      ...validationErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  authMiddleware,
  jsonValidator(patchMeSchema),
  async (c) => {
    const { name, email } = c.req.valid('json');
    const user = c.get('user');
    const db = c.get('db');

    const updates: Updateable<AppUser> = {};
    if (name !== undefined && name !== user.name) updates.name = name;
    if (email !== undefined && email !== user.email) {
      updates.email = email;
      if (email.toLowerCase() !== user.email.toLowerCase()) {
        // New mailbox: rotate so reset tokens sent to the old address die now
        // instead of staying valid for their remaining TTL.
        updates.alternative_id = crypto.randomUUID();
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

    try {
      const row = await db
        .updateTable('app_user')
        .set(updates)
        .where('id', '=', user.id)
        .returning(['id', 'email', 'name'])
        .executeTakeFirstOrThrow();
      const updated = { ...row, avatar_url: user.avatar_url };
      publishAfterCommit(c, USER_UPDATED, null, updated);
      return c.json(updated, 200);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppError(409, 'Email already in use');
      }
      throw err;
    }
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
  authMiddleware,
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
        .returning(['id', 'name', 'created_at', 'expires_at'])
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
      'Expired tokens stay listed until they are revoked.',
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
  authMiddleware,
  async (c) => {
    const rows = await c
      .get('db')
      .selectFrom('personal_access_token')
      .select([
        'personal_access_token.id',
        'personal_access_token.name',
        'personal_access_token.created_at',
        'personal_access_token.expires_at',
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
  authMiddleware,
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

router.post(
  '/change-password',
  describeRoute({
    tags: ['Auth'],
    summary: 'Change password',
    description:
      'Change the password of the authenticated user. Requires the current password; on ' +
      'success every existing session is revoked and a fresh session token is returned, ' +
      'keeping this client logged in.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Password changed, all prior sessions revoked, new session issued',
        content: {
          'application/json': {
            schema: resolver(authResponseSchema),
          },
        },
      },
      ...unauthorizedErrorResponse,
      ...validationErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  authMiddleware,
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

    await setPasswordAndRevokeSessions(c, user.id, new_password);
    const token = await createSession(c.get('db'), user.id);

    return c.json({ token, user }, 200);
  }
);

router.post(
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
        const link = `${env.resetUrlBase}?token=${encodeURIComponent(
          createResetToken(user.alternative_id)
        )}`;
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

router.post(
  '/reset-password',
  describeRoute({
    tags: ['Auth'],
    summary: 'Reset password',
    description:
      'Set a new password using a token from a password-reset email. On success every ' +
      'session is revoked and outstanding reset tokens are invalidated.',
    responses: {
      204: {
        description: 'Password reset and all sessions revoked',
      },
      ...validationOrUnprocessableErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
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

    await setPasswordAndRevokeSessions(c, user.id, new_password);

    return c.body(null, 204);
  }
);

export default router;
