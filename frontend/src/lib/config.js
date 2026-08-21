/** Frontend config. Values come from frontend/.env — see .env.example. */
export const config = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:4000/api/v1',
  appName: import.meta.env.VITE_APP_NAME ?? 'Paytm',
};

export const TOKEN_STORAGE_KEY = 'paytm.token';
