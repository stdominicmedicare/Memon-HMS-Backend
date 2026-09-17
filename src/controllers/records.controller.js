/**
 * Patient Records: search, duplicate check, staff register, merge, timeline.
 */
import { supabase } from '../config/supabase.js';
import { validatePassword } from '../utils/passwordPolicy.js';
import { writeAuditLog } from '../services/auditService.js';

const PATIENT_SELECT =
  'id, email, full_name, phone, mrn, date_of_birth, role, is_active, merged_into_id, data_consent, data_consent_at, data_consent_method, created_at, updated_at';

const STAFF_ROLES = ['Admin', 'Doctor', 'Nurse', 'Receptionist', 'RecordsOfficer'];

/** Tables with patient_id FK to repoint on merge */
const PATIENT_FK_TABLES = [
  'appointments',
  'medical_records',
  'prescriptions',
  'ambulance_requests',
  'icu_admission_requests',
  'icu_admission_records',
  'icu_patient_monitoring',
  'blood_requests',
  'transfusion_logs',
  'audit_logs',
];

function normalizePhone(phone) {
  if (!phone) return '';
  return String(phone).replace(/[^\d+]/g, '');
}

function namesSimilar(a, b) {
  const na = String(a || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim();
  const nb = String(b || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim();
  if (!na || !nb) return false;
  if (na === nb) return true;
  return na.includes(nb) || nb.includes(na);
}

async function ensureMrn(profileId) {
  const { data } = await supabase.from('profiles').select('id, mrn, role').eq('id', profileId).single();
  if (!data || data.role !== 'Patient') return data;
  if (data.mrn) return data;
  const { data: updated } = await supabase
    .from('profiles')
    .update({ role: 'Patient', updated_at: new Date().toISOString() })
    .eq('id', profileId)
    .select(PATIENT_SELECT)
    .single();
  return updated || data;
}

export async function searchPatients(req, res) {
  try {
    const q = String(req.query.q || '').trim();
    const limit = Math.min(Number(req.query.limit) || 25, 100);

    let query = supabase
      .from('profiles')
      .select(PATIENT_SELECT)
      .eq('role', 'Patient')
      .is('merged_into_id', null)
      .order('full_name', { ascending: true })
      .limit(limit);

    if (q) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q);
      if (isUuid) {
        query = query.eq('id', q);
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(q)) {
        query = query.eq('date_of_birth', q);
      } else {
        const pattern = `%${q}%`;
        query = query.or(
          `full_name.ilike.${pattern},mrn.ilike.${pattern},phone.ilike.${pattern},email.ilike.${pattern}`
        );
      }
    } else {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getPatientRecord(req, res) {
  try {
    const { id } = req.params;
    const { data, error } = await supabase.from('profiles').select(PATIENT_SELECT).eq('id', id).single();
    if (error) return res.status(error.code === 'PGRST116' ? 404 : 500).json({ error: error.message });
    if (data.role !== 'Patient') return res.status(404).json({ error: 'Patient not found' });
    await writeAuditLog({
      actorId: req.user?.id,
      actorEmail: req.user?.email,
      actorRole: req.role,
      action: 'view',
      resourceType: 'patient_record',
      resourceId: id,
      patientId: id,
      req,
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function checkDuplicates(req, res) {
  try {
    const { full_name, phone, date_of_birth, email, exclude_id } = req.body || {};
    if (!full_name && !phone && !date_of_birth && !email) {
      return res.status(400).json({ error: 'Provide full_name, phone, date_of_birth, and/or email' });
    }

    const { data: candidates, error } = await supabase
      .from('profiles')
      .select(PATIENT_SELECT)
      .eq('role', 'Patient')
      .is('merged_into_id', null)
      .eq('is_active', true)
      .limit(200);

    if (error) return res.status(500).json({ error: error.message });

    const normPhone = normalizePhone(phone);
    const matches = [];

    for (const p of candidates || []) {
      if (exclude_id && p.id === exclude_id) continue;
      const reasons = [];
      if (email && p.email && String(p.email).toLowerCase() === String(email).toLowerCase()) {
        reasons.push('email');
      }
      if (normPhone && normalizePhone(p.phone) && normalizePhone(p.phone) === normPhone) {
        reasons.push('phone');
      }
      if (date_of_birth && p.date_of_birth === date_of_birth && namesSimilar(full_name, p.full_name)) {
        reasons.push('name+dob');
      } else if (date_of_birth && p.date_of_birth === date_of_birth && full_name && namesSimilar(full_name, p.full_name) === false) {
        // same DOB alone is weak — skip unless name also similar (handled above)
      }
      if (reasons.length) {
        matches.push({ ...p, match_reasons: reasons });
      }
    }

    res.json({ duplicates: matches, count: matches.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function registerPatient(req, res) {
  try {
    const { email, password, full_name, phone, date_of_birth, force_duplicate, data_consent } = req.body || {};
    if (!email || !password || !full_name) {
      return res.status(400).json({ error: 'email, password, and full_name are required' });
    }
    if (!data_consent) {
      return res.status(400).json({
        error: 'Patient data-storage consent is required before registration',
      });
    }
    const check = validatePassword(password);
    if (!check.ok) return res.status(400).json({ error: check.error });

    if (!force_duplicate) {
      const { data: candidates } = await supabase
        .from('profiles')
        .select(PATIENT_SELECT)
        .eq('role', 'Patient')
        .is('merged_into_id', null)
        .eq('is_active', true)
        .limit(200);
      const normPhone = normalizePhone(phone);
      const duplicates = (candidates || []).filter((p) => {
        if (email && p.email && String(p.email).toLowerCase() === String(email).toLowerCase()) return true;
        if (normPhone && normalizePhone(p.phone) === normPhone) return true;
        if (date_of_birth && p.date_of_birth === date_of_birth && namesSimilar(full_name, p.full_name)) return true;
        return false;
      });
      if (duplicates.length) {
        return res.status(409).json({
          error: 'Possible duplicate patient(s) found',
          code: 'DUPLICATE_PATIENT',
          duplicates,
        });
      }
    }

    const now = new Date().toISOString();
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name,
        role: 'Patient',
        phone: phone || null,
        date_of_birth: date_of_birth || null,
        data_consent: true,
        data_consent_method: 'staff_registration',
      },
    });
    if (authError) return res.status(400).json({ error: authError.message });

    await supabase
      .from('profiles')
      .update({
        full_name,
        phone: phone || null,
        date_of_birth: date_of_birth || null,
        role: 'Patient',
        password_changed_at: now,
        data_consent: true,
        data_consent_at: now,
        data_consent_method: 'staff_registration',
        updated_at: now,
      })
      .eq('id', authData.user.id);

    const profile = await ensureMrn(authData.user.id);
    const { data: finalProfile } = await supabase
      .from('profiles')
      .select(PATIENT_SELECT)
      .eq('id', authData.user.id)
      .single();

    await writeAuditLog({
      actorId: req.user?.id,
      actorEmail: req.user?.email,
      actorRole: req.role,
      action: 'create',
      resourceType: 'patient_record',
      resourceId: authData.user.id,
      patientId: authData.user.id,
      after: finalProfile || profile,
      req,
    });

    res.status(201).json(finalProfile || profile);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function mergePatients(req, res) {
  try {
    const { survivor_id, duplicate_id, reason } = req.body || {};
    if (!survivor_id || !duplicate_id) {
      return res.status(400).json({ error: 'survivor_id and duplicate_id are required' });
    }
    if (survivor_id === duplicate_id) {
      return res.status(400).json({ error: 'Cannot merge a patient into itself' });
    }

    const { data: survivor } = await supabase
      .from('profiles')
      .select(PATIENT_SELECT)
      .eq('id', survivor_id)
      .eq('role', 'Patient')
      .single();
    const { data: duplicate } = await supabase
      .from('profiles')
      .select(PATIENT_SELECT)
      .eq('id', duplicate_id)
      .eq('role', 'Patient')
      .single();

    if (!survivor || !duplicate) {
      return res.status(404).json({ error: 'Both patients must exist and have Patient role' });
    }
    if (duplicate.merged_into_id) {
      return res.status(400).json({ error: 'Duplicate patient already merged' });
    }

    const moved = {};
    for (const table of PATIENT_FK_TABLES) {
      const { data, error } = await supabase
        .from(table)
        .update({ patient_id: survivor_id })
        .eq('patient_id', duplicate_id)
        .select('id');
      if (error) {
        // table may not exist in all environments
        console.warn(`[merge] ${table}:`, error.message);
        moved[table] = { error: error.message };
      } else {
        moved[table] = { count: (data || []).length };
      }
    }

    // ICU beds current_patient_id
    await supabase
      .from('icu_beds')
      .update({ current_patient_id: survivor_id })
      .eq('current_patient_id', duplicate_id);

    const now = new Date().toISOString();
    const { data: mergedDup, error: mergeErr } = await supabase
      .from('profiles')
      .update({
        is_active: false,
        merged_into_id: survivor_id,
        updated_at: now,
      })
      .eq('id', duplicate_id)
      .select(PATIENT_SELECT)
      .single();

    if (mergeErr) return res.status(500).json({ error: mergeErr.message });

    await setAuthBan(duplicate_id, true);

    await writeAuditLog({
      actorId: req.user?.id,
      actorEmail: req.user?.email,
      actorRole: req.role,
      action: 'edit',
      resourceType: 'patient_merge',
      resourceId: survivor_id,
      patientId: survivor_id,
      before: duplicate,
      after: { survivor, duplicate: mergedDup, moved },
      metadata: { reason: reason || null, duplicate_id },
      req,
    });

    res.json({
      message: 'Patients merged',
      survivor,
      duplicate: mergedDup,
      moved,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function setAuthBan(userId, deactivated) {
  try {
    await supabase.auth.admin.updateUserById(userId, {
      ban_duration: deactivated ? '876000h' : 'none',
    });
    try {
      await supabase.auth.admin.signOut(userId, 'global');
    } catch {
      /* ignore */
    }
  } catch (e) {
    console.error('[merge] ban failed:', e?.message);
  }
}

export async function getPatientTimeline(req, res) {
  try {
    const { id } = req.params;
    const { data: patient, error: pErr } = await supabase
      .from('profiles')
      .select(PATIENT_SELECT)
      .eq('id', id)
      .eq('role', 'Patient')
      .single();
    if (pErr || !patient) return res.status(404).json({ error: 'Patient not found' });

    // Patients may only view their own timeline
    if (req.role === 'Patient' && req.user?.id !== id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const [
      appointments,
      medicalRecords,
      prescriptions,
      ambulance,
      icuRequests,
      icuAdmissions,
      icuMonitoring,
      bloodRequests,
      transfusions,
    ] = await Promise.all([
      supabase
        .from('appointments')
        .select('id, scheduled_at, status, notes, doctor_id, created_at')
        .eq('patient_id', id)
        .order('scheduled_at', { ascending: false }),
      supabase
        .from('medical_records')
        .select('id, diagnosis, notes, observations, doctor_id, appointment_id, created_at, updated_at')
        .eq('patient_id', id)
        .order('created_at', { ascending: false }),
      supabase
        .from('prescriptions')
        .select('id, medication, dosage, instructions, status, doctor_id, created_at')
        .eq('patient_id', id)
        .order('created_at', { ascending: false }),
      supabase
        .from('ambulance_requests')
        .select('id, status, priority, from_address, to_address, created_at, updated_at')
        .eq('patient_id', id)
        .order('created_at', { ascending: false }),
      supabase
        .from('icu_admission_requests')
        .select('id, request_status, priority_level, request_notes, created_at, reviewed_at')
        .eq('patient_id', id)
        .order('created_at', { ascending: false }),
      supabase
        .from('icu_admission_records')
        .select('id, admission_time, discharge_time, bed_id, discharge_reason, final_status, created_at')
        .eq('patient_id', id)
        .order('admission_time', { ascending: false }),
      supabase
        .from('icu_patient_monitoring')
        .select('id, recorded_at, condition_status, observation_notes, vital_signs, created_at')
        .eq('patient_id', id)
        .order('recorded_at', { ascending: false })
        .limit(50),
      supabase
        .from('blood_requests')
        .select('id, request_number, blood_group_required, request_status, urgency_level, created_at')
        .eq('patient_id', id)
        .order('created_at', { ascending: false }),
      supabase
        .from('transfusion_logs')
        .select('*')
        .eq('patient_id', id)
        .order('created_at', { ascending: false }),
    ]);

    const events = [];

    for (const a of appointments.data || []) {
      events.push({
        type: 'appointment',
        occurred_at: a.scheduled_at || a.created_at,
        summary: `Appointment ${a.status}`,
        source_id: a.id,
        data: a,
      });
    }
    for (const r of medicalRecords.data || []) {
      events.push({
        type: 'medical_record',
        occurred_at: r.created_at,
        summary: r.diagnosis || r.notes || 'Medical record',
        source_id: r.id,
        data: r,
      });
    }
    for (const p of prescriptions.data || []) {
      events.push({
        type: 'prescription',
        occurred_at: p.created_at,
        summary: `${p.medication || 'Prescription'} (${p.status})`,
        source_id: p.id,
        data: p,
      });
    }
    for (const a of ambulance.data || []) {
      events.push({
        type: 'ambulance',
        occurred_at: a.created_at,
        summary: `Ambulance request: ${a.status}`,
        source_id: a.id,
        data: a,
      });
    }
    for (const r of icuRequests.data || []) {
      events.push({
        type: 'icu_request',
        occurred_at: r.created_at,
        summary: `ICU request: ${r.request_status}`,
        source_id: r.id,
        data: r,
      });
    }
    for (const a of icuAdmissions.data || []) {
      events.push({
        type: 'icu_admission',
        occurred_at: a.admission_time || a.created_at,
        summary: a.discharge_time ? 'ICU admission (discharged)' : 'ICU admission',
        source_id: a.id,
        data: a,
      });
    }
    for (const m of icuMonitoring.data || []) {
      events.push({
        type: 'icu_monitoring',
        occurred_at: m.recorded_at || m.created_at,
        summary: `ICU monitoring: ${m.condition_status || 'update'}`,
        source_id: m.id,
        data: m,
      });
    }
    for (const b of bloodRequests.data || []) {
      events.push({
        type: 'blood_request',
        occurred_at: b.created_at,
        summary: `Blood request ${b.request_number || ''} (${b.request_status})`.trim(),
        source_id: b.id,
        data: b,
      });
    }
    for (const t of transfusions.data || []) {
      events.push({
        type: 'transfusion',
        occurred_at: t.transfusion_time || t.created_at,
        summary: 'Blood transfusion',
        source_id: t.id,
        data: t,
      });
    }

    events.sort((a, b) => new Date(b.occurred_at || 0) - new Date(a.occurred_at || 0));

    await writeAuditLog({
      actorId: req.user?.id,
      actorEmail: req.user?.email,
      actorRole: req.role,
      action: 'view',
      resourceType: 'patient_timeline',
      resourceId: id,
      patientId: id,
      metadata: { event_count: events.length },
      req,
    });

    res.json({ patient, events, count: events.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function updatePatientDemographics(req, res) {
  try {
    const { id } = req.params;
    const { full_name, phone, date_of_birth } = req.body || {};
    const updates = { updated_at: new Date().toISOString() };
    if (full_name !== undefined) updates.full_name = full_name;
    if (phone !== undefined) updates.phone = phone;
    if (date_of_birth !== undefined) updates.date_of_birth = date_of_birth || null;

    const { data, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', id)
      .eq('role', 'Patient')
      .select(PATIENT_SELECT)
      .single();

    if (error) return res.status(error.code === 'PGRST116' ? 404 : 500).json({ error: error.message });

    await writeAuditLog({
      actorId: req.user?.id,
      actorEmail: req.user?.email,
      actorRole: req.role,
      action: 'edit',
      resourceType: 'patient_record',
      resourceId: id,
      patientId: id,
      after: data,
      req,
    });

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export { STAFF_ROLES, PATIENT_SELECT };
