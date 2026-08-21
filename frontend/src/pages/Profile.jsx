import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { QRCodeCanvas } from 'qrcode.react';
import { BrandBar } from '../components/AppLayout.jsx';
import Icon from '../components/Icon.jsx';
import Sheet from '../components/Sheet.jsx';
import { Avatar, Button, Card, Field, ListRow, MockBadge, Spinner } from '../components/primitives.jsx';
import { api, ApiError } from '../lib/api.js';
import { useAsync, useCopy } from '../lib/hooks.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { formatPaise } from '../lib/format.js';

export default function Profile() {
  const { user, account, setUser, signOut } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const { copied, copy } = useCopy();

  const payCode = useAsync(() => api.payCode(), []);

  const [sheet, setSheet] = useState(null); // 'name' | 'password' | 'signout'
  const [name, setName] = useState({ firstName: '', lastName: '' });
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  function openNameSheet() {
    setName({ firstName: user.firstName, lastName: user.lastName });
    setErrors({});
    setSheet('name');
  }

  async function saveName() {
    setBusy(true);
    setErrors({});
    try {
      const result = await api.updateProfile(name);
      setUser(result.user);
      toast.success('Profile updated', result.message);
      setSheet(null);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors);
        toast.error("Couldn't save", err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function savePassword() {
    setBusy(true);
    setErrors({});
    try {
      const result = await api.changePassword(passwords);
      toast.success('Password changed', result.message);
      setPasswords({ currentPassword: '', newPassword: '' });
      setSheet(null);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors({ ...err.fieldErrors, form: err.message });
        toast.error("Couldn't change password", err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    setBusy(true);
    await signOut();
    toast.success('Signed out', 'Your session has been ended on the server.');
    navigate('/signin', { replace: true });
  }

  async function copyUpi() {
    const ok = await copy(user.upiId);
    toast[ok ? 'success' : 'error'](
      ok ? 'UPI ID copied' : "Couldn't copy",
      ok ? user.upiId : 'Select and copy it manually.',
    );
  }

  async function shareQr() {
    const text = `Pay ${user.name} on Paytm — ${user.upiId}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'My Paytm pay code', text });
        return;
      } catch {
        // Cancelled — fall through to copying.
      }
    }
    const ok = await copy(payCode.data?.payload ?? user.upiId);
    toast[ok ? 'success' : 'error'](
      ok ? 'Pay code copied' : "Couldn't share",
      ok ? 'Paste it into the Scan & Pay screen to test it.' : 'Try copying your UPI ID instead.',
    );
  }

  if (!user) return null;

  return (
    <>
      <BrandBar />

      <div className="space-y-3 px-3 pt-3">
        {/* ---- identity + QR ---- */}
        <Card className="overflow-hidden">
          <div className="flex flex-col items-center px-5 pb-5 pt-6 text-center">
            <Avatar initials={user.initials} color={user.avatarColor} size={76} />
            <h1 className="mt-3 text-[19px] font-bold text-ink">{user.name}</h1>

            <button
              onClick={copyUpi}
              className="mt-1 inline-flex items-center gap-1.5 text-[13.5px] text-ink-muted transition-colors hover:text-navy"
            >
              UPI ID: <span className="font-semibold text-ink">{user.upiId}</span>
              <Icon name={copied ? 'check' : 'copy'} size={14} className="text-navy" />
            </button>

            <p className="tnum mt-0.5 text-[12.5px] text-ink-faint">Mobile: {user.phone}</p>

            <div className="mt-5 rounded-2xl border border-line bg-white p-3.5">
              {payCode.loading ? (
                <div className="flex h-[172px] w-[172px] items-center justify-center">
                  <Spinner className="text-navy" />
                </div>
              ) : (
                <QRCodeCanvas
                  value={payCode.data?.payload ?? user.upiId}
                  size={172}
                  level="M"
                  marginSize={0}
                  fgColor="#012B72"
                  bgColor="#FFFFFF"
                  title={`Pay code for ${user.name}`}
                />
              )}
            </div>
            <p className="mt-2.5 max-w-[30ch] text-[12px] leading-relaxed text-ink-faint">
              Anyone signed in can scan this from Scan &amp; Pay to send you money.
            </p>

            <Button variant="outline" className="mt-4" onClick={shareQr}>
              <Icon name="share" size={16} />
              Share pay code
            </Button>
          </div>

          <div className="flex items-center justify-between border-t border-line bg-canvas/50 px-4 py-3">
            <span className="text-[13px] font-semibold text-ink-muted">Wallet balance</span>
            <span className="tnum text-[16px] font-bold text-navy">
              {formatPaise(account?.balancePaise ?? 0)}
            </span>
          </div>
        </Card>

        {/* ---- settings ---- */}
        <Card className="overflow-hidden">
          <div className="divide-y divide-line">
            <ListRow
              icon={<SettingIcon name="edit" />}
              title="Edit name"
              subtitle="Change how your name appears to others"
              onClick={openNameSheet}
            />
            <ListRow
              icon={<SettingIcon name="lock" />}
              title="Change password"
              subtitle="Signs out every other device"
              onClick={() => {
                setErrors({});
                setSheet('password');
              }}
            />
            <ListRow
              icon={<SettingIcon name="passbook" />}
              title="Passbook"
              subtitle="Every transaction on this wallet"
              onClick={() => navigate('/passbook')}
            />
            <ListRow
              icon={<SettingIcon name="plus" />}
              title="Add money"
              subtitle="Top up with a mock card or bank"
              onClick={() => navigate('/add-money')}
            />
          </div>
        </Card>

        <Card>
          <Link to="/nambikai" className="block">
            <ListRow
              icon={<SettingIcon name="shield" />}
              title="Nambikai trust profile"
              subtitle="Your score, and what a lender would see"
              onClick={() => {}}
            />
          </Link>
          <div className="hairline" />
          <Link to="/nambikai/consent" className="block">
            <ListRow
              icon={<SettingIcon name="lock" />}
              title="Data & consent"
              subtitle="Choose what Nambikai may read"
              onClick={() => {}}
            />
          </Link>
        </Card>

        <Card className="overflow-hidden">
          <ListRow
            icon={<SettingIcon name="logout" tone="danger" />}
            title="Sign out"
            subtitle="Ends this session on the server"
            onClick={() => setSheet('signout')}
            right={<Icon name="chevronRight" size={18} className="text-ink-faint" />}
          />
        </Card>

        <div className="rounded-card border border-dashed border-navy/25 bg-sky-50 px-4 py-3">
          <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-navy">
            <Icon name="info" size={16} className="mt-px shrink-0" />
            <span>
              This app is an unofficial Paytm clone built for learning, and is not connected to the real
              Paytm. Your wallet, transactions and this QR code exist only in the SQLite database on this
              machine — no bank, UPI network or payment gateway is involved.
            </span>
          </p>
        </div>

        <MockBadge className="pb-3 pt-1" />
      </div>

      {/* ---- edit name ---- */}
      <Sheet
        open={sheet === 'name'}
        onClose={() => !busy && setSheet(null)}
        title="Edit name"
        footer={
          <Button size="lg" full loading={busy} onClick={saveName}>
            Save changes
          </Button>
        }
      >
        <div className="grid grid-cols-2 gap-3 p-4">
          <Field
            label="First name" name="firstName" value={name.firstName}
            onChange={(e) => setName((n) => ({ ...n, firstName: e.target.value }))}
            error={errors.firstName}
          />
          <Field
            label="Last name" name="lastName" value={name.lastName}
            onChange={(e) => setName((n) => ({ ...n, lastName: e.target.value }))}
            error={errors.lastName}
          />
        </div>
      </Sheet>

      {/* ---- change password ---- */}
      <Sheet
        open={sheet === 'password'}
        onClose={() => !busy && setSheet(null)}
        title="Change password"
        footer={
          <Button size="lg" full loading={busy} onClick={savePassword}>
            Update password
          </Button>
        }
      >
        <div className="space-y-4 p-4">
          <Field
            label="Current password" name="currentPassword" type="password" autoComplete="current-password"
            value={passwords.currentPassword}
            onChange={(e) => setPasswords((p) => ({ ...p, currentPassword: e.target.value }))}
            error={errors.currentPassword ?? errors.form}
          />
          <Field
            label="New password" name="newPassword" type="password" autoComplete="new-password"
            value={passwords.newPassword}
            onChange={(e) => setPasswords((p) => ({ ...p, newPassword: e.target.value }))}
            error={errors.newPassword}
            hint="8+ characters with at least one letter and one number"
          />
        </div>
      </Sheet>

      {/* ---- sign out ---- */}
      <Sheet
        open={sheet === 'signout'}
        onClose={() => !busy && setSheet(null)}
        title="Sign out?"
        footer={
          <div className="grid grid-cols-2 gap-3">
            <Button variant="outline" size="lg" onClick={() => setSheet(null)}>
              Stay signed in
            </Button>
            <Button variant="danger" size="lg" loading={busy} onClick={handleSignOut}>
              Sign out
            </Button>
          </div>
        }
      >
        <p className="px-4 py-5 text-[14px] leading-relaxed text-ink-muted">
          Your session will be revoked on the server, so this device's token stops working immediately. Your
          wallet and passbook stay exactly as they are.
        </p>
      </Sheet>
    </>
  );
}

function SettingIcon({ name, tone = 'brand' }) {
  return (
    <span
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
        tone === 'danger' ? 'bg-debit/10 text-debit' : 'bg-sky-50 text-navy'
      }`}
    >
      <Icon name={name} size={19} />
    </span>
  );
}
