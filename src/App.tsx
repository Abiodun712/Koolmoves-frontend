import { Routes, Route } from "react-router-dom";
import LandingPage from "./pages/LandingPage";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import HomeDashboard from "./pages/HomeDashboard";
import Profile from "./pages/Profile";
import Support from "./pages/Support";
import AirFreightPlaceholder from "./pages/AirFreightPlaceholder";
import SeaFreightPlaceholder from "./pages/SeaFreightPlaceholder";
import AdminDashboard from "./components/AdminDashboard";
import AdminAirFreight from "./components/AdminAirFreight";
import AdminSeaFreight from "./components/AdminSeaFreight";
import AdminShippingRequests from "./components/AdminShippingRequests";
import UserDashboard from "./components/UserDashboard";
import { UserAppLayout } from "./components/UserAppNav";
import { RequireAuth, RequireAdmin } from "./components/RouteGuards";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />

      <Route
        element={
          <RequireAuth>
            <UserAppLayout />
          </RequireAuth>
        }
      >
        <Route path="/home" element={<HomeDashboard />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/support" element={<Support />} />
        <Route path="/dashboard" element={<UserDashboard />} />
        <Route path="/air-freight" element={<AirFreightPlaceholder />} />
        <Route path="/sea-freight" element={<SeaFreightPlaceholder />} />
      </Route>

      <Route
        path="/admin"
        element={
          <RequireAdmin>
            <AdminDashboard />
          </RequireAdmin>
        }
      />

      <Route
        path="/admin/air-freight"
        element={
          <RequireAdmin>
            <AdminAirFreight />
          </RequireAdmin>
        }
      />

      <Route
        path="/admin/sea-freight"
        element={
          <RequireAdmin>
            <AdminSeaFreight />
          </RequireAdmin>
        }
      />

      <Route
        path="/admin/shipping-requests"
        element={
          <RequireAdmin>
            <AdminShippingRequests />
          </RequireAdmin>
        }
      />
    </Routes>
  );
}