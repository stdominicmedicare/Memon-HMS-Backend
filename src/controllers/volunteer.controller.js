/**
 * Volunteer module: blood donation volunteer. Profile, availability, view requests, accept, donation history.
 * All operations require Volunteer role.
 */
import { supabase } from '../config/supabase.js';

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];

/** Get current volunteer's profile (from profiles + volunteer_profiles). Ensures volunteer_profiles row exists. */
export async function getProfile(req, res) {
  try {
    const userId = req.user.id;
    const { data: profile, error: pErr } = await supabase
      .from('profiles')
      .select('id, email, full_name, phone, role, is_active')
      .eq('id', userId)
      .single();
    if (pErr || !profile) return res.status(404).json({ error: 'Profile not found' });
    let { data: vp, error: vErr } = await supabase
      .from('volunteer_profiles')
      .select('blood_group, is_available')
      .eq('user_id', userId)
      .maybeSingle();
    if (vErr) return res.status(500).json({ error: vErr.message });
    if (!vp) {
      await supabase.from('volunteer_profiles').insert({
        user_id: userId,
        blood_group: 'O+',
        is_available: false,
        updated_at: new Date().toISOString(),
      });
      vp = { blood_group: 'O+', is_available: false };
    }
    res.json({
      ...profile,
      blood_group: vp?.blood_group ?? null,
      is_available: vp?.is_available ?? false,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** Toggle availability. */
export async function updateAvailability(req, res) {
  try {
    const userId = req.user.id;
    const { is_available } = req.body;
    if (typeof is_available !== 'boolean') {
      return res.status(400).json({ error: 'is_available (boolean) is required' });
    }
    const { data, error } = await supabase
      .from('volunteer_profiles')
      .update({ is_available, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Volunteer profile not found' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** List open blood donation requests (for volunteer dashboard). Optionally filter by volunteer's blood group. */
export async function getDonationRequests(req, res) {
  try {
    const userId = req.user.id;
    const { data: vp } = await supabase
      .from('volunteer_profiles')
      .select('blood_group')
      .eq('user_id', userId)
      .maybeSingle();
    const myBloodGroup = vp?.blood_group ?? null;

    let q = supabase
      .from('blood_donation_requests')
      .select('id, blood_group, quantity_required, location, urgency, status, created_at')
      .eq('status', 'open')
      .order('created_at', { ascending: false });
    if (myBloodGroup) q = q.eq('blood_group', myBloodGroup);
    const { data: requests, error } = await q;
    if (error) return res.status(500).json({ error: error.message });

    const ids = (requests || []).map((r) => r.id);
    const { data: pledges } = ids.length
      ? await supabase.from('volunteer_donations').select('donation_request_id, volunteer_id').eq('volunteer_id', userId)
      : { data: [] };
    const myAcceptedIds = new Set((pledges || []).map((p) => p.donation_request_id));

    const list = (requests || []).map((r) => ({
      ...r,
      accepted_by_me: myAcceptedIds.has(r.id),
    }));
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** Accept a donation request: create volunteer_donation (pending). */
export async function acceptDonationRequest(req, res) {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const { data: vp, error: vpErr } = await supabase
      .from('volunteer_profiles')
      .select('blood_group')
      .eq('user_id', userId)
      .single();
    if (vpErr || !vp) return res.status(404).json({ error: 'Volunteer profile not found' });

    const { data: reqRow, error: reqErr } = await supabase
      .from('blood_donation_requests')
      .select('id, blood_group, status')
      .eq('id', id)
      .single();
    if (reqErr || !reqRow) return res.status(404).json({ error: 'Request not found' });
    if (reqRow.status !== 'open') return res.status(400).json({ error: 'Request is no longer open' });
    if (reqRow.blood_group !== vp.blood_group) {
      return res.status(400).json({ error: 'Blood group does not match this request' });
    }

    const { data: existing } = await supabase
      .from('volunteer_donations')
      .select('id')
      .eq('donation_request_id', id)
      .eq('volunteer_id', userId)
      .maybeSingle();
    if (existing) return res.status(400).json({ error: 'You have already accepted this request' });

    const { data: donation, error: insErr } = await supabase
      .from('volunteer_donations')
      .insert({
        volunteer_id: userId,
        donation_request_id: id,
        status: 'pending',
        accepted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (insErr) return res.status(500).json({ error: insErr.message });
    res.status(201).json(donation);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** Get current volunteer's donation history. */
export async function getMyDonations(req, res) {
  try {
    const userId = req.user.id;
    const { data, error } = await supabase
      .from('volunteer_donations')
      .select(`
        id,
        donation_request_id,
        status,
        accepted_at,
        completed_at,
        notes,
        created_at,
        blood_donation_requests (
          blood_group,
          location,
          urgency
        )
      `)
      .eq('volunteer_id', userId)
      .order('accepted_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    const list = (data || []).map((row) => ({
      id: row.id,
      donation_request_id: row.donation_request_id,
      status: row.status,
      accepted_at: row.accepted_at,
      completed_at: row.completed_at,
      notes: row.notes,
      created_at: row.created_at,
      blood_group: row.blood_donation_requests?.blood_group ?? null,
      location: row.blood_donation_requests?.location ?? null,
      urgency: row.blood_donation_requests?.urgency ?? null,
    }));
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
