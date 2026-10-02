// A statement the engine refuses to read. `code` lets the page pick the
// plain-language message; `message` is the detail shown under it.
export class StatementError extends Error {
  constructor(message, code = 'refused') {
    super(message);
    this.name = 'StatementError';
    this.code = code;
  }
}
