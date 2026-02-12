/**
 * Pharmacy module: inventory, pending prescriptions, dispense, procurement, expiry.
 * All operations require Pharmacy role (or Admin for some).
 */
import { supabase } from '../config/supabase.js';

const EXPIRY_DAYS_THRESHOLD = 90;
const DEFAULT_LOW_STOCK = 10;

/** Dashboard KPIs: total medicines, low stock count, expiring soon count, inventory value. */
export async function getDashboard(req, res) {
  try {
    const { data: medicines, error: mErr } = await supabase
      .from('medicines')
      .select('id, stock_quantity, low_stock_threshold, price_per_unit, expiry_date');
    if (mErr) return res.status(500).json({ error: mErr.message });
    const list = medicines || [];
    const totalMedicines = list.length;
    const now = new Date();
    const expiryLimit = new Date(now);
    expiryLimit.setDate(expiryLimit.getDate() + EXPIRY_DAYS_THRESHOLD);
    let lowStock = 0;
    let expiringSoon = 0;
    let inventoryValue = 0;
    list.forEach((m) => {
      if ((m.low_stock_threshold ?? DEFAULT_LOW_STOCK) >= (m.stock_quantity ?? 0)) lowStock++;
      if (m.expiry_date && new Date(m.expiry_date) <= expiryLimit) expiringSoon++;
      inventoryValue += (m.stock_quantity ?? 0) * (parseFloat(m.price_per_unit) || 0);
    });
    const { count } = await supabase
      .from('prescriptions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending');
    res.json({
      totalMedicines,
      lowStockAlerts: lowStock,
      expiringSoon,
      inventoryValue: Math.round(inventoryValue * 100) / 100,
      pendingPrescriptionsCount: count ?? 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** List medicines with optional search and category filter. */
export async function getMedicines(req, res) {
  try {
    const { search, category } = req.query;
    let q = supabase
      .from('medicines')
      .select('id, name, manufacturer, category, stock_quantity, unit, storage_conditions, expiry_date, price_per_unit, low_stock_threshold')
      .order('name');
    if (search && String(search).trim()) {
      q = q.or(`name.ilike.%${search.trim()}%,manufacturer.ilike.%${search.trim()}%`);
    }
    if (category && String(category).trim() !== 'All') {
      q = q.eq('category', category.trim());
    }
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** Add medicine. */
export async function createMedicine(req, res) {
  try {
    const {
      name,
      manufacturer,
      category,
      stock_quantity,
      unit,
      storage_conditions,
      expiry_date,
      price_per_unit,
      low_stock_threshold,
    } = req.body;
    if (!name || !category) return res.status(400).json({ error: 'name and category are required' });
    const payload = {
      name: String(name).trim(),
      manufacturer: manufacturer != null ? String(manufacturer).trim() : null,
      category: String(category).trim(),
      stock_quantity: Math.max(0, parseInt(stock_quantity, 10) || 0),
      unit: ['Tablets', 'Capsules', 'Vials', 'Bottles', 'Tubes', 'Units'].includes(unit) ? unit : 'Tablets',
      storage_conditions: storage_conditions != null ? String(storage_conditions).trim() : 'Room Temperature',
      expiry_date: expiry_date || null,
      price_per_unit: parseFloat(price_per_unit) || 0,
      low_stock_threshold: Math.max(0, parseInt(low_stock_threshold, 10) ?? DEFAULT_LOW_STOCK),
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase.from('medicines').insert(payload).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** Update medicine. */
export async function updateMedicine(req, res) {
  try {
    const { id } = req.params;
    const updates = { updated_at: new Date().toISOString() };
    const allowed = [
      'name', 'manufacturer', 'category', 'stock_quantity', 'unit', 'storage_conditions',
      'expiry_date', 'price_per_unit', 'low_stock_threshold',
    ];
    allowed.forEach((k) => {
      if (req.body[k] !== undefined) {
        if (k === 'stock_quantity' || k === 'low_stock_threshold') updates[k] = Math.max(0, parseInt(req.body[k], 10) ?? 0);
        else if (k === 'price_per_unit') updates[k] = parseFloat(req.body[k]) || 0;
        else if (k === 'expiry_date') updates[k] = req.body[k] || null;
        else updates[k] = req.body[k];
      }
    });
    const { data, error } = await supabase.from('medicines').update(updates).eq('id', id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Medicine not found' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** Delete medicine. */
export async function deleteMedicine(req, res) {
  try {
    const { id } = req.params;
    const { error } = await supabase.from('medicines').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** Pending prescriptions for pharmacy (with patient, doctor, items or legacy medication). */
export async function getPendingPrescriptions(req, res) {
  try {
    const { data: rows, error } = await supabase
      .from('prescriptions')
      .select('id, patient_id, doctor_id, medication, dosage, instructions, frequency, duration, quantity, special_instructions, status, created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    const list = rows || [];
    const patientIds = [...new Set(list.map((r) => r.patient_id))];
    const doctorIds = [...new Set(list.map((r) => r.doctor_id))];
    const patientMap = {};
    const doctorMap = {};
    if (patientIds.length > 0) {
      const { data: patients } = await supabase.from('profiles').select('id, full_name').in('id', patientIds);
      (patients || []).forEach((p) => { patientMap[p.id] = p; });
    }
    if (doctorIds.length > 0) {
      const { data: doctors } = await supabase.from('profiles').select('id, full_name').in('id', doctorIds);
      (doctors || []).forEach((d) => { doctorMap[d.id] = d; });
    }
    const prescriptionIds = list.map((r) => r.id);
    const { data: items } = await supabase
      .from('prescription_items')
      .select('id, prescription_id, medicine_id, medication_text, dosage, frequency, quantity, instructions')
      .in('prescription_id', prescriptionIds);
    const medicineIds = [...new Set((items || []).map((i) => i.medicine_id).filter(Boolean))];
    const medicineMap = {};
    if (medicineIds.length > 0) {
      const { data: meds } = await supabase.from('medicines').select('id, name, stock_quantity, unit').in('id', medicineIds);
      (meds || []).forEach((m) => { medicineMap[m.id] = m; });
    }
    const itemsByRx = {};
    (items || []).forEach((i) => {
      if (!itemsByRx[i.prescription_id]) itemsByRx[i.prescription_id] = [];
      itemsByRx[i.prescription_id].push({
        ...i,
        medicine: i.medicine_id ? medicineMap[i.medicine_id] : null,
      });
    });
    const result = list.map((r) => ({
      ...r,
      patient: patientMap[r.patient_id] || null,
      doctor: doctorMap[r.doctor_id] || null,
      items: itemsByRx[r.id] || [],
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** Dispense prescription: deduct stock, create dispense record, set status to dispensed. */
export async function dispensePrescription(req, res) {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const { data: rx, error: rxErr } = await supabase
      .from('prescriptions')
      .select('id, patient_id, medication, quantity, status')
      .eq('id', id)
      .single();
    if (rxErr || !rx) return res.status(404).json({ error: 'Prescription not found' });
    if (rx.status !== 'pending') return res.status(400).json({ error: 'Prescription is not pending' });

    const { data: items } = await supabase.from('prescription_items').select('id, medicine_id, medication_text, quantity').eq('prescription_id', id);
    const lines = items && items.length > 0 ? items : [{ medicine_id: null, medication_text: rx.medication, quantity: rx.quantity ?? 1 }];

    for (const line of lines) {
      const qty = line.quantity ?? 1;
      let medicineId = line.medicine_id;
      if (!medicineId && line.medication_text) {
        const { data: byName } = await supabase.from('medicines').select('id, stock_quantity').ilike('name', `%${line.medication_text}%`).limit(1).maybeSingle();
        if (byName) medicineId = byName.id;
      }
      if (medicineId) {
        const { data: med } = await supabase.from('medicines').select('id, stock_quantity').eq('id', medicineId).single();
        if (!med) return res.status(400).json({ error: `Medicine not found for ${line.medication_text || line.medication}` });
        const newStock = (med.stock_quantity ?? 0) - qty;
        if (newStock < 0) return res.status(400).json({ error: `Insufficient stock for ${line.medication_text || line.medication}` });
        await supabase.from('medicines').update({ stock_quantity: newStock, updated_at: new Date().toISOString() }).eq('id', medicineId);
      }
    }

    const { error: dispErr } = await supabase.from('dispense_records').insert({
      prescription_id: id,
      dispensed_by: userId,
      dispensed_at: new Date().toISOString(),
      notes: 'Dispensed',
    });
    if (dispErr) return res.status(500).json({ error: dispErr.message });

    await supabase.from('prescriptions').update({ status: 'dispensed', updated_at: new Date().toISOString() }).eq('id', id);
    res.json({ ok: true, status: 'dispensed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** Reject prescription (e.g. out of stock). */
export async function rejectPrescription(req, res) {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const { data, error } = await supabase
      .from('prescriptions')
      .update({ status: 'rejected', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'pending')
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Prescription not found or not pending' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** Dispensing logs. */
export async function getDispensingLogs(req, res) {
  try {
    const { data: logs, error } = await supabase
      .from('dispense_records')
      .select('id, prescription_id, dispensed_by, dispensed_at, notes')
      .order('dispensed_at', { ascending: false })
      .limit(100);
    if (error) return res.status(500).json({ error: error.message });
    const list = logs || [];
    const rxIds = [...new Set(list.map((l) => l.prescription_id))];
    const userIds = [...new Set(list.map((l) => l.dispensed_by))];
    const rxMap = {};
    const userMap = {};
    if (rxIds.length > 0) {
      const { data: rxs } = await supabase.from('prescriptions').select('id, patient_id').in('id', rxIds);
      const pIds = [...new Set((rxs || []).map((r) => r.patient_id))];
      const { data: patients } = await supabase.from('profiles').select('id, full_name').in('id', pIds);
      (rxs || []).forEach((r) => { rxMap[r.id] = r; });
      (patients || []).forEach((p) => { userMap[p.id] = p; });
    }
    if (userIds.length > 0) {
      const { data: users } = await supabase.from('profiles').select('id, full_name').in('id', userIds);
      (users || []).forEach((u) => { userMap[u.id] = u; });
    }
    res.json(list.map((l) => ({
      ...l,
      patient: rxMap[l.prescription_id] ? userMap[rxMap[l.prescription_id].patient_id] : null,
      dispensedBy: userMap[l.dispensed_by] || null,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** Medicines expiring soon or expired. */
export async function getExpiryList(req, res) {
  try {
    const { data, error } = await supabase
      .from('medicines')
      .select('id, name, category, stock_quantity, unit, expiry_date')
      .not('expiry_date', 'is', null)
      .order('expiry_date', { ascending: true })
      .limit(100);
    if (error) return res.status(500).json({ error: error.message });
    const list = (data || []).map((m) => ({
      ...m,
      isExpired: m.expiry_date && new Date(m.expiry_date) < new Date(),
    }));
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** List purchase orders. */
export async function getPurchaseOrders(req, res) {
  try {
    const { data: orders, error } = await supabase
      .from('purchase_orders')
      .select('id, order_number, supplier_name, order_date, expected_delivery, status, total_amount, created_at')
      .order('order_date', { ascending: false })
      .limit(50);
    if (error) return res.status(500).json({ error: error.message });
    const list = orders || [];
    const ids = list.map((o) => o.id);
    const { data: items } = await supabase.from('purchase_order_items').select('*').in('purchase_order_id', ids);
    const itemsByPo = {};
    (items || []).forEach((i) => {
      if (!itemsByPo[i.purchase_order_id]) itemsByPo[i.purchase_order_id] = [];
      itemsByPo[i.purchase_order_id].push(i);
    });
    res.json(list.map((o) => ({ ...o, items: itemsByPo[o.id] || [] })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** Create purchase order. */
export async function createPurchaseOrder(req, res) {
  try {
    const { supplier_name, order_date, expected_delivery, items } = req.body;
    if (!supplier_name || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'supplier_name and items (array) required' });
    }
    const orderNumber = `PO${Date.now().toString(36).toUpperCase()}`;
    let totalAmount = 0;
    const poItems = items.map((i) => {
      const qty = Math.max(1, parseInt(i.quantity, 10) || 1);
      const up = parseFloat(i.unit_price) || 0;
      const tot = qty * up;
      totalAmount += tot;
      return {
        purchase_order_id: null,
        medicine_id: i.medicine_id || null,
        medicine_name: i.medicine_name || 'Item',
        quantity: qty,
        unit_price: up,
        total_price: Math.round(tot * 100) / 100,
      };
    });
    const { data: po, error: poErr } = await supabase
      .from('purchase_orders')
      .insert({
        order_number: orderNumber,
        supplier_name: String(supplier_name).trim(),
        order_date: order_date || new Date().toISOString().slice(0, 10),
        expected_delivery: expected_delivery || null,
        status: 'pending',
        total_amount: Math.round(totalAmount * 100) / 100,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (poErr) return res.status(500).json({ error: poErr.message });
    for (const it of poItems) {
      it.purchase_order_id = po.id;
      await supabase.from('purchase_order_items').insert(it);
    }
    res.status(201).json(po);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** Update purchase order (e.g. mark received). */
export async function updatePurchaseOrder(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!['pending', 'received', 'cancelled'].includes(status)) {
      return res.status(400).json({ error: 'status must be pending, received, or cancelled' });
    }
    const { data, error } = await supabase
      .from('purchase_orders')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Order not found' });
    if (status === 'received') {
      const { data: items } = await supabase.from('purchase_order_items').select('medicine_id, quantity').eq('purchase_order_id', id);
      for (const it of items || []) {
        if (it.medicine_id) {
          const { data: med } = await supabase.from('medicines').select('stock_quantity').eq('id', it.medicine_id).single();
          const current = med?.stock_quantity ?? 0;
          await supabase.from('medicines').update({ stock_quantity: current + (it.quantity || 0), updated_at: new Date().toISOString() }).eq('id', it.medicine_id);
        }
      }
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
