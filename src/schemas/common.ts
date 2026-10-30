// Small building-block schemas that are shared by the other schema files,
// so the rules for dates, costs and tax rates are written in exactly one place.

import { z } from 'zod';

// An ISO 8601 date-time string such as "2024-02-22T17:29:39Z" or "2024-02-22T17:29:39+01:00".
export const isoDateSchema = z.iso.datetime({ offset: true });

// A money amount in whole pennies: an integer that is zero or more (no decimals, no negatives).
export const penniesSchema = z.number().int().nonnegative();

// A tax rate as a fraction between 0 and 1 (for example 0.2 means 20%).
export const taxRateSchema = z.number().min(0).max(1);

// An identifier supplied by the caller, such as an invoiceId or itemId. It cannot be empty.
export const idSchema = z.string().min(1);
