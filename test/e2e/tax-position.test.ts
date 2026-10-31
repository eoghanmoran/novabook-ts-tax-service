// End-to-end tests for GET /tax-position, using real HTTP requests against a fresh in-memory service.

import { describe, expect, it } from 'vitest';
import { buildItem, buildPayment, buildSale } from '../unit/event-builders.js';
import { taxPositionPath, useFreshServer } from './test-server.js';

const server = useFreshServer();

describe('GET /tax-position', () => {
  it('returns 200 with the date and the tax position for a valid date', async () => {
    const response = await server.send('GET', taxPositionPath('2024-02-01T00:00:00Z'));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.json).toEqual({ date: '2024-02-01T00:00:00Z', taxPosition: 0 });
  });

  it('returns a tax position of 0 when there are no events at all', async () => {
    const response = await server.send('GET', taxPositionPath('2024-02-01T00:00:00Z'));

    expect(response.json).toEqual({ date: '2024-02-01T00:00:00Z', taxPosition: 0 });
  });

  it('returns the tax from sales minus the tax payments', async () => {
    const sale = buildSale('inv-1', '2024-01-01T00:00:00Z', [
      buildItem('item-a', 1000, 0.2),
      buildItem('item-b', 333, 0.1),
    ]);
    await server.send('POST', '/transactions', sale);
    await server.send('POST', '/transactions', buildPayment('2024-01-05T00:00:00Z', 100));

    const response = await server.send('GET', taxPositionPath('2024-02-01T00:00:00Z'));

    // Tax is 200 + 33 = 233, minus the payment of 100.
    expect(response.json).toEqual({ date: '2024-02-01T00:00:00Z', taxPosition: 133 });
  });

  it('returns 0 for a date before all events', async () => {
    const sale = buildSale('inv-1', '2024-06-01T00:00:00Z', [buildItem('item-a', 1000, 0.2)]);
    await server.send('POST', '/transactions', sale);
    await server.send('POST', '/transactions', buildPayment('2024-06-02T00:00:00Z', 100));

    const response = await server.send('GET', taxPositionPath('2024-01-01T00:00:00Z'));

    expect(response.json).toEqual({ date: '2024-01-01T00:00:00Z', taxPosition: 0 });
  });

  it('understands a date written with a timezone offset', async () => {
    const sale = buildSale('inv-1', '2024-01-01T12:00:00Z', [buildItem('item-a', 1000, 0.2)]);
    await server.send('POST', '/transactions', sale);

    // 13:00 at +02:00 is 11:00 UTC, which is before the sale at 12:00 UTC.
    const beforeSale = await server.send('GET', taxPositionPath('2024-01-01T13:00:00+02:00'));
    // 15:00 at +02:00 is 13:00 UTC, which is after the sale.
    const afterSale = await server.send('GET', taxPositionPath('2024-01-01T15:00:00+02:00'));

    expect(beforeSale.json).toEqual({ date: '2024-01-01T13:00:00+02:00', taxPosition: 0 });
    expect(afterSale.json).toEqual({ date: '2024-01-01T15:00:00+02:00', taxPosition: 200 });
  });

  it('rejects a request with no date using 400', async () => {
    const response = await server.send('GET', '/tax-position');

    expect(response.status).toBe(400);
    expect(response.text).toContain('date');
  });

  it('rejects a date that is not a date using 400', async () => {
    const response = await server.send('GET', taxPositionPath('not-a-date'));

    expect(response.status).toBe(400);
    expect(response.text).toContain('date');
  });

  it('rejects a date with no time of day using 400', async () => {
    const response = await server.send('GET', taxPositionPath('2024-02-01'));

    expect(response.status).toBe(400);
  });
});
