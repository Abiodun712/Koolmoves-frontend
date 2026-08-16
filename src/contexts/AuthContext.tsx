import React, { createContext, useContext, useEffect, useState } from 'react';
import { type User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabaseClient';

interface Profile {
  user_id: string;
  km_id: string;
  email: string;
  full_name: string;
  phone: string;
  role: string;
}

interface AuthContextType {
  user: User | null;
  profile: Profile | null;
  role: string | null;
  loading: boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (!error && data) {
      setProfile(data);
    } else {
      setProfile(null);
    }
  };

  useEffect(() => {
    let cancelled = false;

    // Initial session: wait for profile so RequireAdmin has role before first paint.
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (cancelled) return;
      setUser(session?.user ?? null);
      if (session?.user) {
        await fetchProfile(session.user.id);
      } else {
        setProfile(null);
      }
      if (!cancelled) setLoading(false);
    });

    // Must stay synchronous: awaiting inside this callback holds the auth lock
    // and can stall every Supabase query (saves, upserts, etc.).
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);

      if (event === 'INITIAL_SESSION') {
        return;
      }

      if (!session?.user) {
        setProfile(null);
        setLoading(false);
        return;
      }

      if (event === 'TOKEN_REFRESHED') {
        setLoading(false);
        return;
      }

      void fetchProfile(session.user.id);
      setLoading(false);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const logout = async () => {
    await supabase.auth.signOut();
    setProfile(null);
  };

  return (
    <AuthContext.Provider value={{ user, profile, role: profile?.role ?? null, loading, logout }}>
      {!loading && children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an AuthProvider');
  return context;
};