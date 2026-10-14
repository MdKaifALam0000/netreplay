#!/usr/bin/env node

/**
 * NetReplay Emergency Fault Recovery and Reset Utility
 *
 * Safely inspects and clears any lingering network faults/toxics on Toxiproxy proxies.
 * Can be run manually by operators or automatically during deployment cleanup.
 *
 * Usage:
 *   node scripts/reset-faults.mjs [proxyName]
 *   npm run clean:faults
 */

import { ToxiproxyAdapter } from '../packages/toxiproxy/src/index.js';

const TOXIPROXY_CONTROL_URL = process.env.TOXIPROXY_CONTROL_URL || 'http://127.0.0.1:8474';
const DEFAULT_PROXY_NAME = process.env.TOXIPROXY_PROXY_NAME || 'netreplay-demo';
const targetProxy = process.argv[2] || DEFAULT_PROXY_NAME;

console.log('================================================================');
console.log('       NetReplay Manual Fault Recovery & Reset Utility          ');
console.log('================================================================');
console.log(`Control URL : ${TOXIPROXY_CONTROL_URL}`);
console.log(`Target Proxy: ${targetProxy}`);
console.log('----------------------------------------------------------------');

async function main() {
  const adapter = new ToxiproxyAdapter({
    baseUrl: TOXIPROXY_CONTROL_URL,
    userAgent: 'NetReplay-ResetUtility/1.0',
    timeoutMs: 5000,
  });

  try {
    const health = await adapter.checkHealth();
    if (!health.healthy) {
      console.error(`[!] Toxiproxy reported unhealthy at ${TOXIPROXY_CONTROL_URL}`);
      process.exitCode = 1;
      return;
    }
    console.log(`[+] Toxiproxy engine is reachable (v${health.version || 'unknown'})`);
  } catch (err) {
    console.error(`[!] Failed to connect to Toxiproxy at ${TOXIPROXY_CONTROL_URL}: ${err.message}`);
    console.error('    Please ensure Toxiproxy container is running (docker compose up -d toxiproxy)');
    process.exitCode = 1;
    return;
  }

  try {
    const proxy = await adapter.getProxy(targetProxy);
    if (!proxy) {
      console.log(`[*] Proxy '${targetProxy}' does not exist on Toxiproxy. Nothing to clean.`);
      return;
    }

    console.log(`[*] Inspecting active toxics on '${targetProxy}'...`);
    const toxics = await adapter.client.listToxics(targetProxy);

    if (toxics.length === 0) {
      console.log(`[+] No active faults detected on '${targetProxy}'. Proxy is in clean baseline state.`);
      return;
    }

    console.log(`[!] Found ${toxics.length} active fault(s) on '${targetProxy}':`);
    for (const toxic of toxics) {
      console.log(`    - ${toxic.name} (${toxic.type}, stream=${toxic.stream}, toxicity=${toxic.toxicity})`);
    }

    console.log(`[*] Removing active faults...`);
    const removedCount = await adapter.clearFaults(targetProxy);
    console.log(`[+] Successfully removed ${removedCount} fault(s).`);
    console.log(`[+] Proxy '${targetProxy}' has been restored to clean baseline state.`);
  } catch (err) {
    console.error(`[!] Error while clearing faults: ${err.message}`);
    process.exitCode = 1;
  }
}

main();
