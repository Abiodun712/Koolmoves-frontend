import { Routes, Route } from "react-router-dom";
import LandingPage from "./pages/LandingPage";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import HomeDashboard from "./pages/HomeDashboard";
import AirFreightPlaceholder from "./pages/AirFreightPlaceholder";
import SeaFreightPlaceholder from "./pages/SeaFreightPlaceholder";
import AdminDashboard from "./components/AdminDashboard";
import UserDashboard from "./components/UserDashboard";
import { RequireAuth, RequireAdmin } from "./components/RouteGuards";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />

      <Route
        path="/home"
        element={
          <RequireAuth>
            <HomeDashboard />
          </RequireAuth>
        }
      />

      <Route
        path="/air-freight"
        element={
          <RequireAuth>
            <AirFreightPlaceholder />
          </RequireAuth>
        }
      />

      <Route
        path="/sea-freight"
        element={
          <RequireAuth>
            <SeaFreightPlaceholder />
          </RequireAuth>
        }
      />

      <Route
        path="/dashboard"
        element={
          <RequireAuth>
            <UserDashboard />
          </RequireAuth>
        }
      />

      <Route
        path="/admin"
        element={
          <RequireAdmin>
            <AdminDashboard />
          </RequireAdmin>
        }
      />
    </Routes>
  );
}