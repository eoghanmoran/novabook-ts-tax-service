// Coordinates tax position queries.
// Loads the events up to the requested date from the store and asks the domain to calculate the position.

import { calculateTaxPosition } from '../domain/tax-position.js';
import type { EventStore } from '../storage/event-store.interface.js';

// The answer to a tax position query: the date asked about and the tax position in whole pennies.
export interface TaxPositionResult {
  date: string;
  taxPosition: number;
}

// Returns the tax position at the given date, using every event dated on or before it.
export async function queryTaxPosition(
  store: EventStore,
  date: string,
): Promise<TaxPositionResult> {
  const events = await store.findUpTo(date);
  const taxPosition = calculateTaxPosition([...events], date);

  return { date, taxPosition };
}
