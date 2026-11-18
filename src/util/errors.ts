// Stable discriminator for "resource does not exist" failures, so controllers
// can map it to 404 without matching on error message strings.
export class NotFoundError extends Error {
  constructor(message = "Not Found") {
    super(message)
    this.name = "NotFoundError"
  }
}
