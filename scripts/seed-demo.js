// Fills an account with the demo data (six months of transactions, budgets, opening balance).
// Signs in as that user, so row level security applies exactly as in the app; it never needs a
// service-role key. Does nothing if the account already has transactions.
//   DEMO_EMAIL=demo@tally.app DEMO_PASSWORD=... npm run seed-demo
import { loadEnv, seedDemo, storeFromEnv } from '../server.js';

loadEnv();
const { DEMO_EMAIL: email, DEMO_PASSWORD: password } = process.env;
if (!email || !password) {
  console.error('Set DEMO_EMAIL and DEMO_PASSWORD (the account must already exist and be confirmed).');
  process.exit(1);
}
const store = await storeFromEnv();
const session = await store.auth.signIn(email.trim().toLowerCase(), password);
const added = await seedDemo(store.forToken(session.accessToken));
console.log(added ? `Demo data added to ${email}.` : `${email} already has transactions; nothing changed.`);
await store.auth.signOut(session.accessToken);
