export class DomainConflictError extends Error {
  constructor(message, detail = {}) {
    super(message)
    this.name = 'DomainConflictError'
    this.code = 'conflict'
    this.status = 409
    this.detail = detail
  }
}

export class DomainValidationError extends Error {
  constructor(message, detail = {}) {
    super(message)
    this.name = 'DomainValidationError'
    this.code = 'invalid-command'
    this.status = 400
    this.detail = detail
  }
}

export class DomainNotFoundError extends Error {
  constructor(message, detail = {}) {
    super(message)
    this.name = 'DomainNotFoundError'
    this.code = 'not-found'
    this.status = 404
    this.detail = detail
  }
}
