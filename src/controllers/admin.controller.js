/**
 * Admin controller: users, roles. Uses Supabase (service role) for RLS bypass.
 * Supports getUsers, getUser, createUser, updateUser, deleteUser, resetPassword, getRoles.
 * Users enter system: (1) Patients self-signup; (2) Staff created by Admin only.
 */
import { supabase } from '../config/supabase.js';

const PROFILES_SELECT = 'id, email, full_name, phone, role, is_active, created_at';
const DOCTORS_SELECT = 'id, email, full_name, phone, role, is_active, specialty, department, license_number, years_experience, consultation_fee, schedule, doctor_status, created_at, updated_at';
const DOCTOR_STATUSES = ['Available', 'On Leave', 'Busy', 'Inactive'];

export async function createUser(req, res) {
  try {
    const { email, password, full_name, role } = req.body;
    if (!email || !password || !role) {
      return res.status(400).json({ error: 'Email, password, and role are required' });
    }
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: full_name || email, role },
    });
    if (authError) {
      return res.status(400).json({ error: authError.message });
    }
    const { data: profile } = await supabase
      .from('profiles')
      .select(PROFILES_SELECT)
      .eq('id', authData.user.id)
      .single();
    res.status(201).json(profile || { id: authData.user.id, email, full_name: full_name || null, role });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getUsers(req, res) {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select(PROFILES_SELECT)
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getUser(req, res) {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('profiles')
      .select(PROFILES_SELECT)
      .eq('id', id)
      .single();

    if (error) {
      return res.status(error.code === 'PGRST116' ? 404 : 500).json({ error: error.message });
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function updateUser(req, res) {
  try {
    const { id } = req.params;
    const { full_name, email, phone, role, is_active } = req.body;

    if (email !== undefined) {
      const { error: authError } = await supabase.auth.admin.updateUserById(id, { email });
      if (authError) {
        return res.status(400).json({ error: authError.message });
      }
    }

    const updates = {};
    if (full_name !== undefined) updates.full_name = full_name;
    if (phone !== undefined) updates.phone = phone;
    if (role !== undefined) updates.role = role;
    if (typeof is_active === 'boolean') updates.is_active = is_active;
    updates.updated_at = new Date().toISOString();

    if (Object.keys(updates).length <= 1) {
      return res.json({ message: 'No profile updates' });
    }

    const { data, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function deleteUser(req, res) {
  try {
    const { id } = req.params;
    const { error } = await supabase.auth.admin.deleteUser(id);
    if (error) {
      return res.status(error.status === 404 ? 404 : 500).json({ error: error.message });
    }
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function resetPassword(req, res) {
  try {
    const { id } = req.params;
    const { password } = req.body;
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    const { error } = await supabase.auth.admin.updateUserById(id, { password });
    if (error) {
      return res.status(400).json({ error: error.message });
    }
    res.json({ message: 'Password updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getRoles(req, res) {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, full_name, phone, role')
      .order('email');

    if (error) {
      return res.status(500).json({ error: error.message });
    }
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ——— Doctor Management ———

export async function getDoctors(req, res) {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select(DOCTORS_SELECT)
      .eq('role', 'Doctor')
      .order('full_name');

    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getDoctor(req, res) {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('profiles')
      .select(DOCTORS_SELECT)
      .eq('id', id)
      .eq('role', 'Doctor')
      .single();

    if (error) return res.status(error.code === 'PGRST116' ? 404 : 500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function createDoctor(req, res) {
  try {
    const {
      email,
      password,
      full_name,
      phone,
      specialty,
      department,
      license_number,
      years_experience,
      consultation_fee,
      schedule,
      doctor_status,
    } = req.body;
    if (!email || !password || !full_name || !specialty || !department || !license_number) {
      return res.status(400).json({
        error: 'Email, password, full_name, specialty, department, and license_number are required',
      });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name, role: 'Doctor' },
    });
    if (authError) return res.status(400).json({ error: authError.message });

    const profileUpdates = {
      full_name,
      role: 'Doctor',
      phone: phone || null,
      specialty: specialty || null,
      department: department || null,
      license_number: license_number || null,
      years_experience: years_experience != null ? Number(years_experience) : null,
      consultation_fee: consultation_fee != null ? String(consultation_fee) : null,
      schedule: schedule != null && String(schedule).trim() ? String(schedule).trim() : null,
      doctor_status: doctor_status && DOCTOR_STATUSES.includes(doctor_status) ? doctor_status : 'Available',
      updated_at: new Date().toISOString(),
    };

    const { error: updateError } = await supabase
      .from('profiles')
      .update(profileUpdates)
      .eq('id', authData.user.id);

    if (updateError) {
      return res.status(500).json({ error: 'Profile update failed: ' + updateError.message });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select(DOCTORS_SELECT)
      .eq('id', authData.user.id)
      .single();
    res.status(201).json(profile || { id: authData.user.id, email, full_name, role: 'Doctor' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function updateDoctor(req, res) {
  try {
    const { id } = req.params;
    const {
      full_name,
      email,
      phone,
      specialty,
      department,
      license_number,
      years_experience,
      consultation_fee,
      schedule,
      doctor_status,
      is_active,
    } = req.body;

    const { data: existing } = await supabase
      .from('profiles')
      .select('id, role')
      .eq('id', id)
      .single();
    if (!existing || existing.role !== 'Doctor') {
      return res.status(404).json({ error: 'Doctor not found' });
    }

    if (email !== undefined) {
      const { error: authError } = await supabase.auth.admin.updateUserById(id, { email });
      if (authError) return res.status(400).json({ error: authError.message });
    }

    const updates = { updated_at: new Date().toISOString() };
    if (full_name !== undefined) updates.full_name = full_name;
    if (phone !== undefined) updates.phone = phone;
    if (specialty !== undefined) updates.specialty = specialty;
    if (department !== undefined) updates.department = department;
    if (license_number !== undefined) updates.license_number = license_number;
    if (years_experience !== undefined) updates.years_experience = years_experience == null ? null : Number(years_experience);
    if (consultation_fee !== undefined) updates.consultation_fee = consultation_fee == null ? null : String(consultation_fee);
    if (schedule !== undefined) updates.schedule = schedule == null || String(schedule).trim() === '' ? null : String(schedule).trim();
    if (doctor_status !== undefined && DOCTOR_STATUSES.includes(doctor_status)) updates.doctor_status = doctor_status;
    if (typeof is_active === 'boolean') updates.is_active = is_active;

    const { data, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function deleteDoctor(req, res) {
  try {
    const { id } = req.params;
    const { data: existing } = await supabase.from('profiles').select('id, role').eq('id', id).single();
    if (!existing || existing.role !== 'Doctor') {
      return res.status(404).json({ error: 'Doctor not found' });
    }
    const { error } = await supabase.auth.admin.deleteUser(id);
    if (error) return res.status(error.status === 404 ? 404 : 500).json({ error: error.message });
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getDoctorStatistics(req, res) {
  try {
    const { id } = req.params;
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, role')
      .eq('id', id)
      .single();
    if (!profile || profile.role !== 'Doctor') {
      return res.status(404).json({ error: 'Doctor not found' });
    }

    const [appointmentsRes, recordsRes, patientsRes] = await Promise.all([
      supabase.from('appointments').select('id, patient_id', { count: 'exact', head: true }).eq('doctor_id', id),
      supabase.from('medical_records').select('id', { count: 'exact', head: true }).eq('doctor_id', id),
      supabase.from('appointments').select('patient_id').eq('doctor_id', id),
    ]);

    const totalAppointments = appointmentsRes.count ?? 0;
    const totalRecords = recordsRes.count ?? 0;
    const patientIds = [...new Set((patientsRes.data || []).map((r) => r.patient_id).filter(Boolean))];
    const uniquePatients = patientIds.length;

    res.json({
      total_appointments: totalAppointments,
      unique_patients: uniquePatients,
      total_medical_records: totalRecords,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** Dashboard stats for Admin Home: users by role, appointments, ICU beds, ambulances. */
export async function getDashboardStats(req, res) {
  try {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(startOfToday);
    endOfToday.setDate(endOfToday.getDate() + 1);
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalUsersRes,
      patientsRes,
      doctorsRes,
      appointmentsTodayRes,
      appointmentsWeekRes,
      appointmentsMonthRes,
      icuBedsRes,
      ambulancesRes,
      bloodBankRes,
      pharmacyPendingRes,
    ] = await Promise.all([
      supabase.from('profiles').select('id', { count: 'exact', head: true }),
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'Patient'),
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'Doctor'),
      supabase.from('appointments').select('id', { count: 'exact', head: true }).gte('scheduled_at', startOfToday.toISOString()).lt('scheduled_at', endOfToday.toISOString()),
      supabase.from('appointments').select('id', { count: 'exact', head: true }).gte('scheduled_at', startOfWeek.toISOString()),
      supabase.from('appointments').select('id', { count: 'exact', head: true }).gte('scheduled_at', startOfMonth.toISOString()),
      supabase.from('icu_beds').select('id, status'),
      supabase.from('ambulances').select('id, status'),
      supabase.from('blood_units').select('id', { count: 'exact', head: true }),
      supabase.from('prescriptions').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    ]);

    const icuBeds = icuBedsRes.data || [];
    const totalIcuBeds = icuBeds.length;
    const icuBedsAvailable = icuBeds.filter((b) => b.status === 'available').length;

    const ambulancesList = ambulancesRes.data || [];
    const totalAmbulances = ambulancesList.length;
    const ambulancesAvailable = ambulancesList.filter((a) => a.status === 'Available').length;
    const ambulancesOnDuty = ambulancesList.filter((a) => a.status === 'On Duty').length;

    const totalBloodUnits = bloodBankRes?.error ? 0 : (bloodBankRes?.count ?? 0);

    res.json({
      totalUsers: totalUsersRes.count ?? 0,
      totalPatients: patientsRes.count ?? 0,
      totalDoctors: doctorsRes.count ?? 0,
      appointmentsToday: appointmentsTodayRes.count ?? 0,
      appointmentsThisWeek: appointmentsWeekRes.count ?? 0,
      appointmentsThisMonth: appointmentsMonthRes.count ?? 0,
      icuBedsTotal: totalIcuBeds,
      icuBedsAvailable,
      ambulancesTotal: totalAmbulances,
      ambulancesAvailable,
      ambulancesOnDuty,
      totalBloodUnits,
      pendingPrescriptions: pharmacyPendingRes?.count ?? 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
