import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qslfgnrivaacfwsojjhh.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFzbGZnbnJpdmFhY2Z3c29qamhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5MDY4MTYsImV4cCI6MjA5OTQ4MjgxNn0.qQEN8AzTl-3xJ-lNx71FZXKV0VMcMCNYns7HUUDoyDo' ;


export const supabase = createClient(supabaseUrl, supabaseAnonKey);