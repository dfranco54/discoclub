import { Router } from 'express';
import { z } from 'zod';
import { hashPassword } from '../../lib/password.js';
import { createUser } from '../users/users.repository.js';

// Unknown fields (like "role") are stripped by default, so a client can never
// choose its own role at registration (this prevents "mass assignment").
// Trim and lowercase come first so the email is validated in its clean form.
const registerSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  // max() also protects the server: hashing a huge string is expensive
  password: z.string().min(8).max(128),
  name: z.string().trim().min(1).max(100),
});

export const authRouter = Router();

// Express 5 forwards errors from async handlers to the error handler,
// so no try/catch is needed here.
authRouter.post('/register', async (req, res) => {
  const input = registerSchema.parse(req.body); // typed, no cast needed
  const passwordHash = await hashPassword(input.password);
  const user = await createUser({
    email: input.email,
    passwordHash,
    name: input.name,
  });
  res.status(201).json({ user });
});