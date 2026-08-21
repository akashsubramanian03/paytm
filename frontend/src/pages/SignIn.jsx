import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { ApiError } from '../lib/api.js';
import { Button, Field, MockBadge } from '../components/primitives.jsx';
import Logo from '../components/Logo.jsx';
import Icon from '../components/Icon.jsx';

const DEMO = { identifier: 'sreeram@paytm.test', password: 'password123' };

export default function SignIn() {
  const { signIn, isAuthenticated, expiredNotice, clearExpiredNotice } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = location.state?.from?.pathname ?? '/';

  const [form, setForm] = useState({ identifier: '', password: '' });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (isAuthenticated) navigate(redirectTo, { replace: true });
  }, [isAuthenticated, navigate, redirectTo]);

  useEffect(() => {
    if (expiredNotice) {
      toast.info('Session expired', 'Sign in again to pick up where you left off.');
      clearExpiredNotice();
    }
  }, [expiredNotice, clearExpiredNotice, toast]);

  const update = (field) => (e) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setErrors({});
    try {
      await signIn(form);
      toast.success('Signed in', 'Welcome back to Paytm.');
      navigate(redirectTo, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors);
        toast.error("Couldn't sign in", err.message);
      } else {
        toast.error('Something went wrong', 'Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <div className="bg-brand-bar px-6 pb-10 pt-12">
        <div className="mx-auto max-w-app">
          <Logo tone="light" className="!text-[28px]" />
          <h1 className="mt-5 text-[26px] font-bold leading-tight text-white">
            Sign in to your wallet
          </h1>
          <p className="mt-1.5 text-[14px] leading-relaxed text-sky-200">
            A local demo wallet. Every rupee here is simulated on your own machine.
          </p>
        </div>
      </div>

      <div className="mx-auto -mt-5 w-full max-w-app flex-1 px-4">
        <form onSubmit={handleSubmit} className="card space-y-4 p-5" noValidate>
          <Field
            label="Email or mobile number"
            name="identifier"
            autoComplete="username"
            placeholder="you@example.com or 98XXXXXXXX"
            value={form.identifier}
            onChange={update('identifier')}
            error={errors.identifier}
            prefix={<Icon name="user" size={18} />}
          />

          <Field
            label="Password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            placeholder="Your password"
            value={form.password}
            onChange={update('password')}
            error={errors.password}
            prefix={<Icon name="lock" size={18} />}
            suffix={
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="rounded-md px-1 text-[12px] font-bold uppercase tracking-wide text-navy"
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            }
          />

          <Button type="submit" size="lg" full loading={submitting}>
            {submitting ? 'Signing in' : 'Sign in'}
          </Button>

          <p className="text-center text-[13.5px] text-ink-muted">
            New to Paytm?{' '}
            <Link to="/signup" className="font-bold text-navy underline-offset-2 hover:underline">
              Create an account
            </Link>
          </p>
        </form>

        <div className="mt-4 rounded-card border border-dashed border-navy/25 bg-sky-50 p-4">
          <p className="text-[13px] font-bold text-navy">Demo account</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">
            Seeded users share the password <span className="font-semibold text-ink">password123</span>.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => {
              setForm(DEMO);
              setErrors({});
            }}
          >
            Fill demo credentials
          </Button>
        </div>

        <MockBadge className="py-6" />
      </div>
    </div>
  );
}
