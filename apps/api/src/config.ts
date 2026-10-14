/**
 * NetReplay API Configuration Module
 *
 * Centralizes environment variable resolution with safe local defaults.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Load .env if present
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface AppConfig {
  env: string;
  port: number;
  host: string;
  databaseUrl: string;
  toxiproxyControlUrl: string;
  toxiproxyProxyName: string;
  testTargetDirectUrl: string;
  testTargetProxyUrl: string;
  logLevel: string;
  maxConcurrentRuns: number;
  corsOrigins: string[];
  requestBodyLimit: number;
  connectionTimeoutMs: number;
}

const defaultDbPath = path.resolve(__dirname, '..', 'prisma', 'dev.db');

export const config: AppConfig = {
  env: process.env.NODE_ENV || 'development',
  port: Number.parseInt(process.env.API_PORT || process.env.PORT || '3100', 10),
  host: process.env.API_HOST || process.env.HOST || '127.0.0.1',
  databaseUrl: process.env.DATABASE_URL || `file:${defaultDbPath}`,
  toxiproxyControlUrl: process.env.TOXIPROXY_CONTROL_URL || 'http://127.0.0.1:8474',
  toxiproxyProxyName: process.env.TOXIPROXY_PROXY_NAME || 'netreplay-demo',
  testTargetDirectUrl: process.env.TEST_TARGET_DIRECT_URL || 'http://127.0.0.1:3000',
  testTargetProxyUrl: process.env.TEST_TARGET_PROXY_URL || 'http://127.0.0.1:8666',
  logLevel: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  maxConcurrentRuns: 1, // Strict single-experiment concurrency per proxy
  corsOrigins: process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map((s) => s.trim())
    : ['http://localhost:5173', 'http://127.0.0.1:5173'],
  requestBodyLimit: Number.parseInt(process.env.REQUEST_BODY_LIMIT_BYTES || '1048576', 10), // 1MB
  connectionTimeoutMs: Number.parseInt(process.env.CONNECTION_TIMEOUT_MS || '30000', 10), // 30s
};

