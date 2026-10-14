/**
 * NetReplay Toxiproxy HTTP Client
 *
 * Low-level, typed HTTP client communicating with Shopify Toxiproxy v2 REST API.
 * Uses Node.js native fetch, AbortController, and strict URL/header handling.
 */

import {
  ToxiproxyError,
  ToxiproxyValidationError,
  ToxiproxyHttpError,
  ToxiproxyNotFoundError,
  ToxiproxyConflictError,
  ToxiproxyConnectionError,
  ToxiproxyTimeoutError,
} from './errors.js';

const DEFAULT_BASE_URL = 'http://127.0.0.1:8474';
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_USER_AGENT = 'NetReplay-EngineAdapter/1.0';

/**
 * Validates and normalizes a base URL.
 *
 * @param {string} rawUrl
 * @returns {string}
 */
function normalizeBaseUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.trim().length === 0) {
    throw new ToxiproxyValidationError("Base URL must be a non-empty string", 'baseUrl', rawUrl);
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (err) {
    throw new ToxiproxyValidationError(`Invalid base URL: '${rawUrl}'`, 'baseUrl', rawUrl);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ToxiproxyValidationError(
      `Unsupported protocol '${parsed.protocol}' in base URL. Only http: and https: are supported.`,
      'baseUrl',
      rawUrl
    );
  }

  // Remove trailing slashes
  return parsed.origin + parsed.pathname.replace(/\/+$/, '');
}

export class ToxiproxyClient {
  /**
   * @param {object} [options={}]
   * @param {string} [options.baseUrl]
   * @param {number} [options.timeoutMs]
   * @param {string} [options.userAgent]
   * @param {typeof fetch} [options.fetch]
   */
  constructor(options = {}) {
    const rawUrl = options.baseUrl ||
      (typeof process !== 'undefined' && (process.env.TOXIPROXY_CONTROL_URL || process.env.TOXIPROXY_URL)) ||
      DEFAULT_BASE_URL;

    this.baseUrl = normalizeBaseUrl(rawUrl);
    this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    this.userAgent = options.userAgent || DEFAULT_USER_AGENT;
    this.fetchFn = options.fetch || globalThis.fetch;

    if (typeof this.fetchFn !== 'function') {
      throw new ToxiproxyError('A valid fetch implementation must be available globally or passed in options.fetch');
    }
  }

  /**
   * Internal HTTP dispatcher with timeout, error translation, and safe JSON handling.
   *
   * @param {string} method
   * @param {string} path
   * @param {object} [body=null]
   * @param {number} [timeoutMs]
   * @returns {Promise<any>}
   * @private
   */
  async _request(method, path, body = null, timeoutMs = this.timeoutMs) {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : '/' + path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const headers = {
      'User-Agent': this.userAgent,
      'Accept': 'application/json',
    };

    const requestInit = {
      method,
      headers,
      signal: controller.signal,
    };

    if (body !== null && body !== undefined) {
      headers['Content-Type'] = 'application/json';
      requestInit.body = JSON.stringify(body);
    }

    let response;
    try {
      response = await this.fetchFn(url, requestInit);
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new ToxiproxyTimeoutError(
          `Toxiproxy request timed out after ${timeoutMs}ms: ${method} ${path}`,
          timeoutMs,
          url
        );
      }
      throw new ToxiproxyConnectionError(
        `Failed to connect to Toxiproxy at ${url}: ${err.message}`,
        url,
        err
      );
    } finally {
      clearTimeout(timer);
    }

    // Handle responses
    const status = response.status;
    let responseText = '';
    try {
      responseText = await response.text();
    } catch {
      responseText = '';
    }

    // Success with no body (e.g. 204 No Content)
    if (status === 204 || (!responseText && response.ok)) {
      return null;
    }

    let parsedJson = null;
    if (responseText) {
      try {
        parsedJson = JSON.parse(responseText);
      } catch {
        // Body is not JSON
        parsedJson = responseText;
      }
    }

    if (!response.ok) {
      const errMsg = typeof parsedJson === 'object' && parsedJson?.title
        ? `${parsedJson.title}: ${parsedJson.error || ''}`.trim()
        : (typeof parsedJson === 'string' ? parsedJson : `HTTP ${status} ${response.statusText}`);

      if (status === 404) {
        throw new ToxiproxyNotFoundError(
          `Resource not found at ${path}: ${errMsg}`,
          path,
          url
        );
      }

      if (status === 409) {
        throw new ToxiproxyConflictError(
          `Conflict at ${path}: ${errMsg}`,
          path,
          url
        );
      }

      throw new ToxiproxyHttpError(
        `Toxiproxy API error (${method} ${path}): ${errMsg}`,
        status,
        response.statusText,
        responseText,
        url
      );
    }

    return parsedJson;
  }

  // --------------------------------------------------------------------------
  // Core Engine Operations
  // --------------------------------------------------------------------------

  /**
   * Retrieves the Toxiproxy server version string.
   *
   * @returns {Promise<string>} e.g. "2.12.0"
   */
  async getVersion() {
    const data = await this._request('GET', '/version');
    if (typeof data === 'object' && data?.version) {
      return String(data.version);
    }
    return String(data).trim();
  }

  /**
   * Performs an explicit global reset of Toxiproxy.
   * Enables all proxies and removes all active toxics.
   * Note: This is a destructive global operation and should be used cautiously.
   *
   * @returns {Promise<void>}
   */
  async resetEngine() {
    await this._request('POST', '/reset');
  }

  // --------------------------------------------------------------------------
  // Proxy Operations
  // --------------------------------------------------------------------------

  /**
   * Lists all configured proxies.
   *
   * @returns {Promise<Record<string, object>>}
   */
  async listProxies() {
    const data = await this._request('GET', '/proxies');
    return data || {};
  }

  /**
   * Retrieves details of a specific proxy.
   *
   * @param {string} name
   * @returns {Promise<object>}
   */
  async getProxy(name) {
    if (!name || typeof name !== 'string') {
      throw new ToxiproxyValidationError("Proxy name must be a non-empty string", 'name', name);
    }
    return await this._request('GET', `/proxies/${encodeURIComponent(name)}`);
  }

  /**
   * Creates a new proxy.
   *
   * @param {object} proxyConfig
   * @param {string} proxyConfig.name
   * @param {string} proxyConfig.listen
   * @param {string} proxyConfig.upstream
   * @param {boolean} [proxyConfig.enabled=true]
   * @returns {Promise<object>}
   */
  async createProxy(proxyConfig) {
    if (!proxyConfig || typeof proxyConfig !== 'object') {
      throw new ToxiproxyValidationError("Proxy configuration must be an object", 'proxyConfig', proxyConfig);
    }
    return await this._request('POST', '/proxies', proxyConfig);
  }

  /**
   * Updates fields of an existing proxy (e.g. listen, upstream, enabled).
   *
   * @param {string} name
   * @param {object} fields
   * @returns {Promise<object>}
   */
  async updateProxy(name, fields) {
    if (!name || typeof name !== 'string') {
      throw new ToxiproxyValidationError("Proxy name must be a non-empty string", 'name', name);
    }
    return await this._request('POST', `/proxies/${encodeURIComponent(name)}`, fields);
  }

  /**
   * Enables an existing proxy.
   *
   * @param {string} name
   * @returns {Promise<object>}
   */
  async enableProxy(name) {
    return await this.updateProxy(name, { enabled: true });
  }

  /**
   * Disables an existing proxy (taking it down).
   *
   * @param {string} name
   * @returns {Promise<object>}
   */
  async disableProxy(name) {
    return await this.updateProxy(name, { enabled: false });
  }

  /**
   * Deletes a proxy and terminates its active listener.
   *
   * @param {string} name
   * @returns {Promise<void>}
   */
  async deleteProxy(name) {
    if (!name || typeof name !== 'string') {
      throw new ToxiproxyValidationError("Proxy name must be a non-empty string", 'name', name);
    }
    await this._request('DELETE', `/proxies/${encodeURIComponent(name)}`);
  }

  // --------------------------------------------------------------------------
  // Toxic Operations
  // --------------------------------------------------------------------------

  /**
   * Lists all active toxics on a proxy.
   *
   * @param {string} proxyName
   * @returns {Promise<object[]>}
   */
  async listToxics(proxyName) {
    if (!proxyName || typeof proxyName !== 'string') {
      throw new ToxiproxyValidationError("Proxy name must be a non-empty string", 'proxyName', proxyName);
    }
    const data = await this._request('GET', `/proxies/${encodeURIComponent(proxyName)}/toxics`);
    return Array.isArray(data) ? data : [];
  }

  /**
   * Retrieves details of a specific toxic on a proxy.
   *
   * @param {string} proxyName
   * @param {string} toxicName
   * @returns {Promise<object>}
   */
  async getToxic(proxyName, toxicName) {
    if (!proxyName || typeof proxyName !== 'string') {
      throw new ToxiproxyValidationError("Proxy name must be a non-empty string", 'proxyName', proxyName);
    }
    if (!toxicName || typeof toxicName !== 'string') {
      throw new ToxiproxyValidationError("Toxic name must be a non-empty string", 'toxicName', toxicName);
    }
    return await this._request(
      'GET',
      `/proxies/${encodeURIComponent(proxyName)}/toxics/${encodeURIComponent(toxicName)}`
    );
  }

  /**
   * Creates an active toxic on a proxy.
   *
   * @param {string} proxyName
   * @param {object} toxicConfig
   * @returns {Promise<object>}
   */
  async createToxic(proxyName, toxicConfig) {
    if (!proxyName || typeof proxyName !== 'string') {
      throw new ToxiproxyValidationError("Proxy name must be a non-empty string", 'proxyName', proxyName);
    }
    return await this._request(
      'POST',
      `/proxies/${encodeURIComponent(proxyName)}/toxics`,
      toxicConfig
    );
  }

  /**
   * Updates an existing toxic on a proxy.
   *
   * @param {string} proxyName
   * @param {string} toxicName
   * @param {object} fields
   * @returns {Promise<object>}
   */
  async updateToxic(proxyName, toxicName, fields) {
    if (!proxyName || typeof proxyName !== 'string') {
      throw new ToxiproxyValidationError("Proxy name must be a non-empty string", 'proxyName', proxyName);
    }
    if (!toxicName || typeof toxicName !== 'string') {
      throw new ToxiproxyValidationError("Toxic name must be a non-empty string", 'toxicName', toxicName);
    }
    return await this._request(
      'POST',
      `/proxies/${encodeURIComponent(proxyName)}/toxics/${encodeURIComponent(toxicName)}`,
      fields
    );
  }

  /**
   * Removes a specific toxic from a proxy.
   *
   * @param {string} proxyName
   * @param {string} toxicName
   * @returns {Promise<void>}
   */
  async removeToxic(proxyName, toxicName) {
    if (!proxyName || typeof proxyName !== 'string') {
      throw new ToxiproxyValidationError("Proxy name must be a non-empty string", 'proxyName', proxyName);
    }
    if (!toxicName || typeof toxicName !== 'string') {
      throw new ToxiproxyValidationError("Toxic name must be a non-empty string", 'toxicName', toxicName);
    }
    await this._request(
      'DELETE',
      `/proxies/${encodeURIComponent(proxyName)}/toxics/${encodeURIComponent(toxicName)}`
    );
  }
}
