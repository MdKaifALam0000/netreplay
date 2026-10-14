/**
 * NetReplay Toxiproxy Error Hierarchy
 *
 * Provides strongly-typed, actionable error classes for the Toxiproxy client
 * and adapter layers, ensuring clean error categorization without leaking secrets.
 */

/**
 * Base error class for all Toxiproxy-related operations.
 */
export class ToxiproxyError extends Error {
  /**
   * @param {string} message
   * @param {object} [options={}]
   * @param {Error} [options.cause]
   */
  constructor(message, options = {}) {
    super(message, options);
    this.name = this.constructor.name;
    if (options.cause) {
      this.cause = options.cause;
    }
  }
}

/**
 * Thrown when fault or proxy configuration fails schema validation.
 */
export class ToxiproxyValidationError extends ToxiproxyError {
  /**
   * @param {string} message
   * @param {string} [field]
   * @param {any} [receivedValue]
   */
  constructor(message, field = null, receivedValue = undefined) {
    super(message);
    this.field = field;
    this.receivedValue = receivedValue;
  }
}

/**
 * Thrown when the Toxiproxy control API returns a non-2xx HTTP status.
 */
export class ToxiproxyHttpError extends ToxiproxyError {
  /**
   * @param {string} message
   * @param {number} status
   * @param {string} [statusText='']
   * @param {string} [responseBody='']
   * @param {string} [endpoint='']
   */
  constructor(message, status, statusText = '', responseBody = '', endpoint = '') {
    super(message);
    this.status = status;
    this.statusText = statusText;
    this.responseBody = responseBody;
    this.endpoint = endpoint;
  }
}

/**
 * Thrown when a requested proxy or toxic is not found (HTTP 404).
 */
export class ToxiproxyNotFoundError extends ToxiproxyHttpError {
  /**
   * @param {string} message
   * @param {string} [resourceName='']
   * @param {string} [endpoint='']
   */
  constructor(message, resourceName = '', endpoint = '') {
    super(message, 404, 'Not Found', '', endpoint);
    this.resourceName = resourceName;
  }
}

/**
 * Thrown when attempting to create a proxy or toxic that already exists (HTTP 409).
 */
export class ToxiproxyConflictError extends ToxiproxyHttpError {
  /**
   * @param {string} message
   * @param {string} [resourceName='']
   * @param {string} [endpoint='']
   */
  constructor(message, resourceName = '', endpoint = '') {
    super(message, 409, 'Conflict', '', endpoint);
    this.resourceName = resourceName;
  }
}

/**
 * Thrown when network connection to the Toxiproxy control API fails.
 */
export class ToxiproxyConnectionError extends ToxiproxyError {
  /**
   * @param {string} message
   * @param {string} [url='']
   * @param {Error} [cause]
   */
  constructor(message, url = '', cause = null) {
    super(message, cause ? { cause } : {});
    this.url = url;
  }
}

/**
 * Thrown when a request to the Toxiproxy control API times out.
 */
export class ToxiproxyTimeoutError extends ToxiproxyError {
  /**
   * @param {string} message
   * @param {number} [timeoutMs=0]
   * @param {string} [url='']
   */
  constructor(message, timeoutMs = 0, url = '') {
    super(message);
    this.timeoutMs = timeoutMs;
    this.url = url;
  }
}

/**
 * Represents a failure that occurred during automatic fault cleanup.
 * Preserves the original experiment error while detailing cleanup failure.
 */
export class ToxiproxyCleanupError extends ToxiproxyError {
  /**
   * @param {string} message
   * @param {Error} [originalError]
   * @param {Error} [cleanupError]
   */
  constructor(message, originalError = null, cleanupError = null) {
    super(message);
    this.originalError = originalError;
    this.cleanupError = cleanupError;
  }
}
