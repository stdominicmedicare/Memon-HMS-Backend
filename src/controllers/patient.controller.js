/**
 * Patient API: appointments, records, prescriptions. All scoped to req.user.id (patient_id).
 */
import { supabase } from '../config/supabase.js';
import { writeAuditLog } from '../services/auditService.js';

export async function getDoctors(req, res) {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, email, specialty')
      .eq('role', 'Doctor')
      .eq('is_active', true)
      .order('full_name');

    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getAppointments(req, res) {
  try {
    const patientId = req.user.id;
    const { data: rows, error } = await supabase
      .from('appointments')
      .select('id, scheduled_at, status, notes, created_at, doctor_id')
      .eq('patient_id', patientId)
      .order('scheduled_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    const doctorIds = [...new Set((rows || []).map((r) => r.doctor_id).filter(Boolean))];
    const doctors =
      doctorIds.length > 0
        ? await supabase.from('profiles').select('id, full_name, specialty').in('id', doctorIds)
        : { data: [] };
    const doctorMap = Object.fromEntries((doctors.data || []).map((d) => [d.id, d]));
    const data = (rows || []).map((r) => ({
      ...r,
      doctor: doctorMap[r.doctor_id] || null,
    }));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function bookAppointment(req, res) {
  try {
    const patientId = req.user.id;
    const { doctor_id, scheduled_at, notes } = req.body;
    if (!doctor_id || !scheduled_at) {
      return res.status(400).json({ error: 'doctor_id and scheduled_at are required' });
    }
    const { data, error } = await supabase
      .from('appointments')
      .insert({
        patient_id: patientId,
        doctor_id,
        scheduled_at: new Date(scheduled_at).toISOString(),
        notes: notes || null,
        status: 'pending',
      })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getRecords(req, res) {
  try {
    const patientId = req.user.id;
    const { data: rows, error } = await supabase
      .from('medical_records')
      .select('id, diagnosis, notes, created_at, doctor_id')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    const doctorIds = [...new Set((rows || []).map((r) => r.doctor_id).filter(Boolean))];
    const doctors =
      doctorIds.length > 0
        ? await supabase.from('profiles').select('id, full_name, specialty').in('id', doctorIds)
        : { data: [] };
    const doctorMap = Object.fromEntries((doctors.data || []).map((d) => [d.id, d]));
    const data = (rows || []).map((r) => ({
      ...r,
      doctor: doctorMap[r.doctor_id] || null,
    }));

    await writeAuditLog({
      actorId: patientId,
      actorEmail: req.user.email,
      actorRole: req.role,
      action: 'view',
      resourceType: 'medical_record',
      patientId,
      metadata: { count: data.length, scoped: 'patient_self' },
      req,
    });

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getPrescriptions(req, res) {
  try {
    const patientId = req.user.id;
    const { data: rows, error } = await supabase
      .from('prescriptions')
      .select('id, medication, dosage, instructions, status, created_at, doctor_id')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    const doctorIds = [...new Set((rows || []).map((r) => r.doctor_id).filter(Boolean))];
    const doctors =
      doctorIds.length > 0
        ? await supabase.from('profiles').select('id, full_name, specialty').in('id', doctorIds)
        : { data: [] };
    const doctorMap = Object.fromEntries((doctors.data || []).map((d) => [d.id, d]));
    const data = (rows || []).map((r) => ({
      ...r,
      doctor: doctorMap[r.doctor_id] || null,
    }));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getDashboardStats(req, res) {
  try {
    const patientId = req.user.id;
    const [appointmentsRes, recordsRes, prescriptionsRes] = await Promise.all([
      supabase.from('appointments').select('id', { count: 'exact', head: true }).eq('patient_id', patientId).in('status', ['pending', 'confirmed']),
      supabase.from('medical_records').select('id', { count: 'exact', head: true }).eq('patient_id', patientId),
      supabase.from('prescriptions').select('id', { count: 'exact', head: true }).eq('patient_id', patientId).in('status', ['active', 'pending', 'dispensed']),
    ]);
    const upcomingAppointments = appointmentsRes.count ?? 0;
    const medicalRecords = recordsRes.count ?? 0;
    const activePrescriptions = prescriptionsRes.count ?? 0;
    res.json({
      upcomingAppointments,
      medicalRecords,
      activePrescriptions,
      healthScore: 85,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** Default depot for ambulances without coordinates (patient map awareness). */
const PATIENT_MAP_DEPOT = { lat: 40.7128, lng: -74.006 };

function parseCurrentLocation(current_location) {
  if (!current_location || typeof current_location !== 'string') return null;
  const trimmed = current_location.trim();
  let lat; let lng;
  if (trimmed.startsWith('{')) {
    try {
      const o = JSON.parse(trimmed);
      lat = typeof o.lat === 'number' ? o.lat : parseFloat(o.lat);
      lng = typeof o.lng === 'number' ? o.lng : parseFloat(o.lng);
    } catch {
      return null;
    }
  } else {
    const parts = trimmed.split(/[,;\s]+/);
    if (parts.length >= 2) {
      lat = parseFloat(parts[0]);
      lng = parseFloat(parts[1]);
    } else return null;
  }
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  return { lat, lng };
}

/** Get ambulance availability for patient map: vehicle_number, status, lat, lng (no PII). */
export async function getAmbulanceAvailability(req, res) {
  try {
    const { data: ambulances, error } = await supabase
      .from('ambulances')
      .select('id, vehicle_number, status, current_location')
      .order('vehicle_number');

    if (error) return res.status(500).json({ error: error.message });

    const list = (ambulances || []).map((a) => {
      const loc = parseCurrentLocation(a.current_location) || PATIENT_MAP_DEPOT;
      return {
        id: a.id,
        vehicle_number: a.vehicle_number,
        status: a.status,
        lat: loc.lat,
        lng: loc.lng,
      };
    });

    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** Get current patient's active trip (en_route, arrived, patient_picked, arrived_at_hospital) with driver and ambulance info. */
export async function getActiveAmbulanceTrip(req, res) {
  try {
    const patientId = req.user.id;
    const { data: trip, error: tripError } = await supabase
      .from('ambulance_requests')
      .select('id, from_address, to_address, priority, status, requested_at, assigned_driver_id, ambulance_id')
      .eq('patient_id', patientId)
      .in('status', ['en_route', 'arrived', 'patient_picked', 'arrived_at_hospital'])
      .order('requested_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (tripError) return res.status(500).json({ error: tripError.message });
    if (!trip) return res.json(null);

    const driverId = trip.assigned_driver_id;
    const ambulanceId = trip.ambulance_id;
    let driver = null;
    let ambulance = null;
    if (driverId) {
      const { data: p } = await supabase.from('profiles').select('id, full_name, phone').eq('id', driverId).single();
      driver = p;
    }
    if (ambulanceId) {
      const { data: a } = await supabase.from('ambulances').select('id, vehicle_number').eq('id', ambulanceId).single();
      ambulance = a;
    }

    res.json({
      ...trip,
      driver: driver ? { id: driver.id, full_name: driver.full_name, phone: driver.phone } : null,
      ambulance: ambulance ? { id: ambulance.id, vehicle_number: ambulance.vehicle_number } : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** Get current patient's ambulance requests. */
export async function getAmbulanceRequests(req, res) {
  try {
    const patientId = req.user.id;
    const { data, error } = await supabase
      .from('ambulance_requests')
      .select('id, from_address, to_address, priority, status, requested_at, created_at')
      .eq('patient_id', patientId)
      .order('requested_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** Create ambulance request (patient). */
export async function createAmbulanceRequest(req, res) {
  try {
    const patientId = req.user.id;
    const { from_address, to_address, priority } = req.body;
    if (!from_address || !to_address) {
      return res.status(400).json({ error: 'from_address and to_address are required' });
    }
    const pr = ['High', 'Medium', 'Low'].includes(priority) ? priority : 'Medium';
    const { data, error } = await supabase
      .from('ambulance_requests')
      .insert({
        patient_id: patientId,
        from_address: String(from_address).trim(),
        to_address: String(to_address).trim(),
        priority: pr,
        status: 'pending',
      })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** Cancel ambulance request (only if status is pending). */
export async function cancelAmbulanceRequest(req, res) {
  try {
    const patientId = req.user.id;
    const { id } = req.params;

    const { data: row } = await supabase
      .from('ambulance_requests')
      .select('id, status')
      .eq('id', id)
      .eq('patient_id', patientId)
      .single();

    if (!row) return res.status(404).json({ error: 'Request not found' });
    if (row.status !== 'pending') return res.status(400).json({ error: 'Can only cancel pending requests' });

    const { data, error } = await supabase
      .from('ambulance_requests')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** Get current patient's ICU status (admission request, assigned bed, read-only monitoring summary). */
export async function getIcuStatus(req, res) {
  try {
    const patientId = req.user.id;

    const { data: request } = await supabase
      .from('icu_admission_requests')
      .select('id, request_status, priority_level, assigned_bed_id, created_at, reviewed_at')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!request) return res.json({ request: null, admission: null, bed: null, monitoringSummary: [] });

    let bed = null;
    if (request.assigned_bed_id) {
      const { data: b } = await supabase.from('icu_beds').select('id, bed_number, bed_type, ward, floor').eq('id', request.assigned_bed_id).single();
      bed = b;
    }

    const { data: admission } = await supabase
      .from('icu_admission_records')
      .select('id, admission_time, discharge_time')
      .eq('patient_id', patientId)
      .is('discharge_time', null)
      .maybeSingle();

    const { data: monitoring } = await supabase
      .from('icu_patient_monitoring')
      .select('id, condition_status, recorded_at')
      .eq('patient_id', patientId)
      .order('recorded_at', { ascending: false })
      .limit(20);

    res.json({
      request: { ...request, status: request.request_status },
      admission: admission || null,
      bed,
      monitoringSummary: (monitoring || []).map((m) => ({ condition_status: m.condition_status, recorded_at: m.recorded_at })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** Get patient's own ICU monitoring logs (read-only, for View/Download report). */
export async function getIcuMonitoringReport(req, res) {
  try {
    const patientId = req.user.id;
    const { data, error } = await supabase
      .from('icu_patient_monitoring')
      .select('id, vital_signs, observation_notes, condition_status, recorded_at')
      .eq('patient_id', patientId)
      .order('recorded_at', { ascending: false })
      .limit(100);
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** Get patient's own transfusion history (read-only). */
export async function getTransfusionHistory(req, res) {
  try {
    const patientId = req.user.id;
    const { data: rows, error } = await supabase
      .from('transfusion_logs')
      .select('id, doctor_id, unit_id, request_id, transfusion_time, notes, created_at')
      .eq('patient_id', patientId)
      .order('transfusion_time', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    const doctorIds = [...new Set((rows || []).map((r) => r.doctor_id).filter(Boolean))];
    const doctors = doctorIds.length
      ? await supabase.from('profiles').select('id, full_name').in('id', doctorIds)
      : { data: [] };
    const doctorMap = Object.fromEntries((doctors.data || []).map((d) => [d.id, d]));
    const data = (rows || []).map((r) => ({ ...r, doctor: doctorMap[r.doctor_id] || null }));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
