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

  // Nambikai gets its own namespace rather than ~30 more entries on this flat
  // object. A deliberate deviation from the convention above, justified by count.
  nambikai: {
    groups: () => request('GET', '/nambikai/groups'),
    group: (id) => request('GET', `/nambikai/groups/${id}`),
    createGroup: (body) => request('POST', '/nambikai/groups', { body }),
    addMember: (id, body) => request('POST', `/nambikai/groups/${id}/members`, { body }),
    removeMember: (id, userId) =>
      request('DELETE', `/nambikai/groups/${id}/members/${userId}`),
    contributions: (id, params) =>
      request('GET', withQuery(`/nambikai/groups/${id}/contributions`, params)),
    payContribution: (id, contributionId) =>
      request('POST', `/nambikai/groups/${id}/contributions/${contributionId}/pay`),
    payoutCycle: (id) => request('GET', `/nambikai/groups/${id}/payout-cycle`),

    consents: () => request('GET', '/nambikai/consents'),
    consentCatalogue: () => request('GET', '/nambikai/consents/catalogue'),
    grantConsent: (body) => request('POST', '/nambikai/consents', { body }),
    revokeConsent: (id) => request('DELETE', `/nambikai/consents/${id}`),
    consentAudit: (params) => request('GET', withQuery('/nambikai/consents/audit', params)),

    scoreInputs: () => request('GET', '/nambikai/score/inputs'),
    score: () => request('GET', '/nambikai/score'),
    recomputeScore: () => request('POST', '/nambikai/score/recompute'),
    scoreHistory: (limit) => request('GET', withQuery('/nambikai/score/history', { limit })),
    scoreSignals: () => request('GET', '/nambikai/score/signals'),

    ask: (body) => request('POST', '/nambikai/assistant/ask', { body }),
    assistantSuggestions: () => request('GET', '/nambikai/assistant/suggestions'),

    partners: () => request('GET', '/nambikai/underwriting/partners'),
    relationships: () => request('GET', '/nambikai/underwriting/relationships'),
    createReport: (body) => request('POST', '/nambikai/underwriting/reports', { body }),
    reports: (params) => request('GET', withQuery('/nambikai/underwriting/reports', params)),
    report: (id) => request('GET', `/nambikai/underwriting/reports/${id}`),

    clusterStatus: () => request('GET', '/nambikai/cluster/status'),
    clusterSignal: (groupId) => request('GET', `/nambikai/cluster/${groupId}/signal`),
    clusterOptIn: (groupId) => request('POST', '/nambikai/cluster/opt-in', { body: { groupId } }),
    clusterOptOut: (groupId) => request('POST', '/nambikai/cluster/opt-out', { body: { groupId } }),
    appeals: () => request('GET', '/nambikai/cluster/appeals'),
    createAppeal: (body) => request('POST', '/nambikai/cluster/appeals', { body }),
    withdrawAppeal: (id) => request('POST', `/nambikai/cluster/appeals/${id}/withdraw`),

    businesses: () => request('GET', '/nambikai/businesses'),
    business: (id) => request('GET', `/nambikai/businesses/${id}`),
    businessScore: (id) => request('GET', `/nambikai/businesses/${id}/score`),
    businessRecords: (id, params) =>
      request('GET', withQuery(`/nambikai/businesses/${id}/records`, params)),
    businessSuggestions: (id) =>
      request('GET', `/nambikai/businesses/${id}/assistant/suggestions`),
    businessAsk: (id, body) =>
      request('POST', `/nambikai/businesses/${id}/assistant/ask`, { body }),

    lendingEligibility: (amount) =>
      request('GET', withQuery('/nambikai/lending/eligibility', { amount })),
    lendingOffers: (amount) => request('GET', withQuery('/nambikai/lending/offers', { amount })),
    applyForLoan: (body) => request('POST', '/nambikai/lending/applications', { body }),
    loanApplications: () => request('GET', '/nambikai/lending/applications'),
    acceptOffer: (applicationId, body) =>
      request('POST', `/nambikai/lending/applications/${applicationId}/accept`, { body }),
    kycStatus: () => request('GET', '/nambikai/lending/kyc'),
    submitKyc: (body) => request('POST', '/nambikai/lending/kyc', { body }),
    loans: () => request('GET', '/nambikai/lending/loans'),
    loan: (id) => request('GET', `/nambikai/lending/loans/${id}`),
    payInstallment: (loanId, installmentId) =>
      request('POST', `/nambikai/lending/loans/${loanId}/installments/${installmentId}/pay`),
    loanForecast: (id) => request('GET', `/nambikai/lending/loans/${id}/forecast`),
    incomeProof: () => request('GET', '/nambikai/lending/income-proof'),
    portfolio: () => request('GET', '/nambikai/lending/portfolio'),
  },
};
