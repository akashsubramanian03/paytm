import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { ApiError } from '../lib/api.js';
import { Button, Field, MockBadge } from '../components/primitives.jsx';
import Logo from '../components/Logo.jsx';
import { formatPaise } from '../lib/format.js';

const EMPTY = { firstName: '', lastName: '', email: '', phone: '', password: '' };

export default function SignUp() {
  const { signUp, isAuthenticated } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isAuthenticated) navigate('/', { replace: true });
  }, [isAuthenticated, navigate]);

  const update = (field) => (e) => {
    const value = field === 'phone' ? e.target.value.replace(/\D/g, '').slice(0, 10) : e.target.value;
    setForm((f) => ({ ...f, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setErrors({});
    try {
      const created = await signUp(form);
      toast.success(
        'Wallet created',
        `${formatPaise(created?.account?.balancePaise ?? 0)} of demo money is ready to spend.`,
      );
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors);
        toast.error("Couldn't create your account", err.message);
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
          <h1 className="mt-5 text-[26px] font-bold leading-tight text-white">Create your wallet</h1>
          <p className="mt-1.5 text-[14px] leading-relaxed text-sky-200">
            You'll get a UPI-style ID and demo money to try every flow.
          </p>
        </div>
      </div>

      <div className="mx-auto -mt-5 w-full max-w-app flex-1 px-4">
        <form onSubmit={handleSubmit} className="card space-y-4 p-5" noValidate>
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="First name" name="firstName" autoComplete="given-name" placeholder="Sreeram"
              value={form.firstName} onChange={update('firstName')} error={errors.firstName}
            />
            <Field
              label="Last name" name="lastName" autoComplete="family-name" placeholder="R"
              value={form.lastName} onChange={update('lastName')} error={errors.lastName}
            />
          </div>

          <Field
            label="Email" name="email" type="email" autoComplete="email" placeholder="you@example.com"
            value={form.email} onChange={update('email')} error={errors.email}
          />

          <Field
            label="Mobile number" name="phone" inputMode="numeric" autoComplete="tel"
            placeholder="9876543210" prefix={<span className="text-[15px] font-semibold text-ink">+91</span>}
            value={form.phone} onChange={update('phone')} error={errors.phone}
            hint="10 digits, starting with 6-9"
          />

          <Field
            label="Password" name="password" type="password" autoComplete="new-password"
            placeholder="At least 8 characters" value={form.password} onChange={update('password')}
            error={errors.password} hint="Use 8+ characters with at least one letter and one number"
          />

          <Button type="submit" size="lg" full loading={submitting}>
            {submitting ? 'Creating wallet' : 'Create wallet'}
          </Button>

          <p className="text-center text-[13.5px] text-ink-muted">
            Already have an account?{' '}
            <Link to="/signin" className="font-bold text-navy underline-offset-2 hover:underline">
              Sign in
            </Link>
          </p>
        </form>

        <MockBadge className="py-6" />
      </div>
    </div>
  );
}
