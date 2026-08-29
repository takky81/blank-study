import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'VITE_SUPABASE_URL と VITE_SUPABASE_ANON_KEY が設定されていません。' +
      '.env.example を .env.local にコピーし、npm run db:status の値を書き写してください。',
  );
}

export const supabase = createClient(url, anonKey);
