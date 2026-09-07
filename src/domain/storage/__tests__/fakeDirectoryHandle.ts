class FakeFileHandle {
  constructor(
    readonly name: string,
    private getContents: () => string,
    private setContents: (contents: string) => void
  ) {}

  async getFile() {
    return new File([this.getContents()], this.name);
  }

  async createWritable() {
    return {
      write: async (contents: string) => this.setContents(contents),
      close: async () => undefined
    };
  }
}

export class FakeDirectoryHandle {
  readonly kind = 'directory';
  readonly directories = new Map<string, FakeDirectoryHandle>();
  readonly files = new Map<string, string>();

  constructor(readonly name: string) {}

  async getDirectoryHandle(name: string, options: { create?: boolean } = {}) {
    const existing = this.directories.get(name);
    if (existing) return existing;
    if (!options.create) throw new DOMException('Not found', 'NotFoundError');

    const directory = new FakeDirectoryHandle(name);
    this.directories.set(name, directory);
    return directory;
  }

  async getFileHandle(name: string, options: { create?: boolean } = {}) {
    if (!this.files.has(name)) {
      if (!options.create) throw new DOMException('Not found', 'NotFoundError');
      this.files.set(name, '');
    }

    return new FakeFileHandle(
      name,
      () => this.files.get(name) || '',
      (contents) => this.files.set(name, contents)
    );
  }

  async removeEntry(name: string) {
    if (!this.files.delete(name)) {
      throw new DOMException('Not found', 'NotFoundError');
    }
  }
}
