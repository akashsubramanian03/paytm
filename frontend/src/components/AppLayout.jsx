import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import Icon from './Icon.jsx';
import Logo from './Logo.jsx';
import { Avatar, cx } from './primitives.jsx';
import { useAuth } from '../context/AuthContext.jsx';

/* ------------------------------------------------------------- brand bar -- */

export function BrandBar({ onSearch }) {
  const { user } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-30 bg-brand-bar">
      <div className="mx-auto flex h-14 max-w-app items-center gap-3 px-4">
        <button
          onClick={() => navigate('/profile')}
          className="rounded-full ring-white/70 transition-transform active:scale-95"
          aria-label="Your profile"
        >
          <Avatar initials={user?.initials ?? '?'} color={user?.avatarColor} size={34} />
        </button>

        <div className="flex-1">
          <Logo tone="light" />
        </div>

        <button
          onClick={onSearch ?? (() => navigate('/send'))}
          className="rounded-full p-1.5 text-white/95 transition-colors hover:bg-white/15"
          aria-label="Search people to pay"
        >
          <Icon name="search" size={21} strokeWidth={2} />
        </button>
        <button
          onClick={() => navigate('/passbook')}
          className="rounded-full p-1.5 text-white/95 transition-colors hover:bg-white/15"
          aria-label="Your passbook"
        >
          <Icon name="bell" size={21} strokeWidth={2} />
        </button>
      </div>
    </header>
  );
}

/* ---------------------------------------------------------- page header -- */

/** Header for sub-pages: back arrow, title, optional trailing action. */
export function ScreenHeader({ title, subtitle, action, onBack, tone = 'light' }) {
  const navigate = useNavigate();
  const dark = tone === 'brand';

  return (
    <header
      className={cx(
        'sticky top-0 z-30',
        dark ? 'bg-brand-bar' : 'border-b border-line bg-white',
      )}
    >
      <div className="mx-auto flex h-14 max-w-app items-center gap-3 px-2 pr-4">
        <button
          onClick={() => (onBack ? onBack() : navigate(-1))}
          className={cx(
            'rounded-full p-2 transition-colors',
            dark ? 'text-white hover:bg-white/15' : 'text-ink hover:bg-canvas',
          )}
          aria-label="Go back"
        >
          <Icon name="chevronLeft" size={22} strokeWidth={2} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className={cx('truncate text-[16px] font-bold', dark ? 'text-white' : 'text-ink')}>
            {title}
          </h1>
          {subtitle && (
            <p className={cx('truncate text-[12px]', dark ? 'text-sky-200' : 'text-ink-muted')}>
              {subtitle}
            </p>
          )}
        </div>
        {action}
      </div>
    </header>
  );
}

/* ------------------------------------------------------------ bottom nav -- */

const TABS = [
  { to: '/', icon: 'home', label: 'Home', end: true },
  { to: '/passbook', icon: 'passbook', label: 'Passbook' },
  { to: '/recharge', icon: 'mobile', label: 'Recharge' },
  { to: '/profile', icon: 'user', label: 'Profile' },
];

export function BottomNav() {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white shadow-bar pb-[env(safe-area-inset-bottom)]"
      aria-label="Primary"
    >
      <div className="relative mx-auto flex h-[58px] max-w-app items-stretch">
        {TABS.slice(0, 2).map((tab) => (
          <NavTab key={tab.to} {...tab} />
        ))}

        {/* Signature element: the scan button sits above the bar, as in Paytm. */}
        <div className="relative w-[86px] shrink-0">
          <NavLink
            to="/scan"
            className="absolute left-1/2 top-[-25px] flex h-[58px] w-[58px] -translate-x-1/2 flex-col items-center justify-center rounded-full bg-brand-card text-white shadow-fab ring-4 ring-white transition-transform active:scale-95"
            aria-label="Scan any QR to pay"
          >
            <Icon name="scan" size={24} strokeWidth={1.9} />
          </NavLink>
          <span className="absolute inset-x-0 bottom-[7px] text-center text-2xs font-semibold text-navy">
            Scan
          </span>
        </div>

        {TABS.slice(2).map((tab) => (
          <NavTab key={tab.to} {...tab} />
        ))}
      </div>
    </nav>
  );
}

function NavTab({ to, icon, label, end }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cx(
          'flex flex-1 flex-col items-center justify-center gap-1 pt-1 transition-colors',
          isActive ? 'text-navy' : 'text-ink-faint hover:text-ink-muted',
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon name={icon} size={21} strokeWidth={isActive ? 2.1 : 1.7} />
          <span className={cx('text-2xs', isActive ? 'font-bold' : 'font-medium')}>{label}</span>
        </>
      )}
    </NavLink>
  );
}

/* ---------------------------------------------------------------- layout -- */

/** Shared frame for every signed-in screen. */
export default function AppLayout() {
  const { pathname } = useLocation();
  // Full-bleed screens hide the tab bar so the keypad/camera gets the room.
  const immersive = /^\/(pay|scan|success|nambikai\/assistant)/.test(pathname);

  return (
    <div className="min-h-dvh">
      <div className={cx('mx-auto max-w-app', immersive ? 'pb-0' : 'pb-[76px]')}>
        <Outlet />
      </div>
      {!immersive && <BottomNav />}
    </div>
  );
}
