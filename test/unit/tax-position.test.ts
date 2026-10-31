// Unit tests for calculateTaxPosition: total tax from sales minus total tax payments, in whole pennies.

import { describe, expect, it } from 'vitest';
import { calculateTaxPosition } from '../../src/domain/tax-position.js';
import { buildAmendment, buildItem, buildPayment, buildSale } from './event-builders.js';

const queryDate = '2024-02-01T00:00:00Z';

describe('calculateTaxPosition', () => {
  it('returns zero when there are no events', () => {
    expect(calculateTaxPosition([], queryDate)).toBe(0);
  });

  it('adds up the tax from sales when there are only sales', () => {
    const sale = buildSale('inv-1', '2024-01-01T00:00:00Z', [
      buildItem('item-a', 1000, 0.2),
      buildItem('item-b', 500, 0.1),
    ]);
    const otherSale = buildSale('inv-2', '2024-01-02T00:00:00Z', [buildItem('item-a', 2000, 0.2)]);

    // 200 + 50 + 400
    expect(calculateTaxPosition([sale, otherSale], queryDate)).toBe(650);
  });

  it('returns a negative number when there are only payments', () => {
    const payments = [
      buildPayment('2024-01-05T00:00:00Z', 100),
      buildPayment('2024-01-06T00:00:00Z', 50),
    ];

    expect(calculateTaxPosition(payments, queryDate)).toBe(-150);
  });

  it('subtracts payments from sales tax when there are both', () => {
    const sale = buildSale('inv-1', '2024-01-01T00:00:00Z', [
      buildItem('item-a', 1000, 0.2),
      buildItem('item-b', 333, 0.1),
    ]);
    const payment = buildPayment('2024-01-05T00:00:00Z', 100);

    // (200 + 33) - 100
    expect(calculateTaxPosition([sale, payment], queryDate)).toBe(133);
  });

  it('uses the amendment values instead of the original sale values', () => {
    const sale = buildSale('inv-1', '2024-01-01T00:00:00Z', [buildItem('item-a', 1000, 0.2)]);
    const amendment = buildAmendment('inv-1', 'item-a', '2024-01-10T00:00:00Z', 500, 0.1);

    // The amended tax is 50, not the original 200.
    expect(calculateTaxPosition([sale, amendment], queryDate)).toBe(50);
  });

  it('applies an amendment correctly when it arrives before its sale', () => {
    const amendment = buildAmendment('inv-1', 'item-a', '2024-01-10T00:00:00Z', 500, 0.1);
    const sale = buildSale('inv-1', '2024-01-01T00:00:00Z', [buildItem('item-a', 1000, 0.2)]);

    expect(calculateTaxPosition([amendment, sale], queryDate)).toBe(50);
  });

  it('ignores an amendment that has no matching sale', () => {
    const amendment = buildAmendment('inv-1', 'item-a', '2024-01-10T00:00:00Z', 500, 0.1);

    expect(calculateTaxPosition([amendment], queryDate)).toBe(0);
  });

  it('returns a negative number when more tax has been paid than is owed', () => {
    const sale = buildSale('inv-1', '2024-01-01T00:00:00Z', [buildItem('item-a', 1000, 0.2)]);
    const payment = buildPayment('2024-01-05T00:00:00Z', 300);

    // 200 - 300
    expect(calculateTaxPosition([sale, payment], queryDate)).toBe(-100);
  });

  it('rounds the tax on each item separately before adding them up', () => {
    // Each item is 5 x 0.5 = 2.5, which rounds to 3. Two items give 6.
    // Adding first and rounding once would give 5, which is wrong.
    const sale = buildSale('inv-1', '2024-01-01T00:00:00Z', [
      buildItem('item-a', 5, 0.5),
      buildItem('item-b', 5, 0.5),
    ]);

    expect(calculateTaxPosition([sale], queryDate)).toBe(6);
  });
});
