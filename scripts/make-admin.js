/* eslint-disable no-console */
// Give an existing Yaay account admin access (sign up on the site first).
//
//   node scripts/make-admin.js you@paathly.in
//   node scripts/make-admin.js you@paathly.in --remove   # take admin away
//
// Uses MONGODB_URI from the environment (or .env).
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const { User } = require('../src/models');

(async () => {
  const email = (process.argv[2] || '').trim().toLowerCase();
  const remove = process.argv.includes('--remove');
  if (!email || email.startsWith('--')) {
    console.error('Usage: node scripts/make-admin.js <email> [--remove]');
    process.exit(1);
  }
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is not set');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  const user = await User.findOne({ email });
  if (!user) {
    console.error(`No account with ${email} on ${mongoose.connection.host}. Sign up on the site first.`);
    process.exitCode = 1;
  } else {
    await User.updateOne({ _id: user._id }, { role: remove ? 'user' : 'admin' });
    console.log(`${user.name} (${email}) is ${remove ? 'no longer an admin' : 'now an admin'} on ${mongoose.connection.host}. Sign out and in again to see it.`);
  }
  await mongoose.disconnect();
})().catch(async (err) => {
  console.error('Failed:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
