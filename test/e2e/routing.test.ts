// End-to-end tests for routing: what happens when the path is unknown or the method is wrong.

import { describe, expect, it } from 'vitest';
import { useFreshServer } from './test-server.js';

const server = useFreshServer();

describe('routing', () => {
  it('answers an unknown path with 404 and "Not found"', async () => {
    const response = await server.send('GET', '/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.json).toEqual({ errors: ['Not found'] });
  });

  it('answers the root path with 404', async () => {
    const response = await server.send('GET', '/');

    expect(response.status).toBe(404);
  });

  it('answers the wrong method on POST /transactions with 405 and "Method not allowed"', async () => {
    const response = await server.send('GET', '/transactions');

    expect(response.status).toBe(405);
    expect(response.json).toEqual({ errors: ['Method not allowed'] });
  });

  it('answers the wrong method on GET /tax-position with 405', async () => {
    const response = await server.send('POST', '/tax-position', {});

    expect(response.status).toBe(405);
  });

  it('answers the wrong method on PATCH /sale with 405', async () => {
    const response = await server.send('DELETE', '/sale');

    expect(response.status).toBe(405);
  });

  it('tells the caller which method is allowed when it answers 405', async () => {
    const response = await server.send('PUT', '/sale', {});

    expect(response.headers.get('allow')).toBe('PATCH');
  });
});
