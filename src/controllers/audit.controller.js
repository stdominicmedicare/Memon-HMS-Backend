/**
 * Audit log API for Admin and RecordsOfficer.
 */
import { listAuditLogs } from '../services/auditService.js';

export async function getAuditLogs(req, res) {
  try {
    const {
      patient_id: patientId,
      actor_id: actorId,
      from,
      to,
      action,
      limit = '100',
      offset = '0',
    } = req.query;

    const { data, error, count } = await listAuditLogs({
      patientId: patientId || undefined,
      actorId: actorId || undefined,
      from: from || undefined,
      to: to || undefined,
      action: action || undefined,
      limit: Math.min(Number(limit) || 100, 200),
      offset: Number(offset) || 0,
    });

    if (error) return res.status(500).json({ error: error.message });
    res.json({ data: data || [], count: count ?? (data || []).length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
