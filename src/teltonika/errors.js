// -----------------------------------------------------------------------------
// RouterError: every failure of a request to the router, with a code the app
// maps to a status, a retry policy or a message. Messages never carry the
// password, the token, a serial number, an IMEI, an IMSI nor a phone number.
// `notSent`: the request certainly never reached the router (no connection,
// a certificate refused before anything was written, a check before sending).
// -----------------------------------------------------------------------------

export const CODES = Object.freeze({
  UNREACHABLE: 'unreachable', // no TCP connection
  TIMEOUT: 'timeout', // no answer in time
  HTTP: 'http', // an HTTP status other than 2xx (see `status`)
  REDIRECT: 'redirect', // a 3xx: the router wants the other protocol (never followed)
  BAD_ANSWER: 'bad_answer', // not the JSON expected, or not HTTP at all
  TOO_LARGE: 'too_large', // answer above the size cap
  CREDENTIALS: 'credentials', // the router refused the user name or the password
  ACCESS: 'access', // a fresh session refused again: the account lacks rights
  API_ERROR: 'api_error', // `success: false` with an error code (see `apiCode`)
  CERTIFICATE: 'certificate', // the HTTPS certificate is not the one learned
  LATE: 'late', // a command that could not start in time (never sent)
  CLOSED: 'closed', // the client was replaced (new configuration)
});

export class RouterError extends Error {
  constructor(code, message, { status, retryAfterMs, apiCode, notSent } = {}) {
    super(message);
    this.name = 'RouterError';
    this.code = code;
    if (status !== undefined) this.status = status;
    if (retryAfterMs !== undefined && retryAfterMs !== null) this.retryAfterMs = retryAfterMs;
    if (apiCode !== undefined) this.apiCode = apiCode;
    if (notSent) this.notSent = true;
  }
}

/** RutOS error codes (teltasync error_codes.py, from the RutOS API documentation). */
export const API_CODES = Object.freeze({
  UNAUTHORIZED: 120,
  LOGIN_FAILED: 121,
  STRUCTURE: 122,
  INVALID_JWT: 123,
});

/** The codes that say the session (token) is no longer valid. */
export const SESSION_REJECTED = new Set([API_CODES.UNAUTHORIZED, API_CODES.INVALID_JWT]);

/** Final until the configuration is saved: user name or password refused at login. */
export const isCredentialsRefused = (err) => err?.code === CODES.CREDENTIALS;
