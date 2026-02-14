/**
 * Tracking: start, update-status, location (history), stop.
 * Realtime channel is created and used by the frontend; backend validates and updates DB.
 */
import { supabase } from '../config/supabase.js';

const VALID_STATUS_TRANSITIONS = {
  en_route: ['arrived'],
  arrived: ['patient_picked'],
  patient_picked: ['arrived_at_hospital'],
  arrived_at_hospital: [],
};

function getNextValidStatuses(current) {
  return VALID_STATUS_TRANSITIONS[current] || [];
}

async function getTripForDriver(supabaseClient, tripId, driverId) {
  const { data, error } = await supabaseClient
    .from('ambulance_requests')
    .select('id, status, assigned_driver_id, ambulance_id')
    .eq('id', tripId)
    .single();
  if (error || !data) return { trip: null, error: 'Trip not found' };
  if (data.assigned_driver_id !== driverId) return { trip: null, error: 'Not assigned to this trip' };
  return { trip: data };
}

/**
 * POST /api/tracking/start
 * Body: { trip_id: string }
 * Updates trip status to 'en_route', returns trip and channel name.
 */
export async function startTracking(req, res) {
  try {
    const driverId = req.user.id;
    const { trip_id } = req.body || {};

    if (!trip_id || typeof trip_id !== 'string') {
      return res.status(400).json({ error: 'trip_id is required' });
    }

    const { trip, error: authErr } = await getTripForDriver(supabase, trip_id.trim(), driverId);
    if (authErr) {
      const status = authErr === 'Trip not found' ? 404 : 403;
      return res.status(status).json({ error: authErr });
    }
    if (trip.status !== 'assigned') {
      return res.status(400).json({
        error: `Trip must be in 'assigned' status to start tracking (current: ${trip.status})`,
      });
    }

    const { data: updated, error: updateError } = await supabase
      .from('ambulance_requests')
      .update({ status: 'en_route', updated_at: new Date().toISOString() })
      .eq('id', trip_id)
      .select()
      .single();

    if (updateError) return res.status(500).json({ error: updateError.message });

    res.json({
      ok: true,
      trip: updated,
      channel: `ambulance_trip_${trip.id}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * POST /api/tracking/update-status
 * Body: { trip_id: string, status: string } (status: arrived | patient_picked | arrived_at_hospital)
 * Validates driver and status transition, updates DB. Frontend should broadcast status on channel.
 */
export async function updateTrackingStatus(req, res) {
  try {
    const driverId = req.user.id;
    const { trip_id, status } = req.body || {};

    if (!trip_id || typeof trip_id !== 'string') {
      return res.status(400).json({ error: 'trip_id is required' });
    }
    const allowed = ['arrived', 'patient_picked', 'arrived_at_hospital'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${allowed.join(', ')}` });
    }

    const { trip, error: authErr } = await getTripForDriver(supabase, trip_id.trim(), driverId);
    if (authErr) {
      const code = authErr === 'Trip not found' ? 404 : 403;
      return res.status(code).json({ error: authErr });
    }

    const nextOk = getNextValidStatuses(trip.status);
    if (!nextOk.includes(status)) {
      return res.status(400).json({
        error: `Cannot set status to '${status}' from '${trip.status}'. Allowed: ${nextOk.length ? nextOk.join(', ') : 'none'}`,
      });
    }

    const { data: updated, error: updateError } = await supabase
      .from('ambulance_requests')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', trip_id)
      .select()
      .single();

    if (updateError) return res.status(500).json({ error: updateError.message });

    res.json({ ok: true, trip: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * POST /api/tracking/location
 * Body: { trip_id: string, lat: number, lng: number, speed?: number }
 * Validates driver, appends to ambulance_trip_locations. Optionally updates ambulances.current_lat/lng.
 */
export async function recordLocation(req, res) {
  try {
    const driverId = req.user.id;
    const { trip_id, lat, lng, speed } = req.body || {};

    if (!trip_id || typeof lat !== 'number' || typeof lng !== 'number') {
      return res.status(400).json({ error: 'trip_id, lat, and lng are required' });
    }
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      return res.status(400).json({ error: 'lat and lng must be numbers' });
    }

    const { trip, error: authErr } = await getTripForDriver(supabase, trip_id.trim(), driverId);
    if (authErr) {
      const code = authErr === 'Trip not found' ? 404 : 403;
      return res.status(code).json({ error: authErr });
    }
    if (!['en_route', 'arrived', 'patient_picked', 'arrived_at_hospital'].includes(trip.status)) {
      return res.status(400).json({ error: 'Trip is not in an active tracking status' });
    }

    const speedVal = typeof speed === 'number' && !Number.isNaN(speed) ? speed : null;

    const { error: insertErr } = await supabase.from('ambulance_trip_locations').insert({
      trip_id: trip.id,
      lat,
      lng,
      speed_kmh: speedVal,
    });

    if (insertErr) return res.status(500).json({ error: insertErr.message });

    if (trip.ambulance_id) {
      await supabase
        .from('ambulances')
        .update({
          current_lat: lat,
          current_lng: lng,
          location_updated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', trip.ambulance_id);
      // Ignore errors if optional columns (current_lat, etc.) don't exist
    }

    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * POST /api/tracking/stop
 * Body: { trip_id: string, trip_notes?: string }
 * Validates driver, sets trip to completed (and optional trip_notes), sets ambulance to Available.
 */
export async function stopTracking(req, res) {
  try {
    const driverId = req.user.id;
    const { trip_id, trip_notes } = req.body || {};

    if (!trip_id || typeof trip_id !== 'string') {
      return res.status(400).json({ error: 'trip_id is required' });
    }

    const { trip, error: authErr } = await getTripForDriver(supabase, trip_id.trim(), driverId);
    if (authErr) {
      const code = authErr === 'Trip not found' ? 404 : 403;
      return res.status(code).json({ error: authErr });
    }
    if (!['en_route', 'arrived', 'patient_picked', 'arrived_at_hospital'].includes(trip.status)) {
      return res.status(400).json({ error: 'Trip is not active' });
    }

    const updates = {
      status: 'completed',
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (trip_notes !== undefined && typeof trip_notes === 'string') {
      updates.trip_notes = trip_notes.trim() || null;
    }

    const { data: updated, error: updateError } = await supabase
      .from('ambulance_requests')
      .update(updates)
      .eq('id', trip_id)
      .select()
      .single();

    if (updateError) return res.status(500).json({ error: updateError.message });

    if (trip.ambulance_id) {
      await supabase
        .from('ambulances')
        .update({ status: 'Available', updated_at: new Date().toISOString() })
        .eq('id', trip.ambulance_id);
    }

    res.json({ ok: true, trip: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
