import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';
import { jsonValidator } from '../middleware/jsonValidator';
import { paramValidator, queryValidator } from '../middleware/requestValidator';
import { AppError, isUniqueViolation } from '../utils/errors';
import { assertCanWriteProject, assertProjectAccess } from '../services/authorization';
import {
  assertSeriesWrite,
  createSeries,
  fetchSeries,
  patchSeries,
  publishSeriesCreated,
  publishSeriesDeleted,
  publishSeriesUpdated,
} from '../services/taskSeries/index';
import {
  MAX_SERIES_PER_PROJECT,
  createTaskSeriesSchema,
  patchTaskSeriesSchema,
  projectIdQuerySchema,
  taskSeriesCreateResponseSchema,
  taskSeriesListResponseSchema,
  taskSeriesSchema,
  idSchema,
  jsonResponse,
  emptyResponse,
  type Returned,
  badRequestErrorResponse,
  unauthorizedErrorResponse,
  forbiddenErrorResponse,
  notFoundErrorResponse,
  conflictErrorResponse,
  validationOrUnprocessableErrorResponse,
  internalServerErrorResponse,
} from '../schemas/index';
import { AppHono } from '../types/index';

const router: AppHono = new Hono();

const RECURRENCE_MODEL =
  'A series holds the template for a repeating card — title, description, labels, assignees, ' +
  'checklist items, an optional due date and destination column — plus an RFC 5545 RRULE and ' +
  'the calendar day its next occurrence falls on. Nothing is created ahead of time and nothing ' +
  'appears early: a background sweep materializes an ordinary card on the day the occurrence ' +
  'falls, and then advances the schedule. The occurrence decides only when the card comes into ' +
  'existence — a card carries the template’s own `due_date`, never the occurrence date. ' +
  'Cards already created are ordinary cards and never change when the series does.';

const listTaskSeriesResponses = {
  200: jsonResponse('Recurring series for the project', taskSeriesListResponseSchema),
};

router.get(
  '/',
  describeRoute({
    tags: ['Recurring'],
    summary: 'List recurring series',
    description:
      `${RECURRENCE_MODEL} Between occurrences there is no card, so this list is the only ` +
      'place a recurring commitment is visible. Viewers may read it; only editors may change ' +
      'it. Ordered by the next occurrence, soonest first, with paused and finished series last.',
    security: [{ bearerAuth: [] }],
    responses: {
      ...listTaskSeriesResponses,
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...notFoundErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  queryValidator(projectIdQuerySchema),
  async (c): Promise<Returned<typeof listTaskSeriesResponses>> => {
    const { project_id } = c.req.valid('query');
    const db = c.get('db');
    const user = c.get('user');

    await assertProjectAccess(db, user.id, project_id);
    const series = await fetchSeries(db, { projectId: project_id });
    return c.json({ series }, 200);
  }
);

const createTaskSeriesResponses = {
  201: jsonResponse('Created series', taskSeriesCreateResponseSchema),
};

router.post(
  '/',
  describeRoute({
    tags: ['Recurring'],
    summary: 'Create a recurring series',
    description:
      `${RECURRENCE_MODEL} Send either \`preset\` (one of the curated recurrences) or a raw ` +
      '`rrule`, never both. A raw rule must be a single RRULE value carrying no DTSTART, TZID, ' +
      'RDATE, EXDATE or EXRULE — the anchor is `start_date` and the zone is `timezone` — and ' +
      'must repeat daily or less often. The first occurrence is scheduled on or after today in ' +
      `the series timezone, so a past \`start_date\` backfills nothing. A project holds at most ` +
      `${String(MAX_SERIES_PER_PROJECT)} series. Image nodes cannot belong to a template and are ` +
      'stripped from the description; `dropped_image_count` reports how many. The client ' +
      'supplies the id; a duplicate returns 409.',
    security: [{ bearerAuth: [] }],
    responses: {
      ...createTaskSeriesResponses,
      ...unauthorizedErrorResponse,
      ...forbiddenErrorResponse,
      ...notFoundErrorResponse,
      ...conflictErrorResponse,
      ...validationOrUnprocessableErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  jsonValidator(createTaskSeriesSchema),
  async (c): Promise<Returned<typeof createTaskSeriesResponses>> => {
    const body = c.req.valid('json');
    const db = c.get('db');
    const user = c.get('user');

    // Locked for the rest of the transaction: the per-project cap has no
    // constraint behind it, so two concurrent creates would both read a
    // pre-cap count and both insert.
    const project = await db
      .selectFrom('project')
      .select(['id', 'created_by'])
      .where('id', '=', body.project_id)
      .forUpdate()
      .executeTakeFirst();
    if (!project) {
      throw new AppError(404, 'Project not found');
    }
    await assertCanWriteProject(db, user.id, project);

    const { count } = await db
      .selectFrom('task_series')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('task_series.project_id', '=', body.project_id)
      .executeTakeFirstOrThrow();
    if (Number(count) >= MAX_SERIES_PER_PROJECT) {
      throw new AppError(
        422,
        `Project already has the maximum of ${String(MAX_SERIES_PER_PROJECT)} recurring series`
      );
    }

    let droppedImageCount: number;
    try {
      droppedImageCount = await createSeries(db, user.id, project, body);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppError(409, 'Series id already in use');
      }
      throw err;
    }

    const [created] = await fetchSeries(db, { ids: [body.id] });
    if (!created) {
      throw new AppError(500, 'Failed to load created series');
    }
    publishSeriesCreated(c, created);
    return c.json({ ...created, dropped_image_count: droppedImageCount }, 201);
  }
);

const patchTaskSeriesResponses = { 200: jsonResponse('Updated series', taskSeriesSchema) };

router.patch(
  '/:id',
  describeRoute({
    tags: ['Recurring'],
    summary: 'Update a recurring series',
    description:
      'Change the template, the recurrence, or pause and resume the schedule. Every change ' +
      'applies to future occurrences only: cards this series has already created are ordinary ' +
      'cards and are never read or written here. A `label_ids`, `assignee_ids` or ' +
      '`checklist_items` array replaces that collection wholesale; omitting one leaves it ' +
      'alone. Changing the recurrence, start date or timezone — or resuming — ' +
      'reschedules forward from today, never backwards. `clear_missed` zeroes the missed ' +
      'counter. `status` accepts only active or paused; a series ends by exhausting its rule, ' +
      'or by being deleted.',
    security: [{ bearerAuth: [] }],
    responses: {
      ...patchTaskSeriesResponses,
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...forbiddenErrorResponse,
      ...notFoundErrorResponse,
      ...validationOrUnprocessableErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  paramValidator(idSchema),
  jsonValidator(patchTaskSeriesSchema),
  async (c): Promise<Returned<typeof patchTaskSeriesResponses>> => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const db = c.get('db');
    const user = c.get('user');

    const { series, project } = await assertSeriesWrite(db, user.id, id);
    await patchSeries(db, series, project, body);

    const [updated] = await fetchSeries(db, { ids: [id] });
    if (!updated) {
      throw new AppError(500, 'Failed to load updated series');
    }
    publishSeriesUpdated(c, updated);
    return c.json(updated, 200);
  }
);

const deleteTaskSeriesResponses = { 204: emptyResponse('Series ended') };

router.delete(
  '/:id',
  describeRoute({
    tags: ['Recurring'],
    summary: 'End a recurring series',
    description:
      'Stop a schedule and forget its template. Cards it already created stay exactly as they ' +
      'are, with their comments and history; they simply stop naming the series they came from.',
    security: [{ bearerAuth: [] }],
    responses: {
      ...deleteTaskSeriesResponses,
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...forbiddenErrorResponse,
      ...notFoundErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  paramValidator(idSchema),
  async (c): Promise<Returned<typeof deleteTaskSeriesResponses>> => {
    const { id } = c.req.valid('param');
    const db = c.get('db');
    const user = c.get('user');

    const { series } = await assertSeriesWrite(db, user.id, id);
    await db.deleteFrom('task_series').where('id', '=', id).execute();
    publishSeriesDeleted(c, series.project_id, id);
    return c.body(null, 204);
  }
);

export default router;
