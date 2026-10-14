/**
 * NetReplay Toxiproxy Adapter Service Wrapper
 *
 * Integrates the reusable Step 2 JavaScript adapter into the TypeScript Fastify API,
 * providing strong typing, connection pooling, and engine health checks.
 */

import { config } from '../config.js';
// @ts-expect-error - JavaScript package without ambient types
import { ToxiproxyAdapter } from '../../../../packages/toxiproxy/src/index.js';

export interface ToxiproxyHealth {
  id: string;
  name: string;
  version: string;
  healthy: boolean;
  controlUrl: string;
  proxyName: string;
  trafficUrl: string;
}

export interface EngineInfo {
  id: string;
  name: string;
  configured: boolean;
  healthy: boolean;
  description: string;
}

export class ToxiproxyService {
  private adapter: any;
  public readonly controlUrl: string;
  public readonly proxyName: string;
  public readonly trafficUrl: string;

  constructor(options?: { controlUrl?: string; proxyName?: string; trafficUrl?: string; adapter?: any }) {
    this.controlUrl = options?.controlUrl || config.toxiproxyControlUrl;
    this.proxyName = options?.proxyName || config.toxiproxyProxyName;
    this.trafficUrl = options?.trafficUrl || config.testTargetProxyUrl;

    if (options?.adapter) {
      this.adapter = options.adapter;
    } else {
      this.adapter = new ToxiproxyAdapter({
        baseUrl: this.controlUrl,
        userAgent: 'NetReplay-FastifyApi/1.0',
      });
    }
  }

  /**
   * Returns engine capability metadata.
   */
  async getEngineInfo(): Promise<EngineInfo> {
    let healthy = false;
    try {
      const health = await this.adapter.checkHealth();
      healthy = Boolean(health?.healthy);
    } catch {
      healthy = false;
    }

    return {
      id: 'toxiproxy',
      name: 'Shopify Toxiproxy',
      configured: true,
      healthy,
      description: 'L4/L7 TCP proxy fault injection engine supporting latency, timeouts, bandwidth limits, and TCP resets.',
    };
  }

  /**
   * Retrieves detailed Toxiproxy engine status and version.
   */
  async getHealth(): Promise<ToxiproxyHealth> {
    const health = await this.adapter.checkHealth();
    return {
      id: 'toxiproxy',
      name: 'Shopify Toxiproxy',
      version: String(health.version || 'unknown'),
      healthy: Boolean(health.healthy),
      controlUrl: this.controlUrl,
      proxyName: this.proxyName,
      trafficUrl: this.trafficUrl,
    };
  }

  /**
   * Ensures the proxy listener is ready and pointing to the test target.
   */
  async ensureProxyReady(): Promise<any> {
    return await this.adapter.ensureProxy({
      name: this.proxyName,
      listen: '0.0.0.0:8666',
      upstream: 'test-target:3000',
      enabled: true,
    });
  }

  /**
   * Applies an internal NetReplay fault.
   */
  async applyFault(fault: any): Promise<any> {
    return await this.adapter.applyFault(this.proxyName, fault);
  }

  /**
   * Removes a specific named fault.
   */
  async removeFault(faultName: string): Promise<boolean> {
    return await this.adapter.removeFault(this.proxyName, faultName);
  }

  /**
   * Clears all active faults on the proxy.
   */
  async clearFaults(): Promise<number> {
    return await this.adapter.clearFaults(this.proxyName);
  }

  /**
   * Executes callback within scoped fault lifecycle.
   */
  async withFault<T>(fault: any, callback: () => Promise<T>): Promise<T> {
    return await this.adapter.withFault(this.proxyName, fault, callback);
  }
}

export const toxiproxyService = new ToxiproxyService();
