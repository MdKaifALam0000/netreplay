/**
 * NetReplay Toxiproxy Engine Adapter
 *
 * High-level orchestration adapter providing domain-level network fault injection,
 * idempotent proxy lifecycle management, and scoped fault isolation with cleanup guarantees.
 */

import { ToxiproxyClient } from './client.js';
import { validateProxyConfig, validateAndMapFault } from './validation.js';
import {
  ToxiproxyError,
  ToxiproxyNotFoundError,
  ToxiproxyConflictError,
  ToxiproxyCleanupError,
} from './errors.js';

/**
 * Normalizes host:port or :port strings to compare ports safely.
 *
 * @param {string} addr
 * @returns {{ host: string, port: number }}
 */
function parseAddress(addr) {
  if (!addr || typeof addr !== 'string') {
    return { host: '', port: 0 };
  }
  const clean = addr.trim();
  const lastColon = clean.lastIndexOf(':');
  if (lastColon === -1) {
    return { host: clean, port: 0 };
  }
  const host = clean.slice(0, lastColon).replace(/^\[|\]$/g, '');
  const port = Number.parseInt(clean.slice(lastColon + 1), 10) || 0;
  return { host, port };
}

/**
 * Determines whether two listen addresses represent equivalent listeners.
 *
 * @param {string} addr1
 * @param {string} addr2
 * @returns {boolean}
 */
function isEquivalentListenAddress(addr1, addr2) {
  if (addr1 === addr2) {
    return true;
  }
  const p1 = parseAddress(addr1);
  const p2 = parseAddress(addr2);

  // If ports match and both bind to all-interfaces (0.0.0.0, ::, "", or empty)
  if (p1.port === p2.port && p1.port > 0) {
    const isWildcard1 = !p1.host || p1.host === '0.0.0.0' || p1.host === '::';
    const isWildcard2 = !p2.host || p2.host === '0.0.0.0' || p2.host === '::';
    if (isWildcard1 && isWildcard2) {
      return true;
    }
    return p1.host.toLowerCase() === p2.host.toLowerCase();
  }
  return false;
}

export class ToxiproxyAdapter {
  /**
   * @param {ToxiproxyClient | object} [clientOrOptions]
   */
  constructor(clientOrOptions) {
    if (clientOrOptions instanceof ToxiproxyClient) {
      this.client = clientOrOptions;
    } else {
      this.client = new ToxiproxyClient(clientOrOptions || {});
    }
  }

  /**
   * Checks Toxiproxy engine connectivity and returns version metadata.
   *
   * @returns {Promise<{ healthy: boolean, version: string, baseUrl: string }>}
   */
  async checkHealth() {
    const version = await this.client.getVersion();
    return {
      healthy: true,
      version,
      baseUrl: this.client.baseUrl,
    };
  }

  /**
   * Lists all proxies configured in the engine.
   *
   * @returns {Promise<Record<string, object>>}
   */
  async listProxies() {
    return await this.client.listProxies();
  }

  /**
   * Retrieves a specific proxy by name, or null if it does not exist.
   *
   * @param {string} proxyName
   * @returns {Promise<object|null>}
   */
  async getProxy(proxyName) {
    try {
      return await this.client.getProxy(proxyName);
    } catch (err) {
      if (err instanceof ToxiproxyNotFoundError) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Ensures that a proxy exists and matches the desired specification.
   * Idempotent: creates if missing, verifies if present, and updates safely if needed.
   *
   * @param {object} proxyConfig
   * @param {string} proxyConfig.name
   * @param {string} proxyConfig.listen
   * @param {string} proxyConfig.upstream
   * @param {boolean} [proxyConfig.enabled=true]
   * @returns {Promise<object>} Current proxy state
   */
  async ensureProxy(proxyConfig) {
    const validated = validateProxyConfig(proxyConfig);
    const existing = await this.getProxy(validated.name);

    if (!existing) {
      // Create new proxy
      return await this.client.createProxy(validated);
    }

    // Inspect existing state
    const listenMatches = isEquivalentListenAddress(existing.listen, validated.listen);
    const upstreamMatches = existing.upstream.trim() === validated.upstream.trim();
    const enabledMatches = Boolean(existing.enabled) === validated.enabled;

    if (listenMatches && upstreamMatches && enabledMatches) {
      // Exact match, reuse without restart
      return existing;
    }

    // Update fields if changed
    const updates = {};
    if (!listenMatches) {
      updates.listen = validated.listen;
    }
    if (!upstreamMatches) {
      updates.upstream = validated.upstream;
    }
    if (!enabledMatches) {
      updates.enabled = validated.enabled;
    }

    return await this.client.updateProxy(validated.name, updates);
  }

  /**
   * Re-enables a proxy.
   *
   * @param {string} proxyName
   * @returns {Promise<object>}
   */
  async enableProxy(proxyName) {
    return await this.client.enableProxy(proxyName);
  }

  /**
   * Emergency disable for a specific proxy.
   *
   * @param {string} proxyName
   * @returns {Promise<object>}
   */
  async disableProxy(proxyName) {
    return await this.client.disableProxy(proxyName);
  }

  /**
   * Applies an internal NetReplay fault to a named proxy.
   * Validates schema, checks for toxic name collisions, and injects into Toxiproxy.
   *
   * @param {string} proxyName
   * @param {object} faultConfig
   * @returns {Promise<object>} Created toxic details
   */
  async applyFault(proxyName, faultConfig) {
    const toxicPayload = validateAndMapFault(faultConfig);

    // Collision check: verify if a toxic with the target name is already active
    try {
      const existing = await this.client.getToxic(proxyName, toxicPayload.name);
      if (existing) {
        // Check if configuration matches
        const typeMatches = existing.type === toxicPayload.type;
        const streamMatches = existing.stream === toxicPayload.stream;
        if (typeMatches && streamMatches) {
          // Update attributes on matching toxic instead of erroring
          return await this.client.updateToxic(proxyName, toxicPayload.name, toxicPayload);
        }
        throw new ToxiproxyConflictError(
          `Toxic '${toxicPayload.name}' already exists on proxy '${proxyName}' with differing type/stream ` +
          `(existing: ${existing.type}/${existing.stream}, new: ${toxicPayload.type}/${toxicPayload.stream})`,
          toxicPayload.name
        );
      }
    } catch (err) {
      if (!(err instanceof ToxiproxyNotFoundError)) {
        throw err;
      }
      // Not found is the expected normal case for new toxics
    }

    return await this.client.createToxic(proxyName, toxicPayload);
  }

  /**
   * Removes a specific named toxic from a proxy.
   * Idempotent: succeeds cleanly even if the toxic was already removed.
   *
   * @param {string} proxyName
   * @param {string} toxicName
   * @returns {Promise<boolean>} True if removed, false if not found
   */
  async removeFault(proxyName, toxicName) {
    try {
      await this.client.removeToxic(proxyName, toxicName);
      return true;
    } catch (err) {
      if (err instanceof ToxiproxyNotFoundError) {
        return false;
      }
      throw err;
    }
  }

  /**
   * Clears all active toxics from a specific proxy without affecting other proxies
   * or resetting the entire engine.
   *
   * @param {string} proxyName
   * @returns {Promise<number>} Count of removed toxics
   */
  async clearFaults(proxyName) {
    const toxics = await this.client.listToxics(proxyName);
    let removedCount = 0;

    for (const toxic of toxics) {
      try {
        await this.client.removeToxic(proxyName, toxic.name);
        removedCount++;
      } catch (err) {
        if (!(err instanceof ToxiproxyNotFoundError)) {
          throw err;
        }
      }
    }
    return removedCount;
  }

  /**
   * Destroys a proxy and closes its listening port.
   *
   * @param {string} proxyName
   * @returns {Promise<boolean>} True if destroyed, false if already absent
   */
  async destroyProxy(proxyName) {
    try {
      await this.client.deleteProxy(proxyName);
      return true;
    } catch (err) {
      if (err instanceof ToxiproxyNotFoundError) {
        return false;
      }
      throw err;
    }
  }

  /**
   * Executes a callback within the scope of an applied fault, guaranteeing
   * toxic cleanup in a finally block upon completion or failure.
   *
   * @template T
   * @param {string} proxyName
   * @param {object} faultConfig
   * @param {() => Promise<T> | T} callback
   * @returns {Promise<T>} Result of callback
   */
  async withFault(proxyName, faultConfig, callback) {
    if (typeof callback !== 'function') {
      throw new ToxiproxyError('Callback provided to withFault must be a function');
    }

    // Step 1: Validate and apply fault
    const toxic = await this.applyFault(proxyName, faultConfig);
    const toxicName = toxic.name;

    let callbackError = null;
    let result;

    // Step 2: Execute scoped callback
    try {
      result = await callback();
    } catch (err) {
      callbackError = err;
    }

    // Step 3: Guaranteed cleanup in finally block
    let cleanupError = null;
    try {
      await this.removeFault(proxyName, toxicName);
    } catch (err) {
      cleanupError = err;
    }

    // Step 4: Coordinated error propagation
    if (callbackError) {
      if (cleanupError) {
        // Both failed: preserve original error and attach cleanup failure
        callbackError.cleanupError = cleanupError;
      }
      throw callbackError;
    }

    if (cleanupError) {
      // Callback succeeded but cleanup failed: make failure visible to caller
      throw new ToxiproxyCleanupError(
        `Experiment callback succeeded, but fault cleanup failed for toxic '${toxicName}' on proxy '${proxyName}': ${cleanupError.message}`,
        null,
        cleanupError
      );
    }

    return result;
  }
}
