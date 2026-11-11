import { createClient } from '@supabase/supabase-js';
import { captureBrowserAuthCallback, stripBrowserAuthCallback } from './recoveryCallback';

const supabaseUrl = 'https://qslfgnrivaacfwsojjhh.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFzbGZnbnJpdmFhY2Z3c29qamhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5MDY4MTYsImV4cCI6MjA5OTQ4MjgxNn0.qQEN8AzTl-3xJ-lNx71FZXKV0VMcMCNYns7HUUDoyDo';

// Read the recovery callback before the client is constructed. createClient starts
// auth initialization immediately and copies URL parameters before its first await.
captureBrowserAuthCallback();

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Pin the auth-js 2.110 default. PKCE would store a code verifier in the
    // browser that requested the email, so a reset link opened on another device
    // could not be exchanged. Implicit recovery redirects with #access_token and
    // type=recovery, which this client detects and reports as PASSWORD_RECOVERY.
    flowType: 'implicit',
    detectSessionInUrl: true,
  },
});

// Initialization has already copied any fragment or query into the client.
// Remove tokens and provider errors from the address bar and history entry.
stripBrowserAuthCallback();