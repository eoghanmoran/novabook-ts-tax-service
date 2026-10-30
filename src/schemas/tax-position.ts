// Zod schema for the GET /tax-position query string, which must contain the date to report on.
// The type is derived from the schema, so the two can never drift apart.

import { z } from 'zod';
import { isoDateSchema } from './common.js';

// The query parameters accepted by GET /tax-position. The date is mandatory.
export const taxPositionQuerySchema = z.strictObject({
  date: isoDateSchema,
});

export type TaxPositionQuery = z.infer<typeof taxPositionQuerySchema>;
