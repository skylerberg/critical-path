import { Hono } from 'hono';
import { describeRoute, resolver } from 'hono-openapi';
import { authMiddleware } from '../middleware/auth';
import { jsonValidator } from '../middleware/jsonValidator';
import { enforceAuthRateLimit } from '../middleware/rateLimit';
import { AppError, isUniqueViolation } from '../utils/errors';
import { env } from '../config/env';
import { hashPassword, verifyPassword, verifyDummyPassword } from '../services/passwords';
import { createSession, deleteSessionByTokenHash, hashSessionToken } from '../services/sessions';
import {
  signupRequestSchema,
  loginRequestSchema,
  authResponseSchema,
  userSchema,
  unauthorizedErrorResponse,
  forbiddenErrorResponse,
  conflictErrorResponse,
  validationErrorResponse,
  tooManyRequestsErrorResponse,
  internalServerErrorResponse,
} from '../schemas/index';
import { AppHono } from '../types/index';

const router: AppHono = new Hono();

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
      ...forbiddenErrorResponse,
      ...conflictErrorResponse,
      ...tooManyRequestsErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  jsonValidator(signupRequestSchema),
  async (c) => {
    const { id, email, password, name } = c.req.valid('json');
    enforceAuthRateLimit(c, email);

    if (!env.signupEnabled) {
      throw new AppError(403, 'Signup is disabled');
    }

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

    return c.json({ token, user: { id, email, name } }, 201);
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
    enforceAuthRateLimit(c, email);

    const db = c.get('db');

    const user = await db
      .selectFrom('app_user')
      .select(['id', 'email', 'name', 'password_hash'])
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

    return c.json({ token, user: { id: user.id, email: user.email, name: user.name } }, 200);
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
    await deleteSessionByTokenHash(c.get('db'), hashSessionToken(token));
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

export default router;
