import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User, publicUserMap } from '../models/User.js';
import { asyncHandler, badRequest, conflict } from '../middleware/errors.js';
import { generateReferralCode } from '../utils/referralCode.js';

const router = Router();

function signToken(user) {
  return jwt.sign(
    { sub: String(user._id), role: user.role, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// Growth decision: signup is affiliate-only, auto-approved, and issues the
// referral code immediately — a new affiliate can share their link within
// seconds of installing the app. Admin/finance users are created by the seed.
router.post(
  '/signup',
  asyncHandler(async (req, res) => {
    const { name, email, password } = req.body || {};
    if (!name || !email || !password) throw badRequest('name, email and password are required');
    if (String(password).length < 6) throw badRequest('Password must be at least 6 characters');

    const normalizedEmail = String(email).toLowerCase().trim();
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) throw conflict('An account with this email already exists');

    const user = await User.create({
      name: String(name).trim(),
      email: normalizedEmail,
      passwordHash: await bcrypt.hash(String(password), 10),
      role: 'affiliate',
      referralCode: await generateReferralCode(name),
    });

    res.status(201).json({ token: signToken(user), userMap: publicUserMap(user) });
  })
);

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) throw badRequest('email and password are required');

    const user = await User.findOne({ email: String(email).toLowerCase().trim() });
    const passwordOk = user && (await bcrypt.compare(String(password), user.passwordHash));
    if (!passwordOk) return res.status(401).json({ error: 'Invalid email or password' });

    res.json({ token: signToken(user), userMap: publicUserMap(user) });
  })
);

export default router;
