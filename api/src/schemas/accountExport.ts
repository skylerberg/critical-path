import { type } from 'arktype';
import { notificationSettingsSchema } from './notifications';
import { personalAccessTokenSchema } from './personalAccessTokens';
import { sessionSchema } from './sessions';

// Nested pieces stay module-private: the OpenAPI schema-name registry reads the
// barrel and throws when two exports produce identical JSON Schema.
const accountExportProfileSchema = type({
  id: 'string',
  name: 'string',
  email: 'string',
  avatar_url: 'string | null',
  created_at: 'string',
  email_verified_at: 'string | null',
  notification_settings: notificationSettingsSchema,
});

const accountExportSessionSchema = sessionSchema.omit('is_current');

const accountExportFeedbackSchema = type({
  id: 'string',
  message: 'string',
  page_path: 'string | null',
  created_at: 'string',
});

const accountExportProjectSchema = type({
  id: 'string',
  name: 'string',
  role: "'owner' | 'editor' | 'viewer'",
  joined_at: 'string',
});

export const accountExportSchema = type({
  format: "'critical-path-account-export'",
  version: 'number',
  exported_at: 'string',
  account: accountExportProfileSchema,
  sessions: accountExportSessionSchema.array(),
  personal_access_tokens: personalAccessTokenSchema.array(),
  feedback: accountExportFeedbackSchema.array(),
  projects: accountExportProjectSchema.array(),
});

export type AccountExport = typeof accountExportSchema.infer;
