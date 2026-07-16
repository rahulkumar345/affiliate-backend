import { User } from '../models/User.js';

// No 0/O/1/I/L — codes get read aloud and typed by hand
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export async function generateReferralCode(name) {
  const prefix = String(name || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5) || 'REF';
  for (let attempt = 0; attempt < 10; attempt++) {
    let suffix = '';
    for (let i = 0; i < 3; i++) suffix += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    const code = `${prefix}${suffix}`;
    const existing = await User.findOne({ referralCode: code });
    if (!existing) return code;
  }
  throw new Error('Could not generate a unique referral code');
}
