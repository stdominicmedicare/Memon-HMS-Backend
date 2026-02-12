/**
 * Admin ICU: list/create/update/delete ICU beds.
 */
import { supabase } from '../config/supabase.js';

export async function getIcuBeds(req, res) {
  try {
    const { data, error } = await supabase
      .from('icu_beds')
      .select('id, bed_number, bed_type, ward, floor, equipment_list, status, current_patient_id, created_at')
      .order('bed_number');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function createIcuBed(req, res) {
  try {
    const { bed_number, bed_type, ward, floor, equipment_list } = req.body;
    if (!bed_number || !bed_type) {
      return res.status(400).json({ error: 'bed_number and bed_type are required' });
    }
    const equipment = Array.isArray(equipment_list)
      ? equipment_list
      : (typeof equipment_list === 'string' && equipment_list.trim()
          ? equipment_list.split(',').map((s) => s.trim()).filter(Boolean)
          : []);
    const { data, error } = await supabase
      .from('icu_beds')
      .insert({
        bed_number: String(bed_number).trim(),
        bed_type: String(bed_type).trim(),
        ward: ward != null ? String(ward).trim() : null,
        floor: floor != null ? String(floor).trim() : null,
        equipment_list: equipment,
        status: 'available',
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

export async function updateIcuBed(req, res) {
  try {
    const { id } = req.params;
    const { bed_type, ward, floor, equipment_list, status } = req.body;
    const updates = { updated_at: new Date().toISOString() };
    if (bed_type !== undefined) updates.bed_type = String(bed_type).trim();
    if (ward !== undefined) updates.ward = String(ward).trim() || null;
    if (floor !== undefined) updates.floor = String(floor).trim() || null;
    if (equipment_list !== undefined) {
      updates.equipment_list = Array.isArray(equipment_list)
        ? equipment_list
        : (typeof equipment_list === 'string'
            ? equipment_list.split(',').map((s) => s.trim()).filter(Boolean)
            : []);
    }
    if (['available', 'occupied', 'reserved', 'maintenance'].includes(status)) updates.status = status;
    const { data, error } = await supabase.from('icu_beds').update(updates).eq('id', id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Bed not found' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function deleteIcuBed(req, res) {
  try {
    const { id } = req.params;
    const { error } = await supabase.from('icu_beds').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** ICU analytics: utilization, admission history, occupancy alerts. */
export async function getIcuAnalytics(req, res) {
  try {
    const { data: beds, error: bedsErr } = await supabase
      .from('icu_beds')
      .select('id, status');
    if (bedsErr) return res.status(500).json({ error: bedsErr.message });
    const list = beds || [];
    const total = list.length;
    const byStatus = { available: 0, occupied: 0, reserved: 0, maintenance: 0 };
    list.forEach((b) => { if (b.status && byStatus[b.status] !== undefined) byStatus[b.status]++; });
    const occupancyRate = total ? Math.round((byStatus.occupied / total) * 100) : 0;

    const { data: history, error: histErr } = await supabase
      .from('icu_admission_records')
      .select('id, patient_id, bed_id, admission_time, discharge_time, discharge_reason, final_status')
      .order('admission_time', { ascending: false })
      .limit(50);
    if (histErr) return res.status(500).json({ error: histErr.message });
    const recs = history || [];
    const patientIds = [...new Set(recs.map((r) => r.patient_id))];
    const bedIds = [...new Set(recs.map((r) => r.bed_id))];
    const patientMap = {};
    const bedMap = {};
    if (patientIds.length > 0) {
      const { data: patients } = await supabase.from('profiles').select('id, full_name').in('id', patientIds);
      (patients || []).forEach((p) => { patientMap[p.id] = p; });
    }
    if (bedIds.length > 0) {
      const { data: bedsList } = await supabase.from('icu_beds').select('id, bed_number').in('id', bedIds);
      (bedsList || []).forEach((b) => { bedMap[b.id] = b; });
    }
    const admissionHistory = recs.map((r) => ({
      ...r,
      patient: patientMap[r.patient_id] || null,
      bed: bedMap[r.bed_id] || null,
    }));

    const occupancyAlert = total && occupancyRate >= 80;
    const alerts = [];
    if (occupancyAlert) alerts.push({ type: 'occupancy', message: `ICU occupancy at ${occupancyRate}%`, severity: 'high' });
    if (byStatus.available === 0 && total > 0) alerts.push({ type: 'no_available', message: 'No available ICU beds', severity: 'high' });

    res.json({
      utilization: { total, ...byStatus, occupancyRate },
      admissionHistory,
      alerts,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
