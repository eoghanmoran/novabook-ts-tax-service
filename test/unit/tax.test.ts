// Unit tests for calculateItemTax: the tax on one item is cost x taxRate, rounded once to whole pennies.

import { describe, expect, it } from 'vitest';
import { calculateItemTax } from '../../src/domain/tax.js';

describe('calculateItemTax', () => {
  it('multiplies the cost by the tax rate', () => {
    expect(calculateItemTax(1000, 0.2)).toBe(200);
  });

  it('rounds down when the fraction is under half a penny', () => {
    // 333 x 0.1 = 33.3
    expect(calculateItemTax(333, 0.1)).toBe(33);
  });

  it('rounds up when the fraction is exactly half a penny', () => {
    // 5 x 0.5 = 2.5
    expect(calculateItemTax(5, 0.5)).toBe(3);
  });

  it('rounds up when the fraction is more than half a penny', () => {
    // 367 x 0.1 = 36.7
    expect(calculateItemTax(367, 0.1)).toBe(37);
  });

  it('returns zero when the cost is zero', () => {
    expect(calculateItemTax(0, 0.2)).toBe(0);
  });

  it('returns zero when the tax rate is zero', () => {
    expect(calculateItemTax(1000, 0)).toBe(0);
  });
});
