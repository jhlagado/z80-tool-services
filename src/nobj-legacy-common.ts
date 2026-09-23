/** Error raised when a version-specific legacy NOBJ profile is invalid. */
export class NobjLegacyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NobjLegacyError';
  }
}
