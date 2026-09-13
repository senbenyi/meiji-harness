export const MODEL_TIMEOUTS = Object.freeze({
  image: 41 * 60 * 1000,
  video: 71 * 60 * 1000,
  longVideo: 151 * 60 * 1000,
  concat: 121 * 60 * 1000,
  workflow: 451 * 60 * 1000,
})

export class ModelTaskError extends Error {
  constructor(code, message, status = 500) {
    super(message)
    this.name = 'ModelTaskError'
    this.code = code
    this.status = status
  }
}
