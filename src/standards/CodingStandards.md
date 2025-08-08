# Coding Standards for Wire EDM G-Code Viewer

This document establishes the coding standards and conventions for the Wire EDM G-Code Viewer project. All agents and developers must follow these standards to ensure consistency, maintainability, and quality.

## Table of Contents

1. [ES6 Module Patterns](#es6-module-patterns)
2. [Naming Conventions](#naming-conventions)
3. [Error Handling Patterns](#error-handling-patterns)
4. [Code Organization](#code-organization)
5. [Documentation Standards](#documentation-standards)
6. [Performance Guidelines](#performance-guidelines)
7. [Security Considerations](#security-considerations)
8. [Testing Standards](#testing-standards)

## ES6 Module Patterns

### Module Structure

#### Standard Module Template
```javascript
/**
 * Module Description
 * Brief explanation of module purpose and functionality
 */

// External imports (third-party libraries)
import thirdPartyLib from 'third-party-lib';

// Internal imports (project modules)
import { UtilityClass } from '../utils/UtilityClass.js';
import { CONSTANTS } from '../utils/Constants.js';

// Type imports (for JSDoc)
/** @typedef {import('./types').ModuleOptions} ModuleOptions */

/**
 * Main class or utility
 */
export class ModuleName {
  // Implementation
}

// Named exports
export const utilityFunction = () => {};
export { helperFunction } from './helpers.js';

// Default export (prefer named exports)
export default ModuleName;
```

#### Import/Export Conventions

**✅ Preferred Patterns:**
```javascript
// Named imports/exports (preferred)
import { SpecificFunction, AnotherFunction } from './module.js';
export { MyFunction, MyClass };

// Destructured imports for utilities
import { format, validate } from '../utils/MathUtils.js';

// Namespace imports for constants
import * as EVENTS from '../core/EventTypes.js';
```

**❌ Avoid:**
```javascript
// Avoid default imports for utilities
import MathUtils from '../utils/MathUtils.js'; // ❌

// Avoid wildcard imports except for constants
import * as Everything from './module.js'; // ❌

// Avoid mixing default and named imports
import DefaultThing, { namedThing } from './module.js'; // ❌
```

### Class Patterns

#### ES6 Class Structure
```javascript
export class ExampleClass {
  // Static properties
  static TYPE = 'example';
  static VERSION = '1.0.0';

  // Private fields (use # when browser support allows)
  #privateProperty = null;

  /**
   * Constructor with parameter validation
   */
  constructor(requiredParam, options = {}) {
    // Parameter validation
    this._validateConstructorParams(requiredParam, options);
    
    // Property initialization
    this.requiredParam = requiredParam;
    this.options = { ...this._getDefaultOptions(), ...options };
    
    // State initialization
    this.isInitialized = false;
    this.isDestroyed = false;
    
    // Bind methods
    this._bindMethods();
  }

  // Public methods
  async init() { /* Implementation */ }
  
  // Protected methods (prefix with _)
  _initializeComponents() { /* Implementation */ }
  
  // Private methods (prefix with __)
  __internalHelper() { /* Implementation */ }
  
  // Getters/Setters
  get state() { return this._state; }
  set state(value) { this._setState(value); }
  
  // Static methods
  static create(params) { /* Factory method */ }
}
```

### Utility Module Patterns

#### Static Utility Classes
```javascript
/**
 * Pure utility class - no instantiation
 */
export class UtilityClass {
  constructor() {
    throw new Error('UtilityClass is static and cannot be instantiated');
  }

  /**
   * Static method with full JSDoc
   */
  static process(input, options = {}) {
    // Validation
    UtilityClass._validateInput(input);
    
    // Processing
    return UtilityClass._performProcessing(input, options);
  }

  // Private static methods
  static _validateInput(input) { /* Implementation */ }
  static _performProcessing(input, options) { /* Implementation */ }
}

// Individual function exports
export const processData = UtilityClass.process.bind(UtilityClass);
```

## Naming Conventions

### File and Directory Names

```
src/
├── components/          # UI components (PascalCase)
│   ├── CanvasRenderer.js
│   ├── ToolbarComponent.js
│   └── SidebarPanel.js
├── core/               # Core system modules (PascalCase)
│   ├── EventManager.js
│   ├── GCodeParser.js
│   └── Viewport.js
├── utils/              # Utility modules (PascalCase)
│   ├── MathUtils.js
│   ├── FileHandler.js
│   └── Constants.js
├── styles/             # CSS files (kebab-case)
│   ├── main.css
│   ├── components.css
│   └── theme-dark.css
└── templates/          # Code templates
    ├── ComponentTemplate.js
    └── UtilityTemplate.js
```

### Variable and Function Names

```javascript
// Variables: camelCase
const userName = 'john';
const currentZoomLevel = 1.5;
const isCanvasInitialized = false;

// Functions: camelCase, descriptive verbs
function calculateDistance(x1, y1, x2, y2) {}
function handleMouseClick(event) {}
function validateUserInput(input) {}

// Boolean variables: is/has/can/should prefix
const isLoading = true;
const hasError = false;
const canEdit = true;
const shouldUpdate = false;

// Arrays: plural nouns
const points = [];
const clickedCoordinates = [];
const pathSegments = [];

// Objects: singular nouns
const viewportState = {};
const userPreferences = {};
const parseResult = {};
```

### Class and Constructor Names

```javascript
// Classes: PascalCase, descriptive nouns
class CanvasRenderer {}
class GCodeParser {}
class EventManager {}

// Abstract classes: suffix with 'Base'
class ComponentBase {}
class RendererBase {}

// Interfaces: suffix with 'Interface'
class EventManagerInterface {}
class ParserInterface {}

// Enums: PascalCase
const MouseButton = {
  LEFT: 0,
  MIDDLE: 1,
  RIGHT: 2
};
```

### Constants

```javascript
// Constants: SCREAMING_SNAKE_CASE
const MAX_ZOOM_LEVEL = 10;
const DEFAULT_GRID_SIZE = 1;
const FILE_SIZE_LIMIT = 50 * 1024 * 1024;

// Grouped constants: nested objects
const CANVAS = {
  DEFAULT_WIDTH: 800,
  DEFAULT_HEIGHT: 600,
  BACKGROUND_COLOR: '#0a0a0a'
};

const EVENT_TYPES = {
  MOUSE_CLICK: 'mouse:click',
  FILE_LOAD: 'file:load'
};
```

### CSS Class Names

```css
/* Component classes: kebab-case with component prefix */
.canvas-renderer {}
.canvas-renderer__viewport {}
.canvas-renderer__grid {}

/* State classes: is- prefix */
.is-loading {}
.is-disabled {}
.is-active {}

/* Modifier classes: double dash */
.button--primary {}
.button--large {}
.panel--collapsed {}
```

## Error Handling Patterns

### Error Creation and Throwing

```javascript
// Descriptive error messages with context
throw new Error('GCodeParser: Invalid file format - expected .gcode, .nc, or .txt');

// Custom error classes for specific types
class ValidationError extends Error {
  constructor(message, field, value) {
    super(`Validation failed for ${field}: ${message}`);
    this.name = 'ValidationError';
    this.field = field;
    this.value = value;
  }
}

// Error with additional context
function parseCoordinate(value, context = '') {
  try {
    const parsed = parseFloat(value);
    if (!isFinite(parsed)) {
      throw new Error(`Invalid coordinate value: ${value}`);
    }
    return parsed;
  } catch (error) {
    throw new Error(`Failed to parse coordinate${context ? ` in ${context}` : ''}: ${error.message}`);
  }
}
```

### Error Handling Patterns

```javascript
// Try-catch with specific error handling
async function loadFile(file) {
  try {
    const content = await readFile(file);
    return parseGCode(content);
  } catch (error) {
    if (error instanceof ValidationError) {
      // Handle validation errors
      showUserError(`Invalid file: ${error.message}`);
    } else if (error.name === 'NetworkError') {
      // Handle network errors
      showUserError('Failed to load file - check your connection');
    } else {
      // Handle unexpected errors
      console.error('Unexpected error loading file:', error);
      showUserError('An unexpected error occurred while loading the file');
    }
    throw error; // Re-throw for caller to handle
  }
}

// Promise error handling
function processDataAsync(data) {
  return Promise.resolve(data)
    .then(validateData)
    .then(transformData)
    .then(saveData)
    .catch(ValidationError, error => {
      // Handle specific error type
      console.warn('Validation failed:', error.message);
      return getDefaultData();
    })
    .catch(error => {
      // Handle any other errors
      console.error('Processing failed:', error);
      throw new Error(`Data processing failed: ${error.message}`);
    });
}
```

### Input Validation Patterns

```javascript
// Parameter validation helper
function validateRequired(value, name, type = 'any') {
  if (value === null || value === undefined) {
    throw new Error(`Parameter '${name}' is required`);
  }
  
  if (type !== 'any' && typeof value !== type) {
    throw new Error(`Parameter '${name}' must be of type ${type}, got ${typeof value}`);
  }
}

// Function with comprehensive validation
function calculateBounds(points, options = {}) {
  // Required parameter validation
  validateRequired(points, 'points', 'object');
  
  if (!Array.isArray(points)) {
    throw new Error('Parameter \'points\' must be an array');
  }
  
  if (points.length === 0) {
    throw new Error('Points array cannot be empty');
  }
  
  // Optional parameter validation
  const { margin = 0, includeOrigin = false } = options;
  
  if (typeof margin !== 'number' || margin < 0) {
    throw new Error('Option \'margin\' must be a non-negative number');
  }
  
  // Implementation...
}
```

## Code Organization

### File Structure

```javascript
/**
 * File header with module description
 */

// 1. Imports (grouped and ordered)
// External libraries first
import externalLib from 'external-lib';

// Internal imports by category
import { ComponentBase } from '../templates/ComponentTemplate.js';
import { EventBus, EVENT_TYPES } from '../core/EventManager.js';
import { CONSTANTS, THEME } from '../utils/Constants.js';
import { MathUtils } from '../utils/MathUtils.js';

// 2. Type definitions (JSDoc)
/** @typedef {Object} ComponentOptions */

// 3. Constants (module-specific)
const MODULE_CONSTANTS = {};

// 4. Main class/utility
export class ComponentName extends ComponentBase {
  // Implementation
}

// 5. Helper functions
function helperFunction() {}

// 6. Exports
export { helperFunction };
export default ComponentName;
```

### Function Organization

```javascript
class ExampleComponent {
  // 1. Static properties and methods
  static TYPE = 'example';
  static create() {}

  // 2. Constructor
  constructor() {}

  // 3. Lifecycle methods
  async init() {}
  destroy() {}

  // 4. Public API methods (alphabetical)
  addItem() {}
  clear() {}
  getState() {}
  removeItem() {}
  updateOptions() {}

  // 5. Event handlers
  handleClick() {}
  handleResize() {}

  // 6. Protected methods (alphabetical)
  _calculateDimensions() {}
  _setupEventListeners() {}
  _updateDisplay() {}

  // 7. Private methods (alphabetical)
  __formatData() {}
  __validateState() {}
}
```

## Documentation Standards

### JSDoc Comments

```javascript
/**
 * Calculate distance between two points
 * @param {number} x1 - First point X coordinate
 * @param {number} y1 - First point Y coordinate  
 * @param {number} x2 - Second point X coordinate
 * @param {number} y2 - Second point Y coordinate
 * @returns {number} Distance between points in same units as coordinates
 * @throws {Error} If any coordinate is not a finite number
 * 
 * @example
 * const dist = calculateDistance(0, 0, 3, 4);
 * console.log(dist); // 5
 * 
 * @since 1.0.0
 */
function calculateDistance(x1, y1, x2, y2) {
  // Validation
  if (!isFinite(x1) || !isFinite(y1) || !isFinite(x2) || !isFinite(y2)) {
    throw new Error('All coordinates must be finite numbers');
  }
  
  // Calculate distance using Pythagorean theorem
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * @typedef {Object} ViewportOptions
 * @property {number} [zoom=1] - Initial zoom level
 * @property {number} [offsetX=0] - Initial X offset
 * @property {number} [offsetY=0] - Initial Y offset
 * @property {boolean} [enablePan=true] - Enable pan functionality
 */

/**
 * Viewport management class
 * @class
 * @extends ComponentBase
 */
class Viewport extends ComponentBase {
  /**
   * Create viewport instance
   * @param {HTMLCanvasElement} canvas - Canvas element
   * @param {ViewportOptions} [options={}] - Configuration options
   */
  constructor(canvas, options = {}) {}
}
```

### Inline Comments

```javascript
function complexCalculation(data) {
  // Normalize input data to ensure consistent format
  const normalized = data.map(item => ({
    x: parseFloat(item.x) || 0,
    y: parseFloat(item.y) || 0
  }));

  // TODO: Optimize this loop for large datasets
  // Consider using worker thread for >10k points
  const processed = normalized.map(point => {
    // Apply coordinate transformation
    const transformed = applyTransform(point);
    
    // FIXME: This calculation occasionally returns NaN
    // Issue tracked in: https://github.com/project/issues/123
    const result = complexMath(transformed);
    
    return result;
  });

  return processed;
}
```

## Performance Guidelines

### Memory Management

```javascript
// Use WeakMap for object associations
const componentData = new WeakMap();

class Component {
  constructor(element) {
    // Store data using WeakMap to prevent memory leaks
    componentData.set(element, {
      listeners: [],
      state: {}
    });
  }

  destroy() {
    // Clean up event listeners
    const data = componentData.get(this.element);
    if (data) {
      data.listeners.forEach(cleanup => cleanup());
    }
    
    // WeakMap entries are automatically cleaned up
    // when the element is garbage collected
  }
}

// Avoid creating functions in loops
// ❌ Bad
items.forEach(item => {
  item.onClick = () => handleClick(item); // Creates new function each time
});

// ✅ Good
const handleItemClick = (item) => handleClick(item);
items.forEach(item => {
  item.onClick = () => handleItemClick(item);
});
```

### Efficient DOM Operations

```javascript
// Batch DOM operations
function updateMultipleElements(elements, newClass) {
  // Use DocumentFragment for multiple insertions
  const fragment = document.createDocumentFragment();
  
  elements.forEach(element => {
    const clone = element.cloneNode(true);
    clone.className = newClass;
    fragment.appendChild(clone);
  });
  
  // Single DOM update
  container.appendChild(fragment);
}

// Use requestAnimationFrame for animations
function smoothUpdate() {
  let isUpdateScheduled = false;
  
  return function update() {
    if (!isUpdateScheduled) {
      isUpdateScheduled = true;
      requestAnimationFrame(() => {
        performUpdate();
        isUpdateScheduled = false;
      });
    }
  };
}
```

## Security Considerations

### Input Sanitization

```javascript
// Sanitize file content
function sanitizeGCodeContent(content) {
  if (typeof content !== 'string') {
    throw new Error('Content must be a string');
  }
  
  // Remove potentially dangerous characters
  const sanitized = content
    .replace(/[<>]/g, '') // Remove HTML-like characters
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .trim();
  
  return sanitized;
}

// Validate file types
function validateFileType(file) {
  const allowedTypes = ['.gcode', '.nc', '.txt'];
  const allowedMimeTypes = ['text/plain', 'application/octet-stream'];
  
  const extension = file.name.toLowerCase().split('.').pop();
  
  if (!allowedTypes.includes(`.${extension}`)) {
    throw new Error(`Unsupported file type: .${extension}`);
  }
  
  if (!allowedMimeTypes.includes(file.type)) {
    console.warn(`Unexpected MIME type: ${file.type}`);
  }
}
```

### XSS Prevention

```javascript
// Safe DOM content insertion
function safeSetTextContent(element, text) {
  // Always use textContent for user data
  element.textContent = text;
  
  // Never use innerHTML with user data
  // element.innerHTML = text; // ❌ Dangerous
}

// Safe HTML template creation
function createSafeHTML(template, data) {
  // Use template literals with escaped values
  const escaped = Object.keys(data).reduce((acc, key) => {
    acc[key] = escapeHTML(data[key]);
    return acc;
  }, {});
  
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return escaped[key] || '';
  });
}

function escapeHTML(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
```

## Testing Standards

### Unit Test Structure

```javascript
// test/utils/MathUtils.test.js
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { MeasurementUtils } from '../../src/utils/MathUtils.js';

describe('MeasurementUtils', () => {
  describe('distance', () => {
    test('should calculate distance between two points', () => {
      const result = MeasurementUtils.distance(0, 0, 3, 4);
      expect(result).toBe(5);
    });

    test('should handle negative coordinates', () => {
      const result = MeasurementUtils.distance(-1, -1, 2, 3);
      expect(result).toBe(5);
    });

    test('should throw error for invalid coordinates', () => {
      expect(() => {
        MeasurementUtils.distance(NaN, 0, 1, 1);
      }).toThrow('Invalid coordinate');
    });
  });
});
```

### Integration Test Patterns

```javascript
// test/integration/FileLoading.test.js
import { describe, test, expect, beforeEach } from 'vitest';
import { FileHandler } from '../../src/utils/FileHandler.js';
import { GCodeParser } from '../../src/core/GCodeParser.js';

describe('File Loading Integration', () => {
  let fileHandler;
  let parser;

  beforeEach(() => {
    fileHandler = new FileHandler();
    parser = new GCodeParser();
  });

  test('should load and parse valid G-code file', async () => {
    const mockFile = new File(['G0 X10 Y20'], 'test.gcode', {
      type: 'text/plain'
    });

    const content = await fileHandler.readFile(mockFile);
    const result = parser.parse(content);

    expect(result.path).toHaveLength(1);
    expect(result.path[0]).toMatchObject({
      type: 'rapid',
      x: 10,
      y: 20
    });
  });
});
```

## Code Quality Checklist

Before submitting code, ensure:

### ✅ Code Quality
- [ ] Follows naming conventions
- [ ] Has proper error handling
- [ ] Includes comprehensive JSDoc documentation
- [ ] Uses consistent formatting
- [ ] No console.log statements (use proper logging)
- [ ] No magic numbers (use named constants)

### ✅ Performance
- [ ] No memory leaks (event listeners cleaned up)
- [ ] Efficient DOM operations
- [ ] Proper use of async/await
- [ ] No blocking operations on main thread

### ✅ Security
- [ ] Input validation for all public methods
- [ ] Safe DOM manipulation
- [ ] No XSS vulnerabilities
- [ ] File type validation

### ✅ Testing
- [ ] Unit tests for all public methods
- [ ] Integration tests for complex interactions
- [ ] Edge cases covered
- [ ] Error conditions tested

### ✅ Documentation
- [ ] README updated if needed
- [ ] API documentation complete
- [ ] Examples provided
- [ ] Migration notes for breaking changes

---

**Remember**: These standards ensure code quality, maintainability, and team collaboration. When in doubt, prefer clarity and consistency over cleverness.