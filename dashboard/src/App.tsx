import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./lib/auth";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Overview from "./pages/Overview";
import PropertiesKB from "./pages/PropertiesKB";
import Tickets from "./pages/Tickets";
import AgentConfig from "./pages/AgentConfig";
import Users from "./pages/Users";
import Profile from "./pages/Profile";
import SmsRecipients from "./pages/SmsRecipients";
import ExtraRequests from "./pages/ExtraRequests";
import ExtrasApproval from "./pages/public/ExtrasApproval";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public, no auth */}
        <Route path="/r/:token" element={<ExtrasApproval />} />

        {/* Auth-required */}
        <Route
          path="*"
          element={
            <AuthProvider>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route element={<Layout />}>
                  <Route index element={<Overview />} />
                  <Route path="profile" element={<Profile />} />
                  <Route path="properties" element={<PropertiesKB />} />
                  <Route path="tickets" element={<Tickets />} />
                  <Route path="extra-requests" element={<ExtraRequests />} />
                  <Route path="agent-config" element={<AgentConfig />} />
                  <Route path="users" element={<Users />} />
                  <Route path="sms-recipients" element={<SmsRecipients />} />
                </Route>
              </Routes>
            </AuthProvider>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
