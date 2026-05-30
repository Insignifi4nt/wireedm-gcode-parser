/**
 * EmitControls - helpers to manage emission frequency and duplication
 */

/**
 * Throttle event emissions
 * @param {Function} emitFunction - Function to throttle
 * @param {number} delay - Delay in milliseconds
 * @returns {Function} Throttled function
 */
export function throttle(emitFunction, delay) {
  if (typeof emitFunction !== 'function') {
    throw new Error('First argument must be a function');
  }

  if (typeof delay !== 'number' || delay < 0) {
    throw new Error('Delay must be a non-negative number');
  }

  let isThrottled = false;
  let lastArgs = null;

  return function throttledFunction(...args) {
    if (!isThrottled) {
      // Execute immediately
      emitFunction.apply(this, args);
      isThrottled = true;

      setTimeout(() => {
        isThrottled = false;

        // Execute with latest args if there were subsequent calls
        if (lastArgs) {
          emitFunction.apply(this, lastArgs);
          lastArgs = null;
        }
      }, delay);
    } else {
      // Store latest args
      lastArgs = args;
    }
  };
}

/**
 * Debounce event emissions
 * @param {Function} emitFunction - Function to debounce
 * @param {number} delay - Delay in milliseconds
 * @returns {Function} Debounced function
 */
export function debounce(emitFunction, delay) {
  if (typeof emitFunction !== 'function') {
    throw new Error('First argument must be a function');
  }

  if (typeof delay !== 'number' || delay < 0) {
    throw new Error('Delay must be a non-negative number');
  }

  let timeoutId = null;

  return function debouncedFunction(...args) {
    // Clear existing timeout
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    // Set new timeout
    timeoutId = setTimeout(() => {
      emitFunction.apply(this, args);
      timeoutId = null;
    }, delay);
  };
}

/**
 * Create a rate-limited emitter
 * @param {Function} emitFunction - Function to rate limit
 * @param {number} maxCalls - Maximum calls per period
 * @param {number} period - Time period in milliseconds
 * @returns {Function} Rate-limited function
 */
export function rateLimit(emitFunction, maxCalls, period) {
  if (typeof emitFunction !== 'function') {
    throw new Error('First argument must be a function');
  }

  const calls = [];

  return function rateLimitedFunction(...args) {
    const now = Date.now();

    // Remove old calls outside the period
    while (calls.length > 0 && calls[0] <= now - period) {
      calls.shift();
    }

    // Check if we're under the limit
    if (calls.length < maxCalls) {
      calls.push(now);
      return emitFunction.apply(this, args);
    }

    // Rate limit exceeded - could emit a warning event here
    console.debug(`Rate limit exceeded: ${maxCalls} calls per ${period}ms`);
  };
}

/**
 * Prevent duplicate rapid events
 * @param {Function} emitFunction - Function to deduplicate
 * @param {number} threshold - Time threshold in milliseconds
 * @param {Function} keyExtractor - Function to extract comparison key from args
 * @returns {Function} Deduplicated function
 */
export function deduplicate(emitFunction, threshold = 50, keyExtractor = null) {
  if (typeof emitFunction !== 'function') {
    throw new Error('First argument must be a function');
  }

  const lastCalls = new Map();

  return function deduplicatedFunction(...args) {
    const now = Date.now();
    const key = keyExtractor ? keyExtractor(...args) : JSON.stringify(args);
    const lastCall = lastCalls.get(key);

    if (!lastCall || now - lastCall > threshold) {
      lastCalls.set(key, now);

      // Clean up old entries periodically
      if (lastCalls.size > 100) {
        for (const [k, time] of lastCalls.entries()) {
          if (now - time > threshold * 2) {
            lastCalls.delete(k);
          }
        }
      }

      return emitFunction.apply(this, args);
    }
  };
}

