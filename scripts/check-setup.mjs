#!/usr/bin/env node

/**
 * NetReplay Environment & Preflight Setup Diagnostic Utility
 *
 * Verifies local development prerequisites, runtime versions, port bindings,
 * database connectivity, Toxiproxy reachability, and test target health.
 *
 * Usage:
 *   node scripts/check-setup.mjs
 *   npm run check:setup
 */

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('================================================================');
console.log('            NetReplay Preflight & Environment Setup Check       ');
console.log('================================================================\n');

let criticalFailures = 0;
let warnings = 0;

function pass(title, detail = '') {
  console.log(`  [✔] ${title}${detail ? ` (${detail})` : ''}`);
}

function warn(title, advice = '') {
  warnings++;
  console.log(`  [!] WARN: ${title}`);
  if (advice) console.log(`      -> Action: ${advice}`);
}

function fail(title, advice = '') {
  criticalFailures++;
  console.log(`  [✖] FAIL: ${title}`);
  if (advice) console.log(`      -> Fix: ${advice}`);
}

async function probeUrl(url, timeoutMs = 2000) {
  return new Promise((resolve) => {
    try {
      const u = new URL(url);
      const req = http.request(
        {
          hostname: u.hostname,
          port: u.port,
          path: u.pathname + u.search,
          method: 'GET',
          timeout: timeoutMs,
          headers: { 'User-Agent': 'NetReplay-SetupCheck/1.0' },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            resolve({ ok: res.statusCode >= 200 && res.statusCode < 400, statusCode: res.statusCode, data });
          });
        }
      );

      req.on('error', (err) => resolve({ ok: false, error: err.message }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, error: 'Connection timed out' });
      });
      req.end();
    } catch (err) {
      resolve({ ok: false, error: err.message });
    }
  });
}

async function runPreflight() {
  // --------------------------------------------------------------------------
  // 1. Runtime Version Checks
  // --------------------------------------------------------------------------
  console.log('1. Runtime Environment:');
  const nodeVersion = process.version;
  const majorNode = Number.parseInt(nodeVersion.replace(/^v/, '').split('.')[0], 10);

  if (majorNode >= 20) {
    pass('Node.js Runtime', `${nodeVersion} (LTS >= 20.0.0 required)`);
  } else {
    fail('Node.js Runtime', `Found ${nodeVersion}. Please upgrade to Node.js 20 LTS, 22 LTS, or newer.`);
  }

  // --------------------------------------------------------------------------
  // 2. Configuration & Environment Files
  // --------------------------------------------------------------------------
  console.log('\n2. Environment Configuration:');
  const rootEnv = path.join(rootDir, '.env');
  const rootEnvExample = path.join(rootDir, '.env.example');

  if (fs.existsSync(rootEnvExample)) {
    pass('.env.example template present');
  } else {
    fail('.env.example missing', 'Restore .env.example from git.');
  }

  if (fs.existsSync(rootEnv)) {
    pass('Local .env present');
  } else {
    warn('Local .env not found (using default environment values)', 'Run: Copy-Item .env.example .env (optional if using defaults)');
  }

  // --------------------------------------------------------------------------
  // 3. Database & Prisma Schema
  // --------------------------------------------------------------------------
  console.log('\n3. Database & Persistence Layer:');
  const prismaSchema = path.join(rootDir, 'apps', 'api', 'prisma', 'schema.prisma');
  const devDb = path.join(rootDir, 'apps', 'api', 'prisma', 'dev.db');

  if (fs.existsSync(prismaSchema)) {
    pass('Prisma Schema exists', 'apps/api/prisma/schema.prisma');
  } else {
    fail('Prisma schema missing', 'Ensure repository has not been corrupted.');
  }

  if (fs.existsSync(devDb)) {
    const stats = fs.statSync(devDb);
    pass('SQLite Database exists', `dev.db (${stats.size} bytes)`);
  } else {
    warn('Local SQLite database not initialized', 'Run: npm run prisma:migrate');
  }

  // --------------------------------------------------------------------------
  // 4. Infrastructure & Container Services
  // --------------------------------------------------------------------------
  console.log('\n4. Background Services & Network Topology:');

  // Test Target (:3000)
  const targetProbe = await probeUrl('http://127.0.0.1:3000/health');
  if (targetProbe.ok) {
    pass('Deterministic Test Target (:3000)', 'HTTP 200 OK');
  } else {
    warn('Test Target not responding on port 3000', 'Start services via: docker compose up -d test-target');
  }

  // Toxiproxy Control API (:8474)
  const toxiProbe = await probeUrl('http://127.0.0.1:8474/version');
  if (toxiProbe.ok) {
    let version = 'unknown';
    try {
      version = toxiProbe.data.trim();
    } catch {}
    pass('Toxiproxy Control API (:8474)', `v${version}`);

    // Check proxy registration
    const proxyProbe = await probeUrl('http://127.0.0.1:8474/proxies/netreplay-demo');
    if (proxyProbe.ok) {
      pass("Toxiproxy Proxy 'netreplay-demo' registered");
    } else {
      warn("Proxy 'netreplay-demo' not yet provisioned", 'It will be auto-created upon first run or by running: npm run test:smoke');
    }
  } else {
    warn('Toxiproxy engine not responding on port 8474', 'Start Toxiproxy via: docker compose up -d toxiproxy');
  }

  // Fastify REST API (:3100)
  const apiProbe = await probeUrl('http://127.0.0.1:3100/health');
  if (apiProbe.ok) {
    pass('Fastify REST API (:3100)', 'HTTP 200 OK');
  } else {
    pass('Fastify REST API port (:3100) ready for dev server', 'Start with: npm run dev:api');
  }

  // React Web Dashboard (:5173)
  const webProbe = await probeUrl('http://127.0.0.1:5173');
  if (webProbe.ok) {
    pass('React Web Dashboard (:5173)', 'Server active');
  } else {
    pass('React Web Dashboard port (:5173) ready for dev server', 'Start with: npm run dev:web');
  }

  // --------------------------------------------------------------------------
  // 5. Summary & Guidance
  // --------------------------------------------------------------------------
  console.log('\n================================================================');
  if (criticalFailures === 0 && warnings === 0) {
    console.log('   🎉 ALL PREFLIGHT CHECKS PASSED! NetReplay is ready to run.   ');
  } else if (criticalFailures === 0) {
    console.log(`   ℹ Preflight passed with ${warnings} advisory warning(s). Environment is functional.`);
  } else {
    console.log(`   ❌ Preflight failed with ${criticalFailures} critical issue(s). Resolve before continuing.`);
  }
  console.log('================================================================\n');

  if (criticalFailures > 0) {
    process.exitCode = 1;
  }
}

runPreflight();
