/** Stable business error carried from domain/application code to DSH adapters. */
export class ElysiumError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'ElysiumError'
    this.code = code
    this.status = status
  }
}
