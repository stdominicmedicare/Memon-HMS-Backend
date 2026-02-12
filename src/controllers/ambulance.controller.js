/**
 * Ambulance module: driver dashboard, status updates, accept/start trip.
 * All operations scoped to req.user.id (driver = Ambulance role).
 */
import { supabase } from '../config/supabase.js';

/** Get dashboard for current driver: assigned ambulance, stats, trip requests. */
export async function getDashboard(req, res) {
  try {
    const driverId = req.user.id;

    const { data: ambulance, error: ambError } = await supabase
      .from('ambulances')
      .select('id, vehicle_number, ambulance_type, status, current_location')
      .eq('driver_id', driverId)
      .maybeSingle();

    if (ambError) return res.status(500).json({ error: ambError.message });

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { data: pendingRequests } = await supabase
      .from('ambulance_requests')
      .select('id, patient_id, from_address, to_address, priority, status, requested_at, notes')
      .eq('status', 'pending')
      .order('requested_at', { ascending: false })
      .limit(20);

    const { data: assignedToMe } = await supabase
      .from('ambulance_requests')
      .select('id, patient_id, from_address, to_address, priority, status, requested_at, notes')
      .eq('assigned_driver_id', driverId)
      .in('status', ['assigned', 'en_route', 'arrived', 'patient_picked'])
      .order('requested_at', { ascending: false });

    const { data: completedByMe } = await supabase
      .from('ambulance_requests')
      .select('id, patient_id, from_address, to_address, priority, status, requested_at, completed_at, trip_notes')
      .eq('assigned_driver_id', driverId)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(50);

    const tripsToday = (completedByMe || []).filter(
      (r) => r.completed_at && new Date(r.completed_at) >= todayStart
    ).length;

    const completedWithTimes = (completedByMe || []).filter((r) => r.completed_at && r.requested_at);
    const avgResponseMins = completedWithTimes.length
      ? Math.round(
          completedWithTimes.reduce((sum, r) => sum + (new Date(r.completed_at) - new Date(r.requested_at)) / 60000, 0) / completedWithTimes.length
        )
      : 0;
    const distanceKm = 0;

    const allRequestIds = [...new Set([
      ...(assignedToMe || []).map((r) => r.patient_id),
      ...(pendingRequests || []).map((r) => r.patient_id),
    ].filter(Boolean))];
    const patientMap = {};
    if (allRequestIds.length > 0) {
      const { data: patients } = await supabase.from('profiles').select('id, full_name').in('id', allRequestIds);
      (patients || []).forEach((p) => { patientMap[p.id] = p; });
    }

    const completedPatientIds = [...new Set((completedByMe || []).map((r) => r.patient_id).filter(Boolean))];
    completedPatientIds.forEach((id) => { if (!patientMap[id]) allRequestIds.push(id); });
    if (completedPatientIds.length > 0) {
      const { data: completedPatients } = await supabase.from('profiles').select('id, full_name').in('id', completedPatientIds);
      (completedPatients || []).forEach((p) => { patientMap[p.id] = p; });
    }

    const tripRequests = [
      ...(assignedToMe || []).map((r) => ({ ...r, _source: 'assigned', patient: patientMap[r.patient_id] || null })),
      ...(pendingRequests || []).filter(
        (p) => !(assignedToMe || []).some((a) => a.id === p.id)
      ).map((r) => ({ ...r, _source: 'pending', patient: patientMap[r.patient_id] || null })),
    ].sort((a, b) => new Date(b.requested_at) - new Date(a.requested_at));

    const tripHistory = (completedByMe || []).map((r) => ({ ...r, patient: patientMap[r.patient_id] || null }));

    res.json({
      ambulance: ambulance || null,
      stats: {
        tripsToday,
        avgResponseMins,
        distanceKm,
        status: ambulance?.status || 'Available',
      },
      tripRequests,
      tripHistory,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** Update current driver's ambulance status and/or location. */
export async function updateStatus(req, res) {
  try {
    const driverId = req.user.id;
    const { status, current_location } = req.body;

    const { data: ambulance } = await supabase
      .from('ambulances')
      .select('id')
      .eq('driver_id', driverId)
      .maybeSingle();

    if (!ambulance) return res.status(404).json({ error: 'No ambulance assigned to you' });

    const updates = { updated_at: new Date().toISOString() };
    if (['Available', 'On Duty', 'Maintenance', 'Offline'].includes(status)) updates.status = status;
    if (current_location !== undefined) updates.current_location = String(current_location).trim() || null;

    const { data, error } = await supabase
      .from('ambulances')
      .update(updates)
      .eq('id', ambulance.id)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** Accept a pending trip (assign driver's ambulance to request). */
export async function acceptTrip(req, res) {
  try {
    const driverId = req.user.id;
    const { id } = req.params;

    const { data: ambulance } = await supabase
      .from('ambulances')
      .select('id')
      .eq('driver_id', driverId)
      .maybeSingle();

    if (!ambulance) return res.status(404).json({ error: 'No ambulance assigned to you' });

    const { data: request } = await supabase
      .from('ambulance_requests')
      .select('id, status')
      .eq('id', id)
      .single();

    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.status !== 'pending') return res.status(400).json({ error: 'Request is not pending' });

    const { data, error } = await supabase
      .from('ambulance_requests')
      .update({
        status: 'assigned',
        ambulance_id: ambulance.id,
        assigned_driver_id: driverId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    await supabase
      .from('ambulances')
      .update({ status: 'On Duty', updated_at: new Date().toISOString() })
      .eq('id', ambulance.id);

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** Reject a pending request (driver declines) or unassign an already-accepted request. */
export async function rejectTrip(req, res) {
  try {
    const driverId = req.user.id;
    const { id } = req.params;

    const { data: request } = await supabase
      .from('ambulance_requests')
      .select('id, status, assigned_driver_id, ambulance_id')
      .eq('id', id)
      .single();

    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.assigned_driver_id !== driverId) return res.status(403).json({ error: 'Not your trip' });
    if (!['assigned', 'en_route', 'arrived', 'patient_picked'].includes(request.status)) {
      return res.status(400).json({ error: 'Can only reject assigned or in-progress trips' });
    }

    const { data, error } = await supabase
      .from('ambulance_requests')
      .update({
        status: 'pending',
        ambulance_id: null,
        assigned_driver_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    if (request.ambulance_id) {
      await supabase
        .from('ambulances')
        .update({ status: 'Available', updated_at: new Date().toISOString() })
        .eq('id', request.ambulance_id);
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** Start trip (set request to en_route). */
export async function startTrip(req, res) {
  try {
    const driverId = req.user.id;
    const { id } = req.params;

    const { data: request } = await supabase
      .from('ambulance_requests')
      .select('id, status, assigned_driver_id')
      .eq('id', id)
      .single();

    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.assigned_driver_id !== driverId) return res.status(403).json({ error: 'Not your trip' });
    if (request.status !== 'assigned') return res.status(400).json({ error: 'Trip must be accepted first' });

    const { data, error } = await supabase
      .from('ambulance_requests')
      .update({ status: 'en_route', updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** Mark arrived at pickup location. */
export async function arrivedTrip(req, res) {
  try {
    const driverId = req.user.id;
    const { id } = req.params;

    const { data: request } = await supabase
      .from('ambulance_requests')
      .select('id, status, assigned_driver_id')
      .eq('id', id)
      .single();

    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.assigned_driver_id !== driverId) return res.status(403).json({ error: 'Not your trip' });
    if (request.status !== 'en_route') return res.status(400).json({ error: 'Trip must be en route first' });

    const { data, error } = await supabase
      .from('ambulance_requests')
      .update({ status: 'arrived', updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** Mark patient picked up. */
export async function patientPickedTrip(req, res) {
  try {
    const driverId = req.user.id;
    const { id } = req.params;

    const { data: request } = await supabase
      .from('ambulance_requests')
      .select('id, status, assigned_driver_id')
      .eq('id', id)
      .single();

    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.assigned_driver_id !== driverId) return res.status(403).json({ error: 'Not your trip' });
    if (request.status !== 'arrived') return res.status(400).json({ error: 'Mark arrived first' });

    const { data, error } = await supabase
      .from('ambulance_requests')
      .update({ status: 'patient_picked', updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** Complete trip (with optional trip notes). */
export async function completeTrip(req, res) {
  try {
    const driverId = req.user.id;
    const { id } = req.params;
    const { trip_notes } = req.body || {};

    const { data: request } = await supabase
      .from('ambulance_requests')
      .select('id, status, assigned_driver_id, ambulance_id')
      .eq('id', id)
      .single();

    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.assigned_driver_id !== driverId) return res.status(403).json({ error: 'Not your trip' });
    if (!['assigned', 'en_route', 'arrived', 'patient_picked'].includes(request.status)) return res.status(400).json({ error: 'Invalid status' });

    const updates = { status: 'completed', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    if (trip_notes !== undefined) updates.trip_notes = String(trip_notes).trim() || null;

    const { data, error } = await supabase
      .from('ambulance_requests')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    if (request.ambulance_id) {
      await supabase
        .from('ambulances')
        .update({ status: 'Available', updated_at: new Date().toISOString() })
        .eq('id', request.ambulance_id);
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
