/**
 * NetReplay Fault and Proxy Configuration Validation
 *
 * Implements strict schema validation for internal NetReplay fault specifications
 * and translates validated configurations into Toxiproxy toxic schemas.
 */

import { ToxiproxyValidationError } from './errors.js';

// Configuration bounds
export const BOUNDS = Object.freeze({
  LATENCY_MIN_MS: 0,
  LATENCY_MAX_MS: 60000,
  JITTER_MIN_MS: 0,
  JITTER_MAX_MS: 30000,
  TIMEOUT_MIN_MS: 0,
  TIMEOUT_MAX_MS: 60000,
  RATE_MIN_KBPS: 1,
  RATE_MAX_KBPS: 1000000, // 1 GB/s safe ceiling
  TOXICITY_MIN: 0.0,
  TOXICITY_MAX: 1.0,
});

export const VALID_STREAMS = Object.freeze(['upstream', 'downstream']);
export const VALID_FAULT_TYPES = Object.freeze(['latency', 'timeout', 'bandwidth', 'reset', 'reset_peer']);

/**
 * Validates that a value is a strict integer within [min, max].
 *
 * @param {any} val
 * @param {string} field
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function assertIntegerRange(val, field, min, max) {
  if (typeof val !== 'number' || !Number.isInteger(val)) {
    throw new ToxiproxyValidationError(
      `Field '${field}' must be an integer, received: ${typeof val} (${val})`,
      field,
      val
    );
  }
  if (val < min || val > max) {
    throw new ToxiproxyValidationError(
      `Field '${field}' must be between ${min} and ${max}, received: ${val}`,
      field,
      val
    );
  }
  return val;
}

/**
 * Validates toxicity (float between 0 and 1).
 *
 * @param {any} val
 * @returns {number}
 */
function assertToxicity(val) {
  if (val === undefined || val === null) {
    return 1.0;
  }
  if (typeof val !== 'number' || Number.isNaN(val)) {
    throw new ToxiproxyValidationError(
      `Field 'toxicity' must be a number between 0 and 1, received: ${typeof val} (${val})`,
      'toxicity',
      val
    );
  }
  if (val < BOUNDS.TOXICITY_MIN || val > BOUNDS.TOXICITY_MAX) {
    throw new ToxiproxyValidationError(
      `Field 'toxicity' must be between ${BOUNDS.TOXICITY_MIN} and ${BOUNDS.TOXICITY_MAX}, received: ${val}`,
      'toxicity',
      val
    );
  }
  return val;
}

/**
 * Validates stream direction.
 *
 * @param {any} val
 * @returns {'upstream' | 'downstream'}
 */
function assertStream(val) {
  if (val === undefined || val === null) {
    return 'downstream';
  }
  if (typeof val !== 'string' || !VALID_STREAMS.includes(val.toLowerCase())) {
    throw new ToxiproxyValidationError(
      `Field 'stream' must be 'upstream' or 'downstream', received: '${val}'`,
      'stream',
      val
    );
  }
  return val.toLowerCase();
}

/**
 * Validates that no unrecognized keys are present in an object.
 *
 * @param {object} obj
 * @param {string[]} allowedKeys
 * @param {string} contextName
 */
function assertNoUnexpectedKeys(obj, allowedKeys, contextName) {
  const allowedSet = new Set(allowedKeys);
  const actualKeys = Object.keys(obj);
  for (const key of actualKeys) {
    if (!allowedSet.has(key)) {
      throw new ToxiproxyValidationError(
        `Unexpected field '${key}' in ${contextName}. Allowed fields: ${allowedKeys.join(', ')}`,
        key,
        obj[key]
      );
    }
  }
}

/**
 * Validates a proxy configuration object.
 *
 * @param {object} config
 * @returns {{ name: string, listen: string, upstream: string, enabled: boolean }}
 */
export function validateProxyConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new ToxiproxyValidationError('Proxy configuration must be a non-null object', 'config', config);
  }

  assertNoUnexpectedKeys(config, ['name', 'listen', 'upstream', 'enabled'], 'proxy configuration');

  if (typeof config.name !== 'string' || config.name.trim().length === 0) {
    throw new ToxiproxyValidationError("Proxy 'name' must be a non-empty string", 'name', config.name);
  }

  if (typeof config.listen !== 'string' || config.listen.trim().length === 0) {
    throw new ToxiproxyValidationError("Proxy 'listen' address must be a non-empty string", 'listen', config.listen);
  }

  if (typeof config.upstream !== 'string' || config.upstream.trim().length === 0) {
    throw new ToxiproxyValidationError("Proxy 'upstream' address must be a non-empty string", 'upstream', config.upstream);
  }

  const enabled = config.enabled !== undefined ? Boolean(config.enabled) : true;

  return {
    name: config.name.trim(),
    listen: config.listen.trim(),
    upstream: config.upstream.trim(),
    enabled,
  };
}

/**
 * Validates an internal NetReplay fault configuration and translates it into
 * the corresponding Toxiproxy toxic API schema.
 *
 * @param {object} faultConfig
 * @returns {{
 *   name: string,
 *   type: string,
 *   stream: string,
 *   toxicity: number,
 *   attributes: object
 * }}
 */
export function validateAndMapFault(faultConfig) {
  if (!faultConfig || typeof faultConfig !== 'object' || Array.isArray(faultConfig)) {
    throw new ToxiproxyValidationError('Fault configuration must be a non-null object', 'faultConfig', faultConfig);
  }

  if (typeof faultConfig.type !== 'string') {
    throw new ToxiproxyValidationError("Fault configuration must include a string 'type'", 'type', faultConfig.type);
  }

  const type = faultConfig.type.toLowerCase();
  const stream = assertStream(faultConfig.stream);
  const toxicity = assertToxicity(faultConfig.toxicity);

  let toxicName = faultConfig.name;
  if (toxicName !== undefined && (typeof toxicName !== 'string' || toxicName.trim().length === 0)) {
    throw new ToxiproxyValidationError("Toxic 'name', if provided, must be a non-empty string", 'name', toxicName);
  }

  switch (type) {
    case 'latency': {
      assertNoUnexpectedKeys(
        faultConfig,
        ['type', 'name', 'stream', 'toxicity', 'latencyMs', 'jitterMs'],
        'latency fault'
      );

      const latencyMs = assertIntegerRange(
        faultConfig.latencyMs,
        'latencyMs',
        BOUNDS.LATENCY_MIN_MS,
        BOUNDS.LATENCY_MAX_MS
      );

      const jitterMs = faultConfig.jitterMs !== undefined
        ? assertIntegerRange(faultConfig.jitterMs, 'jitterMs', BOUNDS.JITTER_MIN_MS, BOUNDS.JITTER_MAX_MS)
        : 0;

      return {
        name: toxicName || `latency_${stream}`,
        type: 'latency',
        stream,
        toxicity,
        attributes: {
          latency: latencyMs,
          jitter: jitterMs,
        },
      };
    }

    case 'timeout': {
      assertNoUnexpectedKeys(
        faultConfig,
        ['type', 'name', 'stream', 'toxicity', 'timeoutMs'],
        'timeout fault'
      );

      const timeoutMs = assertIntegerRange(
        faultConfig.timeoutMs,
        'timeoutMs',
        BOUNDS.TIMEOUT_MIN_MS,
        BOUNDS.TIMEOUT_MAX_MS
      );

      return {
        name: toxicName || `timeout_${stream}`,
        type: 'timeout',
        stream,
        toxicity,
        attributes: {
          timeout: timeoutMs,
        },
      };
    }

    case 'bandwidth': {
      assertNoUnexpectedKeys(
        faultConfig,
        ['type', 'name', 'stream', 'toxicity', 'rateKbps'],
        'bandwidth fault'
      );

      const rateKbps = assertIntegerRange(
        faultConfig.rateKbps,
        'rateKbps',
        BOUNDS.RATE_MIN_KBPS,
        BOUNDS.RATE_MAX_KBPS
      );

      return {
        name: toxicName || `bandwidth_${stream}`,
        type: 'bandwidth',
        stream,
        toxicity,
        attributes: {
          rate: rateKbps,
        },
      };
    }

    case 'reset':
    case 'reset_peer': {
      assertNoUnexpectedKeys(
        faultConfig,
        ['type', 'name', 'stream', 'toxicity'],
        'reset fault'
      );

      return {
        name: toxicName || `reset_${stream}`,
        type: 'reset_peer',
        stream,
        toxicity,
        attributes: {},
      };
    }

    default:
      throw new ToxiproxyValidationError(
        `Unsupported fault type '${faultConfig.type}'. Supported types: latency, timeout, bandwidth, reset`,
        'type',
        faultConfig.type
      );
  }
}
