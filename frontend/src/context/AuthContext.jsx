import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, clearToken, getToken, setToken, setUnauthorizedHandler } from '../lib/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [account, setAccount] = useState(null);
  // "loading" covers the initial token check so protected routes don't flash.
  const [loading, setLoading] = useState(true);
  const [expiredNotice, setExpiredNotice] = useState(false);

  const reset = useCallback(() => {
    clearToken();
    setUser(null);
    setAccount(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      reset();
      setExpiredNotice(true);
    });
  }, [reset]);

  useEffect(() => {
    let cancelled = false;
    async function restore() {
      if (!getToken()) {
        setLoading(false);
        return;
      }
      try {
        const data = await api.me();
        if (cancelled) return;
        setUser(data.user);
        setAccount(data.account);
      } catch {
        if (!cancelled) reset();
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    restore();
    return () => {
      cancelled = true;
    };
  }, [reset]);

  const adopt = useCallback((data) => {
    setToken(data.token);
    setUser(data.user);
    setAccount(data.account);
    setExpiredNotice(false);
  }, []);

  const signIn = useCallback(async (credentials) => adopt(await api.signIn(credentials)), [adopt]);
  const signUp = useCallback(async (details) => adopt(await api.signUp(details)), [adopt]);

  const signOut = useCallback(async () => {
    try {
      await api.signOut();
    } catch {
      // Signing out locally must succeed even if the API is unreachable.
    }
    reset();
  }, [reset]);

  /** Re-reads the balance from the server. Never derived on the client. */
  const refreshBalance = useCallback(async () => {
    const data = await api.balance();
    setAccount(data.account);
    return data.account;
  }, []);

  const value = useMemo(
    () => ({
      user, account, loading, expiredNotice,
      isAuthenticated: Boolean(user),
      signIn, signUp, signOut, refreshBalance, setUser,
      clearExpiredNotice: () => setExpiredNotice(false),
    }),
    [user, account, loading, expiredNotice, signIn, signUp, signOut, refreshBalance],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
