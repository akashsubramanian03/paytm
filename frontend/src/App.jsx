import { Navigate, Route, Routes } from 'react-router-dom';
import AppLayout from './components/AppLayout.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import Toasts from './components/Toasts.jsx';

import SignIn from './pages/SignIn.jsx';
import SignUp from './pages/SignUp.jsx';
import Dashboard from './pages/Dashboard.jsx';
import SendMoney from './pages/SendMoney.jsx';
import PayUser from './pages/PayUser.jsx';
import AddMoney from './pages/AddMoney.jsx';
import Recharge from './pages/Recharge.jsx';
import Bills from './pages/Bills.jsx';
import Passbook from './pages/Passbook.jsx';
import TransactionDetail from './pages/TransactionDetail.jsx';
import Scan from './pages/Scan.jsx';
import Profile from './pages/Profile.jsx';
import Success from './pages/Success.jsx';

import NambikaiHome from './pages/nambikai/NambikaiHome.jsx';
import Consent from './pages/nambikai/Consent.jsx';
import ConsentAudit from './pages/nambikai/ConsentAudit.jsx';
import Assistant from './pages/nambikai/Assistant.jsx';
import ClusterSettings from './pages/nambikai/ClusterSettings.jsx';
import Groups from './pages/nambikai/Groups.jsx';
import Report from './pages/nambikai/Report.jsx';
import RequestReport from './pages/nambikai/RequestReport.jsx';
import GroupDetail from './pages/nambikai/GroupDetail.jsx';
import CreateGroup from './pages/nambikai/CreateGroup.jsx';

export default function App() {
  return (
    <>
      <Toasts />
      <Routes>
        <Route path="/signin" element={<SignIn />} />
        <Route path="/signup" element={<SignUp />} />

        {/* Everything below requires a valid session. */}
        <Route
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="send" element={<SendMoney />} />
          <Route path="pay/:userId" element={<PayUser />} />
          <Route path="add-money" element={<AddMoney />} />
          <Route path="recharge" element={<Recharge />} />
          <Route path="bills" element={<Bills />} />
          <Route path="passbook" element={<Passbook />} />
          <Route path="passbook/:id" element={<TransactionDetail />} />
          <Route path="scan" element={<Scan />} />
          <Route path="profile" element={<Profile />} />
          <Route path="success" element={<Success />} />

          {/* ---- Nambikai ---- */}
          <Route path="nambikai" element={<NambikaiHome />} />
          <Route path="nambikai/consent" element={<Consent />} />
          <Route path="nambikai/consent/audit" element={<ConsentAudit />} />
          <Route path="nambikai/assistant" element={<Assistant />} />
          <Route path="nambikai/cluster" element={<ClusterSettings />} />
          <Route path="nambikai/report" element={<Report />} />
          <Route path="nambikai/report/new" element={<RequestReport />} />
          <Route path="nambikai/groups" element={<Groups />} />
          <Route path="nambikai/groups/new" element={<CreateGroup />} />
          <Route path="nambikai/groups/:id" element={<GroupDetail />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
