import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.js';

export const adminRouter = Router();

// Order matters: first who you are (401), then what you may do (403)
adminRouter.use(authenticate, requireRole('ADMIN'));

adminRouter.get('/ping', (_req, res) => {
  res.json({ ok: true });
});