import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { Spinner } from './primitives.jsx';
import Logo from './Logo.jsx';

/** Blocks every signed-in screen and remembers where the user was headed. */
export default function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) return <BootScreen />;

  if (!isAuthenticated) {
    return <Navigate to="/signin" state={{ from: location }} replace />;
  }
  return children;
}

export function BootScreen() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4">
      <Logo tone="dark" className="text-[26px]" />
      <Spinner size={22} className="text-navy" />
      <span className="sr-only">Loading your account</span>
    </div>
  );
}
