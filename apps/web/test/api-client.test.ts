import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiClient, ApiClientError } from '../src/api/client';

describe('API Client Suite', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('handles successful JSON responses', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ status: 'ok', service: 'netreplay-api' }),
    } as any);

    const data = await apiClient.getHealth();
    expect(data.status).toBe('ok');
    expect(data.service).toBe('netreplay-api');
  });

  it('parses structured API errors from non-2xx responses', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      headers: { get: () => 'application/json' },
      json: async () => ({
        statusCode: 400,
        error: 'BAD_REQUEST',
        message: 'Name is required',
        details: [{ path: 'name', message: 'Required' }],
      }),
    } as any);

    await expect(apiClient.createProfile({ name: '', faults: [] })).rejects.toThrow(
      ApiClientError
    );

    try {
      await apiClient.createProfile({ name: '', faults: [] });
    } catch (err: any) {
      expect(err).toBeInstanceOf(ApiClientError);
      expect(err.statusCode).toBe(400);
      expect(err.message).toBe('Name is required');
      expect(err.error).toBe('BAD_REQUEST');
      expect(err.details).toEqual([{ path: 'name', message: 'Required' }]);
    }
  });

  it('handles 404 Not Found error properly', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: { get: () => 'application/json' },
      json: async () => ({
        statusCode: 404,
        error: 'NOT_FOUND',
        message: 'Profile not found',
      }),
    } as any);

    await expect(apiClient.getProfile('non-existent')).rejects.toThrow('Profile not found');
  });

  it('handles 204 No Content for DELETE requests safely', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      headers: { get: () => null },
    } as any);

    const result = await apiClient.deleteProfile('profile-123');
    expect(result).toBeUndefined();
  });

  it('translates network fetch rejections into safe ApiClientError without crashing', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Failed to fetch'));

    await expect(apiClient.getHealth()).rejects.toThrow(ApiClientError);
    try {
      await apiClient.getHealth();
    } catch (err: any) {
      expect(err.error).toBe('NETWORK_ERROR');
      expect(err.statusCode).toBe(0);
    }
  });
});
