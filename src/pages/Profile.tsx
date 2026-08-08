import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

export default function Profile() {
  const [profile, setProfile] = useState<any>(null);

  useEffect(() => {
    const getProfile = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        const { data, error } = await supabase
          .from("profiles")
          .select("km_id, full_name, email, phone, country")
          .eq("user_id", user.id)
          .single();

        if (!error) {
          setProfile(data);
        }
      }
    };

    getProfile();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  return (
    <div className="p-5 bg-white rounded-2xl border border-gray-200 shadow-sm space-y-5">

      <div>
        <h2 className="text-xl font-bold text-gray-900">
          User Profile
        </h2>
        <p className="text-sm text-gray-600">
          Manage your account information.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

        <div className="p-4 bg-gray-50 rounded-xl border">
          <label className="text-xs text-gray-400">User ID</label>
          <p className="font-bold">
            {profile?.km_id || "Pending"}
          </p>
        </div>

        <div className="p-4 bg-gray-50 rounded-xl border">
          <label className="text-xs text-gray-400">Full Name</label>
          <p className="font-bold">
            {profile?.full_name || "-"}
          </p>
        </div>

        <div className="p-4 bg-gray-50 rounded-xl border">
          <label className="text-xs text-gray-400">Email</label>
          <p className="font-bold">
            {profile?.email || "-"}
          </p>
        </div>

        <div className="p-4 bg-gray-50 rounded-xl border">
          <label className="text-xs text-gray-400">Phone</label>
          <p className="font-bold">
            {profile?.phone || "-"}
          </p>
        </div>

      </div>

      <button
        onClick={handleLogout}
        className="w-full rounded-lg bg-red-600 py-2 text-white font-semibold hover:bg-red-700"
      >
        Log Out
      </button>

    </div>
  );
}