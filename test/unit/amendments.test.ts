// Unit tests for getEffectiveItemValues: which cost and tax rate apply to an item at a given date.

import { describe, expect, it } from 'vitest';
import { getEffectiveItemValues } from '../../src/domain/amendments.js';
import { buildAmendment, buildItem, buildSale } from './event-builders.js';

const queryDate = '2024-02-01T00:00:00Z';

describe('getEffectiveItemValues', () => {
  it('returns the original sale values when no amendments exist', () => {
    const sale = buildSale('inv-1', '2024-01-01T00:00:00Z', [buildItem('item-a', 1000, 0.2)]);

    const result = getEffectiveItemValues([sale], 'inv-1', 'item-a', queryDate);

    expect(result).toEqual({ cost: 1000, taxRate: 0.2 });
  });

  it('returns the amendment values when an amendment exists', () => {
    const sale = buildSale('inv-1', '2024-01-01T00:00:00Z', [buildItem('item-a', 1000, 0.2)]);
    const amendment = buildAmendment('inv-1', 'item-a', '2024-01-10T00:00:00Z', 500, 0.1);

    const result = getEffectiveItemValues([sale, amendment], 'inv-1', 'item-a', queryDate);

    expect(result).toEqual({ cost: 500, taxRate: 0.1 });
  });

  it('uses the latest amendment by date when there are several', () => {
    const sale = buildSale('inv-1', '2024-01-01T00:00:00Z', [buildItem('item-a', 1000, 0.2)]);
    const earlier = buildAmendment('inv-1', 'item-a', '2024-01-10T00:00:00Z', 500, 0.1);
    const later = buildAmendment('inv-1', 'item-a', '2024-01-20T00:00:00Z', 300, 0.3);

    // The later amendment is listed first, to show that list order does not matter for different dates.
    const result = getEffectiveItemValues([sale, later, earlier], 'inv-1', 'item-a', queryDate);

    expect(result).toEqual({ cost: 300, taxRate: 0.3 });
  });

  it('ignores an amendment dated after the query date', () => {
    const sale = buildSale('inv-1', '2024-01-01T00:00:00Z', [buildItem('item-a', 1000, 0.2)]);
    const futureAmendment = buildAmendment('inv-1', 'item-a', '2024-03-01T00:00:00Z', 999, 0.9);

    const result = getEffectiveItemValues([sale, futureAmendment], 'inv-1', 'item-a', queryDate);

    expect(result).toEqual({ cost: 1000, taxRate: 0.2 });
  });

  it('still applies an amendment that arrives before its sale', () => {
    const amendment = buildAmendment('inv-1', 'item-a', '2024-01-10T00:00:00Z', 500, 0.1);

    const result = getEffectiveItemValues([amendment], 'inv-1', 'item-a', queryDate);

    expect(result).toEqual({ cost: 500, taxRate: 0.1 });
  });

  it('returns undefined when neither a sale nor an amendment exists', () => {
    const result = getEffectiveItemValues([], 'inv-1', 'item-a', queryDate);

    expect(result).toBeUndefined();
  });

  it('ignores amendments that belong to a different invoice', () => {
    const sale = buildSale('inv-1', '2024-01-01T00:00:00Z', [buildItem('item-a', 1000, 0.2)]);
    const otherInvoiceAmendment = buildAmendment('inv-2', 'item-a', '2024-01-10T00:00:00Z', 1, 0.5);

    const result = getEffectiveItemValues(
      [sale, otherInvoiceAmendment],
      'inv-1',
      'item-a',
      queryDate,
    );

    expect(result).toEqual({ cost: 1000, taxRate: 0.2 });
  });

  it('ignores amendments that belong to a different item in the same invoice', () => {
    const sale = buildSale('inv-1', '2024-01-01T00:00:00Z', [
      buildItem('item-a', 1000, 0.2),
      buildItem('item-b', 2000, 0.2),
    ]);
    const otherItemAmendment = buildAmendment('inv-1', 'item-b', '2024-01-10T00:00:00Z', 1, 0.5);

    const result = getEffectiveItemValues([sale, otherItemAmendment], 'inv-1', 'item-a', queryDate);

    expect(result).toEqual({ cost: 1000, taxRate: 0.2 });
  });

  it('lets the amendment later in the list win when two share the same date', () => {
    const sale = buildSale('inv-1', '2024-01-01T00:00:00Z', [buildItem('item-a', 1000, 0.2)]);
    const first = buildAmendment('inv-1', 'item-a', '2024-01-10T00:00:00Z', 500, 0.1);
    const second = buildAmendment('inv-1', 'item-a', '2024-01-10T00:00:00Z', 250, 0.05);

    const result = getEffectiveItemValues([sale, first, second], 'inv-1', 'item-a', queryDate);

    expect(result).toEqual({ cost: 250, taxRate: 0.05 });
  });

  it('compares dates as moments in time, not as text, when timezone offsets differ', () => {
    // 10:00 at +05:00 is 05:00 UTC, which is EARLIER than 08:00 UTC.
    // As plain text, "2024-01-10T10:00:00+05:00" would wrongly sort AFTER "2024-01-10T08:00:00Z".
    const earlierMoment = buildAmendment('inv-1', 'item-a', '2024-01-10T10:00:00+05:00', 500, 0.1);
    const laterMoment = buildAmendment('inv-1', 'item-a', '2024-01-10T08:00:00Z', 300, 0.3);

    const result = getEffectiveItemValues(
      [laterMoment, earlierMoment],
      'inv-1',
      'item-a',
      queryDate,
    );

    expect(result).toEqual({ cost: 300, taxRate: 0.3 });
  });
});
