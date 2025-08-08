/**
 * FileHandler Utility for Wire EDM G-Code Viewer
 * Handles file operations including loading, validation, and export
 * 
 * Features:
 * - G-code file loading with validation
 * - File format validation (.gcode, .nc, .txt)
 * - Point list export to G-code format
 * - Error handling and user feedback
 * - Progress reporting for large files
 */

import { GCodeParser } from '../core/GCodeParser.js';
import { StatusMessage } from '../components/StatusMessage.js';
import { EventBus, EVENT_TYPES } from '../core/EventManager.js';
import { GCODE, FILE, EXPORT, PERFORMANCE } from './Constants.js';

export class FileHandler {
  /**
   * FileHandler version
   */
  static VERSION = '1.0.0';

  /**
   * Supported file extensions
   */
  static SUPPORTED_EXTENSIONS = FILE.SUPPORTED_EXTENSIONS;

  /**
   * Maximum file size in bytes
   */
  static MAX_FILE_SIZE = FILE.MAX_FILE_SIZE;

  /**
   * Constructor
   * @param {Object} options - Configuration options
   * @param {StatusMessage} options.statusMessage - StatusMessage instance for user feedback
   * @param {GCodeParser} options.gCodeParser - GCodeParser instance for file processing
   */
  constructor(options = {}) {
    this.statusMessage = options.statusMessage || null; // Expect injection from app
    this.gCodeParser = options.gCodeParser || new GCodeParser();
    this.eventBus = EventBus.getInstance();
    
    // File operation state
    this.isProcessing = false;
    this.currentFile = null;
    this.loadedData = null;
    
    // Bind methods
    this._bindMethods();
  }

  /**
   * Bind methods to maintain context
   */
  _bindMethods() {
    this.loadFile = this.loadFile.bind(this);
    this.exportPoints = this.exportPoints.bind(this);
    this.validateFile = this.validateFile.bind(this);
  }

  /**
   * Load and process a G-code file
   * @param {File} file - File object to load
   * @returns {Promise<Object>} - Parse result with path data and bounds
   */
  async loadFile(file) {
    if (this.isProcessing) {
      this.statusMessage?.warning('File operation already in progress');
      return null;
    }

    try {
      this.isProcessing = true;
      this.currentFile = file;

      // Validate file before processing
      const validationResult = this.validateFile(file);
      if (!validationResult.valid) {
        this.statusMessage?.error(validationResult.message);
        return null;
      }

      // Emit file load start event (main.js will show loading status)
      this.eventBus.emit(EVENT_TYPES.FILE_LOAD_START, { file });

      // Read file content
      const fileContent = await this._readFileContent(file);
      
      // Parse G-code content
      const parseResult = this.gCodeParser.parse(fileContent);
      
      // Check if parsing resulted in errors (parser doesn't return success property)
      if (!parseResult || !parseResult.path || parseResult.path.length === 0) {
        const errorMessage = parseResult && parseResult.errors && parseResult.errors.length > 0
          ? parseResult.errors[0].message
          : 'No valid G-code commands found';
        this.statusMessage?.error(`Parse error: ${errorMessage}`);
        this.eventBus.emit(EVENT_TYPES.FILE_LOAD_ERROR, { 
          file, 
          error: errorMessage 
        });
        return null;
      }

      // Store loaded data
      this.loadedData = {
        file,
        content: fileContent,
        parseResult
      };

      // Success feedback
      this.statusMessage?.success('G-code loaded successfully!');
      this.eventBus.emit(EVENT_TYPES.FILE_LOAD_SUCCESS, {
        file,
        path: parseResult.path,
        bounds: parseResult.bounds,
        stats: parseResult.stats
      });

      return parseResult;

    } catch (error) {
      this.statusMessage?.error(`Failed to load file: ${error.message}`);
      this.eventBus.emit(EVENT_TYPES.FILE_LOAD_ERROR, { file, error });
      return null;
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Validate file before processing
   * @param {File} file - File to validate
   * @returns {Object} - Validation result
   */
  validateFile(file) {
    if (!file) {
      return { valid: false, message: 'No file provided' };
    }

    // Check file size
    if (file.size > FileHandler.MAX_FILE_SIZE) {
      const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
      const maxSizeMB = (FileHandler.MAX_FILE_SIZE / (1024 * 1024)).toFixed(0);
      return { 
        valid: false, 
        message: `File too large (${sizeMB}MB). Maximum size is ${maxSizeMB}MB.` 
      };
    }

    // Check file extension
    const fileName = file.name.toLowerCase();
    const hasValidExtension = FileHandler.SUPPORTED_EXTENSIONS.some(ext => 
      fileName.endsWith(ext)
    );

    if (!hasValidExtension) {
      return {
        valid: false,
        message: `Unsupported file type. Supported formats: ${FileHandler.SUPPORTED_EXTENSIONS.join(', ')}`
      };
    }

    // Check if file is empty
    if (file.size === 0) {
      return { valid: false, message: 'File is empty' };
    }

    return { valid: true, message: 'File is valid' };
  }

  /**
   * Export clicked points to G-code format
   * @param {Array} points - Array of point objects with x, y coordinates
   * @param {Object} options - Export options
   * @param {string} options.filename - Export filename (default: 'wire_path_points.gcode')
   * @param {boolean} options.includeHeader - Include header comments (default: true)
   * @returns {boolean} - Success status
   */
  exportPoints(points, options = {}) {
    if (!points || points.length === 0) {
      this.statusMessage?.warning('No points to export!');
      return false;
    }

    try {
      const filename = options.filename || 'wire_path_points.gcode';
      const includeHeader = options.includeHeader !== false;

      // Generate G-code content
      let gcodeContent = '';
      
      if (includeHeader) {
        gcodeContent += `${EXPORT.GCODE.HEADER_COMMENT}\n`;
        gcodeContent += `; Generated on ${new Date().toLocaleString()}\n`;
        gcodeContent += `; Total points: ${points.length}\n\n`;
      }

      // Add each point as a G0 rapid move
      points.forEach((point, index) => {
        gcodeContent += `; Point ${index + 1}\n`;
        gcodeContent += `G0 X${point.x.toFixed(GCODE.DEFAULT_PRECISION)} Y${point.y.toFixed(GCODE.DEFAULT_PRECISION)}\n`;
      });

      // Add end comment
      if (includeHeader) {
        gcodeContent += '\n; End of exported points\n';
      }

      // Create and download file
      const success = this._downloadFile(gcodeContent, filename, EXPORT.GCODE.MIME_TYPE);
      
      if (success) {
        this.statusMessage?.success(`Points exported successfully! (${points.length} points)`);
        // Normalize to EXPORT_SUCCESS
        this.eventBus.emit(EVENT_TYPES.EXPORT_SUCCESS, {
          pointCount: points.length,
          filename,
          format: 'gcode',
          points
        });
        return true;
      }

      return false;

    } catch (error) {
      this.statusMessage?.error(`Export failed: ${error.message}`);
      // Normalize to EXPORT_ERROR
      this.eventBus.emit(EVENT_TYPES.EXPORT_ERROR, { error });
      return false;
    }
  }

  /**
   * Get information about the currently loaded file
   * @returns {Object|null} - File information or null if no file loaded
   */
  getFileInfo() {
    if (!this.loadedData) {
      return null;
    }

    const { file, parseResult } = this.loadedData;
    return {
      name: file.name,
      size: file.size,
      type: file.type,
      lastModified: new Date(file.lastModified),
      stats: parseResult.stats,
      bounds: parseResult.bounds
    };
  }

  /**
   * Clear loaded file data
   */
  clearLoadedFile() {
    this.loadedData = null;
    this.currentFile = null;
    this.eventBus.emit(EVENT_TYPES.FILE_CLEARED);
  }

  /**
   * Read file content as text
   * @param {File} file - File to read
   * @returns {Promise<string>} - File content
   * @private
   */
  _readFileContent(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = (event) => {
        resolve(event.target.result);
      };
      
      reader.onerror = () => {
        reject(new Error('Failed to read file'));
      };
      
      reader.onprogress = (event) => {
        if (event.lengthComputable) {
          const progress = (event.loaded / event.total) * 100;
          this.eventBus.emit(EVENT_TYPES.FILE_LOAD_PROGRESS, {
            progress: Math.round(progress)
          });
        }
      };
      
      reader.readAsText(file);
    });
  }

  /**
   * Download file content to user's device
   * @param {string} content - File content
   * @param {string} filename - Filename
   * @param {string} mimeType - MIME type
   * @returns {boolean} - Success status
   * @private
   */
  _downloadFile(content, filename, mimeType) {
    try {
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.style.display = 'none';
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // Clean up object URL
      URL.revokeObjectURL(url);
      
      return true;
    } catch (error) {
      console.error('Download failed:', error);
      return false;
    }
  }

  /**
   * Destroy FileHandler instance
   */
  destroy() {
    this.clearLoadedFile();
    this.isProcessing = false;
    this.currentFile = null;
    this.statusMessage = null;
    this.gCodeParser = null;
  }
}

export default FileHandler;