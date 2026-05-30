# Coding Standards for Wire EDM G-Code Viewer

This document establishes practical coding standards based on our actual codebase patterns. These standards ensure consistency and maintainability while remaining achievable and realistic.

## File Organization

### Naming Conventions

**Files**: PascalCase with descriptive names
```
src/components/Canvas.js
src/core/EventManager.js  
src/utils/MathUtils.js
```

**Classes**: PascalCase
```javascript
export class GCodeParser {}
export class FileHandler {}
export class EventBus {}
```

**Methods**: camelCase
```javascript
calculateDistance()
handleClick()
updateDisplay()
```

**Private Methods**: Underscore prefix
```javascript
_bindMethods()
_setupEventListeners()
_validateInput()
```

**Constants**: SCREAMING_SNAKE_CASE
```javascript
const VIEWPORT = {};
const EVENT_TYPES = {};
```

### Import Organization

Group imports in this order:
1. Core modules
2. Components  
3. Utilities

**Good Example** (from main.js):
```javascript
// Core imports
import { EventBus, EVENT_TYPES } from './core/EventManager.js';
import { GCodeParser } from './core/GCodeParser.js';

// Component imports
import { Canvas } from './components/Canvas.js';
import { Toolbar } from './components/Toolbar.js';

// Utility imports
import { FileHandler } from './utils/FileHandler.js';
import { CANVAS, GRID } from './utils/Constants.js';
```

Use destructured imports for better tree-shaking:
```javascript
// ✅ Good
import { EventBus, EVENT_TYPES } from '../core/EventManager.js';
import { VIEWPORT } from '../utils/Constants.js';

// ❌ Avoid
import * as Events from '../core/EventManager.js';
```

## Class Structure

### Standard Component Pattern

**To create a new component:** Copy `src/components/Canvas.js` or `src/components/Toolbar.js` and modify.

**Key pattern from working components:**

```javascript
/**
 * ComponentName - Brief description
 * Purpose and key responsibilities
 */
import { EventBus, EVENT_TYPES } from '../core/EventManager.js';
import { CONSTANTS } from '../utils/Constants.js';

export class ComponentName {
  constructor(container, options = {}) {
    // Basic validation
    if (!container) {
      throw new Error('ComponentName requires a container element');
    }

    // Store references
    this.container = container;
    this.eventBus = EventBus.getInstance();
    
    // Merge options with defaults
    this.options = {
      enabled: true,
      autoInit: false,
      ...options
    };

    // Component state
    this.isInitialized = false;
    this.state = {};

    // Bind methods for event handling
    this._bindMethods();
  }

  // Public methods
  init() {
    if (this.isInitialized) return;
    
    try {
      this._setupDOM();
      this._setupEventListeners();
      this.isInitialized = true;
    } catch (error) {
      throw new Error(`Failed to initialize ${this.constructor.name}: ${error.message}`);
    }
  }

  // Private methods
  _bindMethods() {
    this.handleClick = this.handleClick.bind(this);
    this.handleResize = this.handleResize.bind(this);
  }

  _setupDOM() {
    // DOM setup logic
  }

  _setupEventListeners() {
    // Event listener setup
  }
}
```

### Utility Class Pattern

**To create utilities:** Copy `src/utils/MathUtils.js` structure and modify.

**Key pattern from MathUtils.js:**

```javascript
/**
 * UtilityName - Static utility functions
 * Specific purpose description
 */
export class UtilityName {
  /**
   * Process data
   * @param {*} data - Input data
   * @param {Object} options - Processing options  
   * @returns {*} Processed result
   */
  static processData(data, options = {}) {
    // Input validation
    if (!data) {
      throw new Error('Data is required');
    }

    // Merge with defaults
    const config = { precision: 3, ...options };

    // Processing logic
    return UtilityName._performProcessing(data, config);
  }

  // Private helper methods
  static _performProcessing(data, config) {
    // Implementation
  }
}
```

## Error Handling

Keep error handling simple and practical:

### Basic Validation
```javascript
// ✅ Simple and clear
if (!input) {
  throw new Error('Input is required');
}

if (typeof value !== 'number') {
  throw new Error('Value must be a number');
}
```

### Contextual Error Messages
```javascript
// ✅ Provides context
throw new Error('Canvas requires a valid HTMLCanvasElement');
throw new Error(`Failed to parse G-Code: ${error.message}`);
```

### No Custom Error Classes
Keep it simple - use built-in `Error` class:

```javascript
// ✅ Simple
throw new Error('Validation failed');

// ❌ Overengineered
throw new ValidationError('Validation failed', field, value);
```

## Documentation Standards

### JSDoc Usage

Document constructor parameters and key public methods:

```javascript
/**
 * Calculate distance between two points
 * @param {number} x1 - First point X coordinate
 * @param {number} y1 - First point Y coordinate  
 * @param {number} x2 - Second point X coordinate
 * @param {number} y2 - Second point Y coordinate
 * @returns {number} Distance between points
 */
static distance(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}
```

Keep documentation moderate - focus on clarity over completeness:
- Document constructor parameters
- Document public method parameters and return values  
- Skip obvious getters/setters
- No need for @since, @author, or extensive @example blocks

## Options Pattern

Use consistent options handling across components:

```javascript
constructor(required, options = {}) {
  // Default options
  const defaultOptions = {
    enabled: true,
    showGrid: true,
    precision: 3
  };

  // Merge with defaults using spread operator
  this.options = { ...defaultOptions, ...options };
}
```

## Event Integration

Follow the established EventBus pattern:

```javascript
// Get singleton instance
this.eventBus = EventBus.getInstance();

// Listen to events
this.eventBus.on(EVENT_TYPES.MOUSE_CLICK, this.handleClick);

// Emit events
this.eventBus.emit(EVENT_TYPES.VIEWPORT_CHANGE, { zoom: this.zoom });
```

## State Management

Keep component state simple and explicit:

```javascript
// Component state
this.state = {
  initialized: false,
  currentFile: null,
  zoomLevel: 1
};

// Update state
this.state.zoomLevel = newZoom;
```

## Method Binding

Use consistent method binding pattern:

```javascript
_bindMethods() {
  this.handleClick = this.handleClick.bind(this);
  this.handleResize = this.handleResize.bind(this);
  this._onFileLoad = this._onFileLoad.bind(this);
}
```

## What to Avoid

### Over-Engineering
- ❌ Private `#` fields (use underscore convention)
- ❌ Complex inheritance hierarchies
- ❌ Custom error classes for simple cases
- ❌ Extensive validation for internal methods
- ❌ Over-documented code with excessive JSDoc

### Complex Patterns  
- ❌ Abstract base classes when not needed
- ❌ Factory patterns for simple instantiation
- ❌ Complex event delegation when simple binding works
- ❌ Extensive type checking in JavaScript

## Code Quality Checklist

Before submitting code:

### ✅ Consistency
- [ ] File naming follows PascalCase convention
- [ ] Import organization follows grouping rules
- [ ] Method names use camelCase
- [ ] Private methods use underscore prefix

### ✅ Functionality  
- [ ] Basic input validation for public methods
- [ ] Error messages provide helpful context
- [ ] Event listeners are properly bound
- [ ] Resources are cleaned up in destroy methods

### ✅ Documentation
- [ ] Constructor parameters documented
- [ ] Key public methods have JSDoc
- [ ] Complex logic has inline comments
- [ ] Error conditions are documented

## Why No Templates?

This project uses **living code as templates**. Instead of maintaining separate template files:

- **Copy real files**: Use `Canvas.js` for components, `MathUtils.js` for utilities
- **Self-documenting**: Consistent patterns across 25+ working files  
- **Always current**: Real files stay updated by necessity
- **No maintenance overhead**: No template files to keep in sync

The codebase itself demonstrates the patterns better than any template could.

## Summary

These standards prioritize **practical consistency** over theoretical perfection. They are based on patterns that work well in our existing codebase and can be realistically followed by all team members.

Focus on:
- Clear, consistent naming
- Simple error handling  
- Moderate documentation
- Practical patterns that work

The goal is maintainable code that follows established conventions while remaining approachable and achievable.