import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app.js';

describe('GET /health', () => {
  it('returns 200 and status ok', async () => {
    const app = buildApp();

    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('returns 404 for unknown routes', async () => {
    const app = buildApp();

    const response = await request(app).get('/does-not-exist');

    expect(response.status).toBe(404);
  });
});