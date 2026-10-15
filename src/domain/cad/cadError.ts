export class CadError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'CadError';
  }
}
