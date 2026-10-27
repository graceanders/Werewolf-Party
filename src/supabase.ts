import { createClient } from '@supabase/supabase-js';

// Both values are public by design (the publishable key is safe in browser code);
// row-level security in supabase/migrations decides what each player can read.
const url = import.meta.env.VITE_SUPABASE_URL ?? 'https://xjtuhraxdwqqhpmfcnmh.supabase.co';
const key = import.meta.env.VITE_SUPABASE_KEY ?? 'sb_publishable_9qXCCDDXOt3_-zDAom-f1w_4DUUheQ2';

export const supabase = createClient(url, key);

/** Everyone plays as an anonymous Supabase user; the session lives in this browser. */
export async function ensureSession(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session.user.id;
  const { data: created, error } = await supabase.auth.signInAnonymously();
  if (error || !created.user) throw new Error(error?.message ?? 'Could not sign in');
  return created.user.id;
}

export async function rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}
