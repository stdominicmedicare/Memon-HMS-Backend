/**
 * Role guard: require one of the given roles. Use after authMiddleware.
 */
export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.role) {
      return res.status(403).json({ error: 'Forbidden: role not found' });
    }
    if (!allowedRoles.includes(req.role)) {
      return res.status(403).json({ error: 'Forbidden: insufficient role' });
    }
    next();
  };
}
