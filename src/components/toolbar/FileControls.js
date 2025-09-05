/**
 * FileControls
 * PR1: Extract file input + drag/drop wiring from Toolbar.
 * Delegates chosen file back to Toolbar via callback.
 */

export class FileControls {
  /**
   * @param {Object} elements - Element references
   * @param {HTMLInputElement} elements.fileInput
   * @param {HTMLElement} elements.fileInputLabel
   * @param {Object} callbacks
   * @param {(file: File) => void} callbacks.onChooseFile
   */
  constructor(elements = {}, callbacks = {}) {
    this.elements = elements;
    this.onChooseFile = callbacks.onChooseFile || (() => {});
    this.isInitialized = false;
    this._bound = null;
  }

  init() {
    if (this.isInitialized) return;
    this._bind();
    this._attach();
    this.isInitialized = true;
  }

  destroy() {
    this._detach();
    this._bound = null;
    this.isInitialized = false;
  }

  _bind() {
    this._bound = {
      onChange: (event) => {
        const input = event.target;
        const file = input && input.files && input.files[0];
        if (file) this.onChooseFile(file);
      },
      onDragOver: (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (this.elements.fileInputLabel) this.elements.fileInputLabel.classList.add('drag-over');
      },
      onDragLeave: (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (this.elements.fileInputLabel) this.elements.fileInputLabel.classList.remove('drag-over');
      },
      onDrop: (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (this.elements.fileInputLabel) this.elements.fileInputLabel.classList.remove('drag-over');
        const dt = event.dataTransfer;
        if (dt && dt.files && dt.files.length > 0) {
          this.onChooseFile(dt.files[0]);
        }
      }
    };
  }

  _attach() {
    const { fileInput, fileInputLabel } = this.elements;
    if (fileInput) fileInput.addEventListener('change', this._bound.onChange);
    if (fileInputLabel) {
      fileInputLabel.addEventListener('dragover', this._bound.onDragOver);
      fileInputLabel.addEventListener('dragleave', this._bound.onDragLeave);
      fileInputLabel.addEventListener('drop', this._bound.onDrop);
    }
  }

  _detach() {
    const { fileInput, fileInputLabel } = this.elements;
    if (fileInput && this._bound?.onChange) fileInput.removeEventListener('change', this._bound.onChange);
    if (fileInputLabel) {
      if (this._bound?.onDragOver) fileInputLabel.removeEventListener('dragover', this._bound.onDragOver);
      if (this._bound?.onDragLeave) fileInputLabel.removeEventListener('dragleave', this._bound.onDragLeave);
      if (this._bound?.onDrop) fileInputLabel.removeEventListener('drop', this._bound.onDrop);
    }
  }
}

export default FileControls;
