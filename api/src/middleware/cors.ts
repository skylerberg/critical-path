import { cors } from 'hono/cors';
import { env } from '../config/env';

export const corsMiddleware = cors({
  origin: (origin) => {
    if (!origin) {
      return undefined;
    }
    if (env.corsOrigins.includes(origin)) {
      return origin;
    }
    return '';
  },
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,
});
