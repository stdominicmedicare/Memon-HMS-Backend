/**
 * Auth middleware: verify Supabase JWT from Authorization: Bearer <token>.
 * Attaches req.user (id, email), req.role and req.profile from profiles table.
 * Profile is fetched with service role so it always succeeds for a valid user (no RLS blocking).
 */
import { createClient } from '@supabase/supabase-js';
import { supabase as supabaseAdmin } from '../config/supabase.js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

export async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

  if (!token || typeof token !== 'string') {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const client = createClient(supabaseUrl || '', supabaseAnonKey || '', {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  let user;
  let authError;
  try {
    const result = await client.auth.getUser(token);
    user = result?.data?.user;
    authError = result?.error;
  } catch (err) {
    // Supabase can throw e.g. "Cannot read properties of undefined (reading 'payload')" when token is malformed
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // Use service role so profile fetch never blocks on RLS (avoids frontend profile timeout)
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, email, role, full_name')
    .eq('id', user.id)
    .single();

  req.user = { id: user.id, email: user.email };
  req.role = profile?.role || null;
  req.profile = profile;
  next();
}
