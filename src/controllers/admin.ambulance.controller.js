/**
 * Admin: ambulance CRUD and request assignment.
 */
import { supabase } from '../config/supabase.js';

const AMBULANCE_STATUSES = ['Available', 'On Duty', 'Maintenance', 'Offline'];
const AMBULANCE_TYPES = ['Basic', 'Advanced', 'ICU', 'Emergency'];

export async function getAmbulances(req, res) {
  try {
    const { data, error } = await supabase
      .from('ambulances')
      .select('id, vehicle_number, ambulance_type, equipment_details, status, current_location, driver_id, created_at, updated_at')
      .order('vehicle_number');

    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function createAmbulance(req, res) {
  try {
    const { vehicle_number, ambulance_type, equipment_details, status, current_location, driver_id } = req.body;
    if (!vehicle_number || !ambulance_type) {
      return res.status(400).json({ error: 'vehicle_number and ambulance_type are required' });
    }
    if (!AMBULANCE_TYPES.includes(ambulance_type)) {
      return res.status(400).json({ error: `ambulance_type must be one of: ${AMBULANCE_TYPES.join(', ')}` });
    }

    const insert = {
      vehicle_number: String(vehicle_number).trim(),
      ambulance_type,
      equipment_details: equipment_details || null,
      status: AMBULANCE_STATUSES.includes(status) ? status : 'Available',
      current_location: current_location || null,
      driver_id: driver_id || null,
    };

    const { data, error } = await supabase.from('ambulances').insert(insert).select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function updateAmbulance(req, res) {
  try {
    const { id } = req.params;
    const { vehicle_number, ambulance_type, equipment_details, status, current_location, driver_id } = req.body;

    const updates = { updated_at: new Date().toISOString() };
    if (vehicle_number !== undefined) updates.vehicle_number = String(vehicle_number).trim();
    if (ambulance_type !== undefined) {
      if (!AMBULANCE_TYPES.includes(ambulance_type)) return res.status(400).json({ error: 'Invalid ambulance_type' });
      updates.ambulance_type = ambulance_type;
    }
    if (equipment_details !== undefined) updates.equipment_details = equipment_details || null;
    if (status !== undefined) {
      if (!AMBULANCE_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
      updates.status = status;
    }
    if (current_location !== undefined) updates.current_location = current_location || null;
    if (driver_id !== undefined) updates.driver_id = driver_id || null;

    const { data, error } = await supabase.from('ambulances').update(updates).eq('id', id).select().single();
    if (error) return res.status(400).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Ambulance not found' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function deleteAmbulance(req, res) {
  try {
    const { id } = req.params;
    const { error } = await supabase.from('ambulances').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getAmbulanceRequests(req, res) {
  try {
    const { data, error } = await supabase
      .from('ambulance_requests')
      .select('id, patient_id, doctor_id, from_address, to_address, priority, status, ambulance_id, assigned_driver_id, requested_at, notes, created_at, updated_at')
      .order('requested_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function assignAmbulanceRequest(req, res) {
  try {
    const { id } = req.params;
    const { ambulance_id, assigned_driver_id } = req.body;

    const { data: request } = await supabase.from('ambulance_requests').select('id, status').eq('id', id).single();
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.status !== 'pending') return res.status(400).json({ error: 'Only pending requests can be assigned' });

    const updates = { status: 'assigned', updated_at: new Date().toISOString() };
    if (ambulance_id) updates.ambulance_id = ambulance_id;
    if (assigned_driver_id) updates.assigned_driver_id = assigned_driver_id;

    const { data, error } = await supabase.from('ambulance_requests').update(updates).eq('id', id).select().single();
    if (error) return res.status(400).json({ error: error.message });

    if (ambulance_id) {
      await supabase.from('ambulances').update({ status: 'On Duty', updated_at: new Date().toISOString() }).eq('id', ambulance_id);
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** List profiles with role Ambulance (for driver dropdown). */
export async function getAmbulanceDrivers(req, res) {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .eq('role', 'Ambulance')
      .eq('is_active', true)
      .order('full_name');

    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

const ACTIVE_TRIP_STATUSES = ['en_route', 'arrived', 'patient_picked', 'arrived_at_hospital'];

/** Fleet view: all ambulances + active trips with driver, last_completed_at for map and modal. */
export async function getFleetStatus(req, res) {
  try {
    const [ambulancesRes, tripsRes, completedRes] = await Promise.all([
      supabase.from('ambulances').select('id, vehicle_number, status, ambulance_type, driver_id, current_location').order('vehicle_number'),
      supabase
        .from('ambulance_requests')
        .select('id, ambulance_id, status, from_address, to_address, patient_id, assigned_driver_id, requested_at')
        .in('status', ACTIVE_TRIP_STATUSES)
        .order('requested_at', { ascending: false }),
      supabase
        .from('ambulance_requests')
        .select('ambulance_id, completed_at')
        .eq('status', 'completed')
        .not('completed_at', 'is', null)
        .order('completed_at', { ascending: false }),
    ]);

    const ambulances = ambulancesRes.data || [];
    const trips = tripsRes.data || [];
    const completedList = completedRes.data || [];

    const lastCompletedByAmbulance = {};
    completedList.forEach((r) => {
      if (r.ambulance_id && !lastCompletedByAmbulance[r.ambulance_id]) {
        lastCompletedByAmbulance[r.ambulance_id] = r.completed_at;
      }
    });

    const driverIds = [
      ...new Set([
        ...trips.map((t) => t.assigned_driver_id).filter(Boolean),
        ...ambulances.map((a) => a.driver_id).filter(Boolean),
      ]),
    ];
    let driverMap = {};
    if (driverIds.length > 0) {
      const { data: drivers } = await supabase.from('profiles').select('id, full_name, phone').in('id', driverIds);
      driverMap = Object.fromEntries((drivers || []).map((d) => [d.id, d]));
    }

    const patientIds = [...new Set(trips.map((t) => t.patient_id).filter(Boolean))];
    const ambulanceIdsForTrips = [...new Set(trips.map((t) => t.ambulance_id).filter(Boolean))];
    let patientMap = {};
    let ambulanceMap = {};
    if (patientIds.length > 0) {
      const { data: patients } = await supabase.from('profiles').select('id, full_name').in('id', patientIds);
      patientMap = Object.fromEntries((patients || []).map((p) => [p.id, p]));
    }
    if (ambulanceIdsForTrips.length > 0) {
      const { data: ambs } = await supabase.from('ambulances').select('id, vehicle_number').in('id', ambulanceIdsForTrips);
      ambulanceMap = Object.fromEntries((ambs || []).map((a) => [a.id, a]));
    }

    const activeTrips = trips.map((t) => ({
      ...t,
      patient: t.patient_id ? patientMap[t.patient_id] || null : null,
      driver: t.assigned_driver_id ? driverMap[t.assigned_driver_id] || null : null,
      ambulance: t.ambulance_id ? ambulanceMap[t.ambulance_id] || null : null,
    }));

    const ambulancesWithDetails = ambulances.map((a) => ({
      ...a,
      driver: a.driver_id ? driverMap[a.driver_id] || null : null,
      last_completed_at: lastCompletedByAmbulance[a.id] || null,
    }));

    const stats = {
      totalAmbulances: ambulances.length,
      available: ambulances.filter((a) => a.status === 'Available').length,
      onDuty: ambulances.filter((a) => a.status === 'On Duty').length,
      activeTripsCount: activeTrips.length,
      returning: ambulances.filter((a) => a.status === 'On Duty' && !trips.some((t) => t.ambulance_id === a.id)).length,
      offline: ambulances.filter((a) => a.status === 'Offline').length,
      maintenance: ambulances.filter((a) => a.status === 'Maintenance').length,
    };

    res.json({ ambulances: ambulancesWithDetails, activeTrips, stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
