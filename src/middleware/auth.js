import jwt from 'jsonwebtoken';

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing auth token' });

  try {
    const payloadMap = jwt.verify(token, process.env.JWT_SECRET);
    req.userMap = { id: payloadMap.sub, role: payloadMap.role, name: payloadMap.name };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireRole(...rolesList) {
  return (req, res, next) => {
    if (!req.userMap || !rolesList.includes(req.userMap.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}
