import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';
import { jsonValidator } from '../middleware/jsonValidator';
import { AppError } from '../utils/errors';
import { claimInvitations } from '../services/invitations';
import { hashBearerToken } from '../services/sessions';
import {
  acceptInvitationSchema,
  acceptedInvitationSchema,
  jsonResponse,
  type Returned,
  unauthorizedErrorResponse,
  validationOrUnprocessableErrorResponse,
  internalServerErrorResponse,
} from '../schemas/index';
import { AppHono } from '../types/index';

const router: AppHono = new Hono();

const acceptInvitationResponses = {
  200: jsonResponse('The board that was joined, and the role held on it', acceptedInvitationSchema),
};

router.post(
  '/accept',
  describeRoute({
    tags: ['Projects'],
    summary: 'Accept a project invitation',
    description:
      'Redeem an invitation link and join the board it names. The caller must be signed in ' +
      'but need not be signed in as the invited address — an invitation is a grant to ' +
      'whoever holds the link, so someone who signs up under a different address can still ' +
      'accept. Joining consumes the invitation: a second attempt with the same token answers ' +
      '422, as does one that was revoked, expired, or whose board has been deleted. A caller ' +
      'who already has access joins nothing, so the link survives for whoever it was ' +
      'addressed to and the response reports the access they already had — an existing ' +
      'member is never demoted, and the board’s owner is always an editor. There is no ' +
      'project id in the path because the holder of a link does not know it.',
    security: [{ bearerAuth: [] }],
    responses: {
      ...acceptInvitationResponses,
      ...unauthorizedErrorResponse,
      ...validationOrUnprocessableErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  jsonValidator(acceptInvitationSchema),
  async (c): Promise<Returned<typeof acceptInvitationResponses>> => {
    const { token } = c.req.valid('json');
    const db = c.get('db');
    const user = c.get('user');

    const invitation = await db
      .selectFrom('project_invitation')
      .select(['id', 'project_id', 'role', 'expires_at'])
      .where('token_hash', '=', hashBearerToken(token))
      .executeTakeFirst();
    // Revoked, already redeemed and never-existed are one answer: the holder of
    // a failing link learns nothing about which.
    if (!invitation) {
      throw new AppError(422, 'This invitation is no longer valid');
    }
    if (invitation.expires_at.getTime() <= Date.now()) {
      throw new AppError(422, 'This invitation has expired');
    }

    const claimed = await claimInvitations(c, db, user.id, [invitation]);
    if (claimed.length === 0) {
      throw new AppError(422, 'This invitation is no longer valid');
    }

    return c.json(claimed[0], 200);
  }
);

export default router;
