/**
 * Doctor API: patients, appointments (accept/reject), medical records, prescriptions. Scoped to req.user.id (doctor_id).
 */
import { supabase } from '../config/supabase.js';

export async function getPatients(req, res) {
  try {
    const doctorId = req.user.id;
    const [appointmentsRes, recordsRes] = await Promise.all([
      supabase.from('appointments').select('patient_id').eq('doctor_id', doctorId),
      supabase.from('medical_records').select('patient_id').eq('doctor_id', doctorId),
    ]);
    const fromApts = (appointmentsRes.data || []).map((a) => a.patient_id);
    const fromRecords = (recordsRes.data || []).map((r) => r.patient_id);
    const patientIds = [...new Set([...fromApts, ...fromRecords])];
    if (patientIds.length === 0) return res.json([]);
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', patientIds)
      .order('full_name');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getAppointments(req, res) {
  try {
    const doctorId = req.user.id;
    const { data: rows, error } = await supabase
      .from('appointments')
      .select('id, scheduled_at, status, notes, created_at, patient_id')
      .eq('doctor_id', doctorId)
      .order('scheduled_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    const patientIds = [...new Set((rows || []).map((r) => r.patient_id).filter(Boolean))];
    const patients =
      patientIds.length > 0
        ? await supabase.from('profiles').select('id, full_name, email').in('id', patientIds)
        : { data: [] };
    const patientMap = Object.fromEntries((patients.data || []).map((p) => [p.id, p]));
    const data = (rows || []).map((r) => ({
      ...r,
      patient: patientMap[r.patient_id] || null,
    }));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function updateAppointmentStatus(req, res) {
  try {
    const doctorId = req.user.id;
    const { id } = req.params;
    const { status, notes } = req.body;
    if (!['confirmed', 'cancelled', 'completed'].includes(status)) {
      return res.status(400).json({ error: 'status must be confirmed, cancelled, or completed' });
    }
    const payload = { status, updated_at: new Date().toISOString() };
    if (notes != null && String(notes).trim() !== '') payload.notes = String(notes).trim();
    const { data, error } = await supabase
      .from('appointments')
      .update(payload)
      .eq('id', id)
      .eq('doctor_id', doctorId)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Appointment not found' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getRecords(req, res) {
  try {
    const doctorId = req.user.id;
    const { patient_id } = req.query;
    let q = supabase
      .from('medical_records')
      .select('id, patient_id, diagnosis, notes, observations, created_at')
      .eq('doctor_id', doctorId)
      .order('created_at', { ascending: false });
    if (patient_id) q = q.eq('patient_id', patient_id);
    const { data: rows, error } = await q;

    if (error) return res.status(500).json({ error: error.message });
    const patientIds = [...new Set((rows || []).map((r) => r.patient_id).filter(Boolean))];
    const patients =
      patientIds.length > 0
        ? await supabase.from('profiles').select('id, full_name, email').in('id', patientIds)
        : { data: [] };
    const patientMap = Object.fromEntries((patients.data || []).map((p) => [p.id, p]));
    const data = (rows || []).map((r) => ({
      ...r,
      patient: patientMap[r.patient_id] || null,
    }));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function createRecord(req, res) {
  try {
    const doctorId = req.user.id;
    const { patient_id, appointment_id, diagnosis, notes, observations } = req.body;
    if (!patient_id) {
      return res.status(400).json({ error: 'patient_id is required' });
    }
    const { data, error } = await supabase
      .from('medical_records')
      .insert({
        patient_id,
        doctor_id: doctorId,
        appointment_id: appointment_id || null,
        diagnosis: diagnosis || null,
        notes: notes || null,
        observations: observations || null,
      })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getPrescriptions(req, res) {
  try {
    const doctorId = req.user.id;
    const { patient_id } = req.query;
    let q = supabase
      .from('prescriptions')
      .select('id, patient_id, medication, dosage, instructions, frequency, duration, medical_record_id, status, created_at')
      .eq('doctor_id', doctorId)
      .order('created_at', { ascending: false });
    if (patient_id) q = q.eq('patient_id', patient_id);
    const { data: rows, error } = await q;

    if (error) return res.status(500).json({ error: error.message });
    const patientIds = [...new Set((rows || []).map((r) => r.patient_id).filter(Boolean))];
    const patients =
      patientIds.length > 0
        ? await supabase.from('profiles').select('id, full_name, email').in('id', patientIds)
        : { data: [] };
    const patientMap = Object.fromEntries((patients.data || []).map((p) => [p.id, p]));
    const data = (rows || []).map((r) => ({
      ...r,
      patient: patientMap[r.patient_id] || null,
    }));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function createPrescription(req, res) {
  try {
    const doctorId = req.user.id;
    const { patient_id, medication, dosage, instructions, frequency, duration, medical_record_id } = req.body;
    if (!patient_id || !medication) {
      return res.status(400).json({ error: 'patient_id and medication are required' });
    }
    const { data, error } = await supabase
      .from('prescriptions')
      .insert({
        patient_id,
        doctor_id: doctorId,
        medication,
        dosage: dosage || null,
        instructions: instructions || null,
        frequency: frequency || null,
        duration: duration || null,
        medical_record_id: medical_record_id || null,
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

/** Stub: log emergency request (e.g. ambulance). ICU use requestIcuAdmission. */
export async function createEmergencyRequest(req, res) {
  try {
    const doctorId = req.user.id;
    const { type } = req.body;
    if (!['icu', 'ambulance'].includes(type)) {
      return res.status(400).json({ error: 'type must be icu or ambulance' });
    }
    if (type === 'icu') {
      return res.status(400).json({ error: 'Use POST /api/doctor/icu-admission-request for ICU admission' });
    }
    console.log(`[Emergency stub] doctor=${doctorId} type=${type} at ${new Date().toISOString()}`);
    res.status(201).json({ ok: true, type, message: 'Request logged (stub). Phase 3 will integrate.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** Request ICU admission for a patient. Creates pending request for ICU to approve/reject. */
export async function requestIcuAdmission(req, res) {
  try {
    const doctorId = req.user.id;
    const { patient_id, priority_level, request_notes } = req.body;
    if (!patient_id) return res.status(400).json({ error: 'patient_id is required' });

    const priority = ['low', 'medium', 'high', 'critical'].includes(priority_level) ? priority_level : 'medium';
    const { data, error } = await supabase
      .from('icu_admission_requests')
      .insert({
        patient_id,
        doctor_id: doctorId,
        request_status: 'pending',
        priority_level: priority,
        request_notes: request_notes != null ? String(request_notes).trim() : null,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** List ICU admission requests created by this doctor (for View ICU Patient Progress). */
export async function getMyIcuRequests(req, res) {
  try {
    const doctorId = req.user.id;
    const { data: requests, error } = await supabase
      .from('icu_admission_requests')
      .select('id, patient_id, doctor_id, request_status, priority_level, request_notes, assigned_bed_id, created_at, reviewed_at')
      .eq('doctor_id', doctorId)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) return res.status(500).json({ error: error.message });
    const list = requests || [];
    const patientIds = [...new Set(list.map((r) => r.patient_id))];
    const bedIds = [...new Set(list.map((r) => r.assigned_bed_id).filter(Boolean))];
    const patientMap = {};
    const bedMap = {};
    if (patientIds.length > 0) {
      const { data: patients } = await supabase.from('profiles').select('id, full_name').in('id', patientIds);
      (patients || []).forEach((p) => { patientMap[p.id] = p; });
    }
    if (bedIds.length > 0) {
      const { data: beds } = await supabase.from('icu_beds').select('id, bed_number').in('id', bedIds);
      (beds || []).forEach((b) => { bedMap[b.id] = b; });
    }
    const withDetails = list.map((r) => ({
      ...r,
      patient: patientMap[r.patient_id] || null,
      bed: r.assigned_bed_id ? bedMap[r.assigned_bed_id] || null : null,
    }));
    res.json(withDetails);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** Get read-only ICU monitoring for a patient – only if this doctor requested ICU for that patient. */
export async function getIcuMonitoringForPatient(req, res) {
  try {
    const doctorId = req.user.id;
    const { patient_id } = req.query;
    if (!patient_id) return res.status(400).json({ error: 'patient_id required' });

    const { data: reqRow } = await supabase
      .from('icu_admission_requests')
      .select('id')
      .eq('doctor_id', doctorId)
      .eq('patient_id', patient_id)
      .maybeSingle();
    if (!reqRow) return res.status(403).json({ error: 'Not authorized to view this patient ICU data' });

    const { data: logs, error } = await supabase
      .from('icu_patient_monitoring')
      .select('id, vital_signs, observation_notes, condition_status, recorded_at')
      .eq('patient_id', patient_id)
      .order('recorded_at', { ascending: false })
      .limit(50);
    if (error) return res.status(500).json({ error: error.message });
    res.json(logs || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];

/** Create blood request for a patient (Doctor). */
export async function createBloodRequest(req, res) {
  try {
    const doctorId = req.user.id;
    const { patient_id, blood_group_required, units_required, urgency_level, medical_reason } = req.body;
    if (!patient_id || !blood_group_required || !units_required) {
      return res.status(400).json({ error: 'patient_id, blood_group_required, and units_required are required' });
    }
    if (!BLOOD_GROUPS.includes(blood_group_required)) return res.status(400).json({ error: 'Invalid blood_group_required' });
    const units = Math.max(1, parseInt(units_required, 10) || 1);
    const urgency = ['routine', 'urgent', 'emergency'].includes(urgency_level) ? urgency_level : 'routine';
    const { data, error } = await supabase
      .from('blood_requests')
      .insert({
        patient_id,
        doctor_id: doctorId,
        blood_group_required,
        units_required: units,
        urgency_level: urgency,
        medical_reason: medical_reason != null ? String(medical_reason).trim() : null,
        request_status: 'pending',
      })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
