import { config, TOKEN_STORAGE_KEY } from './config.js';

/** Error carrying the server's machine-readable code and field details. */
export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** Turns backend field errors into { fieldName: message } for forms. */
  get fieldErrors() {
    if (!Array.isArray(this.details)) return {};
    return Object.fromEntries(this.details.map((d) => [d.field, d.message]));
  }
}

export const getToken = () => localStorage.getItem(TOKEN_STORAGE_KEY);
export const setToken = (token) => localStorage.setItem(TOKEN_STORAGE_KEY, token);
export const clearToken = () => localStorage.removeItem(TOKEN_STORAGE_KEY);

// Set by AuthProvider so an expired session can bounce the user to sign-in
// from anywhere, including background requests.
let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => {
  onUnauthorized = fn;
};

async function request(method, path, { body, signal, auth = true } = {}) {
  const token = auth ? getToken() : null;

  let response;
  try {
    response = await fetch(`${config.apiBaseUrl}${path}`, {
      method,
      signal,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      `Can't reach the Paytm API at ${config.apiBaseUrl}. Is the backend running?`,
    );
  }

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const error = payload?.error ?? {};
    if (response.status === 401 && auth && token) onUnauthorized();
    throw new ApiError(
      response.status,
      error.code ?? 'UNKNOWN',
      error.message ?? 'Something went wrong.',
      error.details,
    );
  }
  return payload;
}

const withQuery = (path, params = {}) => {
  const search = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  ).toString();
  return search ? `${path}?${search}` : path;
};

export const api = {
  signUp: (body) => request('POST', '/auth/signup', { body, auth: false }),
  signIn: (body) => request('POST', '/auth/signin', { body, auth: false }),
  signOut: () => request('POST', '/auth/signout'),
  me: () => request('GET', '/auth/me'),

  balance: () => request('GET', '/account/balance'),
  limits: () => request('GET', '/account/limits'),
  addMoney: (body) => request('POST', '/account/add-money', { body }),
  transfer: (body) => request('POST', '/account/transfer', { body }),

  searchUsers: (q, signal) => request('GET', withQuery('/users/search', { q }), { signal }),
  user: (id) => request('GET', `/users/${id}`),
  recentPayees: () => request('GET', '/users/recent'),
  resolveCode: (code) => request('POST', '/users/resolve', { body: { code } }),
  payCode: () => request('GET', '/users/me/pay-code'),
  updateProfile: (body) => request('PATCH', '/users/me', { body }),
  changePassword: (body) => request('PATCH', '/users/me/password', { body }),

  transactions: (params) => request('GET', withQuery('/transactions', params)),
  transaction: (id) => request('GET', `/transactions/${id}`),
  summary: (days) => request('GET', withQuery('/transactions/summary', { days })),

  operators: () => request('GET', '/payments/operators'),
  plans: (params) => request('GET', withQuery('/payments/plans', params)),
  recharge: (body) => request('POST', '/payments/recharge', { body }),
  billers: (params) => request('GET', withQuery('/payments/billers', params)),
  payBill: (body) => request('POST', '/payments/bill', { body }),
};
