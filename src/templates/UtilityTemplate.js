/**
 * Utility Template - Base Pattern for Utility Modules
 * 
 * This template provides a standard pattern for creating utility modules in the Wire EDM G-Code Viewer.
 * Utility modules should be stateless and provide reusable functions.
 * 
 * USAGE:
 * 1. Copy this template for new utility modules
 * 2. Replace 'UtilityTemplate' with your utility name
 * 3. Implement static methods for functionality
 * 4. Export individual functions or the entire class
 * 
 * PATTERNS:
 * - Static methods for stateless utilities
 * - Input validation for all public methods
 * - Consistent error handling
 * - JSDoc documentation for all methods
 * - Pure functions where possible
 */

// Import required modules
import { ValidationUtils, PrecisionUtils } from '../utils/MathUtils.js';
import { DEBUG } from '../utils/Constants.js';

/**
 * UtilityTemplate - Template for creating utility modules
 * 
 * @example
 * const result = UtilityTemplate.processData(inputData);
 * const validated = UtilityTemplate.validateInput(userInput);
 */
export class UtilityTemplate {
  /**
   * Private constructor to prevent instantiation
   * Utility classes should only have static methods
   */
  constructor() {
    throw new Error('UtilityTemplate is a static utility class and cannot be instantiated');
  }

  /**
   * Example utility method - Process data
   * @param {*} data - Input data to process
   * @param {Object} options - Processing options
   * @returns {*} Processed data
   * @throws {Error} If input data is invalid
   * 
   * @example
   * const processed = UtilityTemplate.processData(rawData, { normalize: true });
   */
  static processData(data, options = {}) {
    // Input validation
    if (data === null || data === undefined) {
      throw new Error('UtilityTemplate.processData: data cannot be null or undefined');
    }

    // Merge with default options
    const defaultOptions = {
      normalize: false,
      precision: 3,
      validate: true
    };
    const config = { ...defaultOptions, ...options };

    try {
      // Debug logging
      if (DEBUG.ENABLED) {
        console.log('UtilityTemplate.processData:', { data, config });
      }

      // Validation step
      if (config.validate) {
        UtilityTemplate._validateData(data);
      }

      // Processing logic
      let result = UtilityTemplate._performProcessing(data, config);

      // Normalization step
      if (config.normalize) {
        result = UtilityTemplate._normalizeResult(result);
      }

      // Precision formatting
      if (typeof result === 'number') {
        result = PrecisionUtils.round(result, config.precision);
      }

      return result;
    } catch (error) {
      // Enhanced error with context
      throw new Error(`UtilityTemplate.processData failed: ${error.message}`);
    }
  }

  /**
   * Example validation method
   * @param {*} input - Input to validate
   * @returns {boolean} True if valid
   * 
   * @example
   * if (UtilityTemplate.isValid(userInput)) {
   *   // Process input
   * }
   */
  static isValid(input) {
    try {
      UtilityTemplate._validateData(input);
      return true;
    } catch (error) {
      if (DEBUG.ENABLED) {
        console.warn('UtilityTemplate.isValid: validation failed:', error.message);
      }
      return false;
    }
  }

  /**
   * Example formatting method
   * @param {*} value - Value to format
   * @param {string} format - Format type ('string', 'number', 'coordinate')
   * @returns {string} Formatted value
   * 
   * @example
   * const formatted = UtilityTemplate.format(3.14159, 'coordinate');
   */
  static format(value, format = 'string') {
    if (value === null || value === undefined) {
      return '';
    }

    switch (format) {
      case 'number':
        return UtilityTemplate._formatNumber(value);
      
      case 'coordinate':
        return UtilityTemplate._formatCoordinate(value);
      
      case 'string':
      default:
        return String(value);
    }
  }

  /**
   * Example helper method - Deep clone object
   * @param {Object} obj - Object to clone
   * @returns {Object} Deep cloned object
   * 
   * @example
   * const cloned = UtilityTemplate.deepClone(originalObject);
   */
  static deepClone(obj) {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }

    if (obj instanceof Date) {
      return new Date(obj.getTime());
    }

    if (obj instanceof Array) {
      return obj.map(item => UtilityTemplate.deepClone(item));
    }

    const cloned = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        cloned[key] = UtilityTemplate.deepClone(obj[key]);
      }
    }

    return cloned;
  }

  /**
   * Example helper method - Create safe object path
   * @param {Object} obj - Object to access
   * @param {string} path - Dot notation path (e.g., 'user.profile.name')
   * @param {*} defaultValue - Default value if path doesn't exist
   * @returns {*} Value at path or default value
   * 
   * @example
   * const name = UtilityTemplate.safeGet(user, 'profile.name', 'Unknown');
   */
  static safeGet(obj, path, defaultValue = undefined) {
    if (!obj || typeof obj !== 'object' || !path) {
      return defaultValue;
    }

    const keys = path.split('.');
    let current = obj;

    for (const key of keys) {
      if (current === null || current === undefined || !current.hasOwnProperty(key)) {
        return defaultValue;
      }
      current = current[key];
    }

    return current;
  }

  /**
   * Example helper method - Throttle function execution
   * @param {Function} func - Function to throttle
   * @param {number} limit - Time limit in milliseconds
   * @returns {Function} Throttled function
   * 
   * @example
   * const throttledHandler = UtilityTemplate.throttle(handleResize, 100);
   */
  static throttle(func, limit) {
    if (typeof func !== 'function') {
      throw new Error('UtilityTemplate.throttle: func must be a function');
    }

    if (typeof limit !== 'number' || limit < 0) {
      throw new Error('UtilityTemplate.throttle: limit must be a positive number');
    }

    let inThrottle;
    
    return function(...args) {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        
        setTimeout(() => {
          inThrottle = false;
        }, limit);
      }
    };
  }

  /**
   * Example helper method - Debounce function execution
   * @param {Function} func - Function to debounce
   * @param {number} delay - Delay in milliseconds
   * @returns {Function} Debounced function
   * 
   * @example
   * const debouncedSearch = UtilityTemplate.debounce(performSearch, 300);
   */
  static debounce(func, delay) {
    if (typeof func !== 'function') {
      throw new Error('UtilityTemplate.debounce: func must be a function');
    }

    if (typeof delay !== 'number' || delay < 0) {
      throw new Error('UtilityTemplate.debounce: delay must be a positive number');
    }

    let timeoutId;
    
    return function(...args) {
      clearTimeout(timeoutId);
      
      timeoutId = setTimeout(() => {
        func.apply(this, args);
      }, delay);
    };
  }

  // ==========================================
  // PRIVATE HELPER METHODS
  // ==========================================

  /**
   * Validate input data
   * @param {*} data - Data to validate
   * @throws {Error} If data is invalid
   * @private
   */
  static _validateData(data) {
    // Implement validation logic based on your utility's requirements
    if (typeof data === 'object' && data !== null) {
      // Object validation
      if (Array.isArray(data) && data.length === 0) {
        throw new Error('Data array cannot be empty');
      }
    } else if (typeof data === 'string') {
      // String validation
      if (data.trim().length === 0) {
        throw new Error('Data string cannot be empty');
      }
    } else if (typeof data === 'number') {
      // Number validation
      if (!ValidationUtils.isValidCoordinate(data)) {
        throw new Error('Data number must be finite');
      }
    }
  }

  /**
   * Perform the main processing logic
   * @param {*} data - Input data
   * @param {Object} config - Configuration options
   * @returns {*} Processed result
   * @private
   */
  static _performProcessing(data, config) {
    // Implement your processing logic here
    // This is where the main utility work happens
    
    // Example: simple data transformation
    if (Array.isArray(data)) {
      return data.map(item => UtilityTemplate._processItem(item, config));
    }
    
    return UtilityTemplate._processItem(data, config);
  }

  /**
   * Process individual item
   * @param {*} item - Item to process
   * @param {Object} config - Configuration options
   * @returns {*} Processed item
   * @private
   */
  static _processItem(item, config) {
    // Example processing logic
    if (typeof item === 'number') {
      return item * (config.multiplier || 1);
    }
    
    if (typeof item === 'string') {
      return config.normalize ? item.toLowerCase().trim() : item;
    }
    
    return item;
  }

  /**
   * Normalize result data
   * @param {*} result - Result to normalize
   * @returns {*} Normalized result
   * @private
   */
  static _normalizeResult(result) {
    // Implement normalization logic
    if (Array.isArray(result)) {
      // Normalize array (e.g., remove duplicates, sort)
      return [...new Set(result)].sort();
    }
    
    if (typeof result === 'string') {
      return result.toLowerCase().trim();
    }
    
    return result;
  }

  /**
   * Format number for display
   * @param {number} value - Number to format
   * @returns {string} Formatted number
   * @private
   */
  static _formatNumber(value) {
    if (!ValidationUtils.isValidCoordinate(value)) {
      return 'Invalid';
    }
    
    return PrecisionUtils.format(value);
  }

  /**
   * Format coordinate for display
   * @param {number} value - Coordinate to format
   * @returns {string} Formatted coordinate
   * @private
   */
  static _formatCoordinate(value) {
    if (!ValidationUtils.isValidCoordinate(value)) {
      return '0.000';
    }
    
    return PrecisionUtils.format(value, 3);
  }
}

// Export individual functions for convenience
export const processData = UtilityTemplate.processData.bind(UtilityTemplate);
export const isValid = UtilityTemplate.isValid.bind(UtilityTemplate);
export const format = UtilityTemplate.format.bind(UtilityTemplate);
export const deepClone = UtilityTemplate.deepClone.bind(UtilityTemplate);
export const safeGet = UtilityTemplate.safeGet.bind(UtilityTemplate);
export const throttle = UtilityTemplate.throttle.bind(UtilityTemplate);
export const debounce = UtilityTemplate.debounce.bind(UtilityTemplate);

export default UtilityTemplate;