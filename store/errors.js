// An error whose message is safe to show the user, with the HTTP status to answer with.
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const SIGN_IN_AGAIN = 'Your session has ended. Sign in again.';
