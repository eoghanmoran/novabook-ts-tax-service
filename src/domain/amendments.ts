// Pure functions that work out which cost and tax rate apply to an item at a given date,
// taking amendments into account (including amendments that arrived before their sale).
// Must not import storage, routes or services.

import type { DomainEvent } from '../schemas/event.js';
import type { SaleItem } from '../schemas/transaction.js';

// The cost and tax rate that apply to an item at a point in time.
export type EffectiveItemValues = Pick<SaleItem, 'cost' | 'taxRate'>;

// Turns an ISO 8601 date string into epoch milliseconds so dates can be compared as numbers.
function toEpochMilliseconds(isoDate: string): number {
  return Date.parse(isoDate);
}

// Finds the amendment that applies to the item at the query date, or undefined if there is none.
// The latest amendment by date wins. If two share a date, the one later in the list wins.
function findApplicableAmendment(
  events: DomainEvent[],
  invoiceId: string,
  itemId: string,
  queryDate: string,
): EffectiveItemValues | undefined {
  const queryTime = toEpochMilliseconds(queryDate);
  let bestAmendment: EffectiveItemValues | undefined = undefined;
  let bestTime = -Infinity;

  for (const event of events) {
    if (event.eventType !== 'SALE_AMENDMENT') {
      continue;
    }
    if (event.invoiceId !== invoiceId || event.itemId !== itemId) {
      continue;
    }

    const amendmentTime = toEpochMilliseconds(event.date);
    if (amendmentTime > queryTime) {
      continue;
    }

    // Using >= means a later amendment in the list replaces an earlier one with the same date.
    if (amendmentTime >= bestTime) {
      bestAmendment = { cost: event.cost, taxRate: event.taxRate };
      bestTime = amendmentTime;
    }
  }

  return bestAmendment;
}

// Finds the item's original cost and tax rate from its SALES event, or undefined if the sale has not arrived.
function findOriginalValues(
  events: DomainEvent[],
  invoiceId: string,
  itemId: string,
): EffectiveItemValues | undefined {
  for (const event of events) {
    if (event.eventType !== 'SALES' || event.invoiceId !== invoiceId) {
      continue;
    }

    const item = event.items.find((saleItem) => saleItem.itemId === itemId);
    if (item !== undefined) {
      return { cost: item.cost, taxRate: item.taxRate };
    }
  }

  return undefined;
}

// Returns the cost and tax rate to use for an item at the query date.
// Uses the latest applicable amendment, otherwise the original sale values, otherwise undefined.
export function getEffectiveItemValues(
  events: DomainEvent[],
  invoiceId: string,
  itemId: string,
  queryDate: string,
): EffectiveItemValues | undefined {
  const amendment = findApplicableAmendment(events, invoiceId, itemId, queryDate);
  if (amendment !== undefined) {
    return amendment;
  }

  return findOriginalValues(events, invoiceId, itemId);
}
