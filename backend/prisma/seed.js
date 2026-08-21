/**
 * Seeds a demo-ready local database:
 *   - 6 demo users (all with password "password123") each with a funded wallet
 *   - a catalogue of mock recharge plans and billers
 *   - ~6 weeks of backdated, internally consistent passbook history
 *
 * Balances are simulated forward in chronological order so every ledger row's
 * balanceAfterPaise matches what the wallet actually held at that moment, and
 * the final Account rows match the last computed balance.
 *
 * Run with:  npm run seed
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { buildReferenceId, pickAvatarColor } from '../src/lib/ids.js';
import { formatINR } from '../src/lib/money.js';

const prisma = new PrismaClient();

const DEMO_PASSWORD = 'password123';
const RUPEE = 100;

const daysAgo = (days, hour = 10, minute = 0) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, minute, 0, 0);
  return d;
};

const USERS = [
  { key: 'sreeram', firstName: 'Sreeram', lastName: 'R',        email: 'sreeram@paytm.test', phone: '9876543210', upiId: 'sreeram.r@paytm',       openingPaise: 4500 * RUPEE },
  { key: 'ananya',  firstName: 'Ananya',  lastName: 'Iyer',     email: 'ananya@paytm.test',  phone: '9812345678', upiId: 'ananya.iyer@paytm',    openingPaise: 12000 * RUPEE },
  { key: 'rahul',   firstName: 'Rahul',   lastName: 'Menon',    email: 'rahul@paytm.test',   phone: '9823456789', upiId: 'rahul.menon@paytm',    openingPaise: 7800 * RUPEE },
  { key: 'priya',   firstName: 'Priya',   lastName: 'Nair',     email: 'priya@paytm.test',   phone: '9834567890', upiId: 'priya.nair@paytm',     openingPaise: 15500 * RUPEE },
  { key: 'karthik', firstName: 'Karthik', lastName: 'Balaji',   email: 'karthik@paytm.test', phone: '9845678901', upiId: 'karthik.balaji@paytm', openingPaise: 3200 * RUPEE },
  { key: 'divya',   firstName: 'Divya',   lastName: 'Krishnan', email: 'divya@paytm.test',   phone: '9856789012', upiId: 'divya.krishnan@paytm', openingPaise: 9600 * RUPEE },
];

const RECHARGE_PLANS = [
  // Airtel
  { operator: 'Airtel', category: 'POPULAR',   price: 199,  validityDays: 28,  data: '1 GB/day',   sms: '100 SMS/day', description: 'Unlimited calls + 1GB/day' },
  { operator: 'Airtel', category: 'POPULAR',   price: 299,  validityDays: 28,  data: '1.5 GB/day', sms: '100 SMS/day', description: 'Unlimited calls + 1.5GB/day + Airtel Xstream' },
  { operator: 'Airtel', category: 'POPULAR',   price: 359,  validityDays: 28,  data: '2 GB/day',   sms: '100 SMS/day', description: 'Unlimited 5G + Wynk Music + Xstream Play' },
  { operator: 'Airtel', category: 'POPULAR',   price: 449,  validityDays: 56,  data: '1.5 GB/day', sms: '100 SMS/day', description: 'Two months of unlimited calls and data' },
  { operator: 'Airtel', category: 'UNLIMITED', price: 599,  validityDays: 56,  data: '2 GB/day',   sms: '100 SMS/day', description: 'Unlimited calls + 2GB/day for 2 months' },
  { operator: 'Airtel', category: 'UNLIMITED', price: 839,  validityDays: 84,  data: '2 GB/day',   sms: '100 SMS/day', description: 'Quarterly pack with unlimited 5G data' },
  { operator: 'Airtel', category: 'UNLIMITED', price: 1799, validityDays: 365, data: '24 GB',      sms: '3600 SMS',    description: 'Annual plan with unlimited calls' },
  { operator: 'Airtel', category: 'DATA',      price: 19,   validityDays: 1,   data: '1 GB',       description: 'One-day data booster' },
  { operator: 'Airtel', category: 'DATA',      price: 65,   validityDays: 30,  data: '4 GB',       description: 'Data top-up for existing pack' },
  { operator: 'Airtel', category: 'DATA',      price: 99,   validityDays: 28,  data: '6 GB',       description: 'Data top-up, no daily limit' },
  { operator: 'Airtel', category: 'TALKTIME',  price: 49,   validityDays: 28,  data: 'No data',    talktime: '₹38.11', description: 'Talktime top-up' },
  { operator: 'Airtel', category: 'TALKTIME',  price: 199,  validityDays: 30,  data: 'No data',    talktime: '₹160.41', description: 'Full talktime with 30-day validity' },

  // Jio
  { operator: 'Jio', category: 'POPULAR',   price: 189,  validityDays: 28,  data: '2 GB/day',   sms: '100 SMS/day', description: 'Unlimited 5G + JioTV and JioCinema' },
  { operator: 'Jio', category: 'POPULAR',   price: 299,  validityDays: 28,  data: '1.5 GB/day', sms: '100 SMS/day', description: 'Unlimited calls with JioApps suite' },
  { operator: 'Jio', category: 'POPULAR',   price: 349,  validityDays: 28,  data: '2 GB/day',   sms: '100 SMS/day', description: 'Unlimited 5G + JioTV, JioCinema included' },
  { operator: 'Jio', category: 'POPULAR',   price: 399,  validityDays: 28,  data: '2.5 GB/day', sms: '100 SMS/day', description: 'Highest daily data with unlimited 5G' },
  { operator: 'Jio', category: 'UNLIMITED', price: 799,  validityDays: 84,  data: '1.5 GB/day', sms: '100 SMS/day', description: 'Three months, unlimited calls' },
  { operator: 'Jio', category: 'UNLIMITED', price: 899,  validityDays: 90,  data: '2 GB/day',   sms: '100 SMS/day', description: 'Quarterly pack with unlimited 5G data' },
  { operator: 'Jio', category: 'UNLIMITED', price: 3599, validityDays: 365, data: '2.5 GB/day', sms: '100 SMS/day', description: 'Annual unlimited pack with 5G' },
  { operator: 'Jio', category: 'DATA',      price: 15,   validityDays: 1,   data: '1 GB',       description: 'Single-day data pack' },
  { operator: 'Jio', category: 'DATA',      price: 61,   validityDays: 30,  data: '6 GB',       description: 'Data voucher for existing plan' },
  { operator: 'Jio', category: 'DATA',      price: 121,  validityDays: 30,  data: '12 GB',      description: 'Bulk data voucher' },
  { operator: 'Jio', category: 'TALKTIME',  price: 20,   validityDays: 30,  data: 'No data',    talktime: '₹14.95', description: 'Small talktime top-up' },
  { operator: 'Jio', category: 'TALKTIME',  price: 100,  validityDays: 30,  data: 'No data',    talktime: '₹81.75', description: 'Talktime voucher' },

  // Vi
  { operator: 'Vi', category: 'POPULAR',   price: 179,  validityDays: 28,  data: '1 GB/day',   sms: '100 SMS/day', description: 'Unlimited calls + Weekend Data Rollover' },
  { operator: 'Vi', category: 'POPULAR',   price: 269,  validityDays: 28,  data: '1.5 GB/day', sms: '100 SMS/day', description: 'Unlimited calls + Binge All Night' },
  { operator: 'Vi', category: 'POPULAR',   price: 319,  validityDays: 30,  data: '2 GB/day',   sms: '100 SMS/day', description: 'Unlimited calls + Weekend Data Rollover' },
  { operator: 'Vi', category: 'UNLIMITED', price: 719,  validityDays: 56,  data: '1.5 GB/day', sms: '100 SMS/day', description: 'Binge All Night + Data Delights' },
  { operator: 'Vi', category: 'UNLIMITED', price: 901,  validityDays: 90,  data: '1.5 GB/day', sms: '100 SMS/day', description: 'Quarterly pack with night-time free data' },
  { operator: 'Vi', category: 'DATA',      price: 22,   validityDays: 1,   data: '2 GB',       description: 'One-day data pack' },
  { operator: 'Vi', category: 'DATA',      price: 118,  validityDays: 30,  data: '12 GB',      description: 'Bulk data pack' },
  { operator: 'Vi', category: 'TALKTIME',  price: 49,   validityDays: 28,  data: 'No data',    talktime: '₹39.37', description: 'Talktime top-up' },

  // BSNL
  { operator: 'BSNL', category: 'POPULAR',   price: 147,  validityDays: 30,  data: '10 GB',      sms: '100 SMS/day', description: 'Unlimited calls with 10GB bundled data' },
  { operator: 'BSNL', category: 'POPULAR',   price: 199,  validityDays: 30,  data: '2 GB/day',   sms: '100 SMS/day', description: 'Unlimited calls in all networks' },
  { operator: 'BSNL', category: 'UNLIMITED', price: 439,  validityDays: 90,  data: '1 GB/day',   sms: '100 SMS/day', description: 'Long validity quarterly plan' },
  { operator: 'BSNL', category: 'UNLIMITED', price: 797,  validityDays: 160, data: '2 GB/day',   sms: '100 SMS/day', description: 'Extra-long validity with daily data' },
  { operator: 'BSNL', category: 'DATA',      price: 47,   validityDays: 30,  data: '5 GB',       description: 'Data voucher' },
  { operator: 'BSNL', category: 'TALKTIME',  price: 30,   validityDays: 30,  data: 'No data',    talktime: '₹24.34', description: 'Talktime top-up' },
];

const BILLERS = [
  { name: 'TNEB - Tamil Nadu Electricity', category: 'ELECTRICITY', icon: 'bolt',      minRs: 50,  maxRs: 50000 },
  { name: 'BESCOM Bengaluru',              category: 'ELECTRICITY', icon: 'bolt',      minRs: 50,  maxRs: 50000 },
  { name: 'Adani Electricity Mumbai',      category: 'ELECTRICITY', icon: 'bolt',      minRs: 50,  maxRs: 50000 },
  { name: 'Tata Play',                     category: 'DTH',         icon: 'tv',        minRs: 100, maxRs: 12000 },
  { name: 'Airtel Digital TV',             category: 'DTH',         icon: 'tv',        minRs: 100, maxRs: 12000 },
  { name: 'Indane Gas',                    category: 'GAS',         icon: 'flame',     minRs: 200, maxRs: 10000 },
  { name: 'Mahanagar Gas',                 category: 'GAS',         icon: 'flame',     minRs: 100, maxRs: 20000 },
  { name: 'Chennai Metro Water',           category: 'WATER',       icon: 'droplet',   minRs: 50,  maxRs: 20000 },
  { name: 'ACT Fibernet',                  category: 'BROADBAND',   icon: 'wifi',      minRs: 300, maxRs: 25000 },
  { name: 'JioFiber',                      category: 'BROADBAND',   icon: 'wifi',      minRs: 300, maxRs: 25000 },
];

/**
 * Chronological demo history. Each event is expanded into one or two ledger
 * rows by the simulator below.
 *   transfer -> DEBIT for `from` + CREDIT for `to` sharing one referenceId
 *   topup    -> CREDIT
 *   recharge / bill -> DEBIT
 */
const EVENTS = [
  { at: daysAgo(42,  9, 15), type: 'topup',    user: 'sreeram', rs: 5000, label: 'Added via Net Banking', instrument: 'HDFC Bank' },
  { at: daysAgo(41, 13, 40), type: 'transfer', from: 'sreeram', to: 'ananya',  rs: 1200, note: 'Dinner at Murugan Idli' },
  { at: daysAgo(39, 19, 5),  type: 'recharge', user: 'ananya',  rs: 349,  operator: 'Jio',    mobile: '9812345678', data: '2 GB/day', validityDays: 28 },
  { at: daysAgo(37, 11, 22), type: 'transfer', from: 'priya',   to: 'sreeram', rs: 2500, note: 'Your share of the Goa trip' },
  { at: daysAgo(35, 20, 10), type: 'bill',     user: 'sreeram', rs: 1840, biller: 'TNEB - Tamil Nadu Electricity', consumer: 'TN4471902', category: 'ELECTRICITY' },
  { at: daysAgo(33,  8, 55), type: 'transfer', from: 'rahul',   to: 'sreeram', rs: 450,  note: 'Cab split' },
  { at: daysAgo(31, 16, 30), type: 'topup',    user: 'karthik', rs: 3000, label: 'Added via Debit Card',  instrument: 'XXXX XXXX XXXX 4412' },
  { at: daysAgo(29, 12, 12), type: 'transfer', from: 'sreeram', to: 'karthik', rs: 800,  note: 'Badminton court booking' },
  { at: daysAgo(27, 21, 45), type: 'recharge', user: 'sreeram', rs: 299,  operator: 'Airtel', mobile: '9876543210', data: '1.5 GB/day', validityDays: 28 },
  { at: daysAgo(25, 10, 5),  type: 'transfer', from: 'divya',   to: 'sreeram', rs: 3200, note: 'Freelance design work' },
  { at: daysAgo(24, 18, 20), type: 'bill',     user: 'ananya',  rs: 899,  biller: 'ACT Fibernet', consumer: 'ACT10029384', category: 'BROADBAND' },
  { at: daysAgo(22, 14, 0),  type: 'transfer', from: 'sreeram', to: 'priya',   rs: 1500, note: 'Rent share - March' },
  { at: daysAgo(20,  9, 30), type: 'topup',    user: 'sreeram', rs: 2000, label: 'Added via UPI', instrument: 'sreeram@okhdfcbank' },
  { at: daysAgo(18, 17, 15), type: 'transfer', from: 'ananya',  to: 'rahul',   rs: 640,  note: 'Movie tickets' },
  { at: daysAgo(16, 11, 48), type: 'bill',     user: 'sreeram', rs: 1150, biller: 'Tata Play', consumer: '1092384756', category: 'DTH' },
  { at: daysAgo(14, 13, 25), type: 'transfer', from: 'karthik', to: 'sreeram', rs: 275,  note: 'Coffee run' },
  { at: daysAgo(12, 19, 55), type: 'recharge', user: 'rahul',   rs: 319,  operator: 'Vi',     mobile: '9823456789', data: '2 GB/day', validityDays: 30 },
  { at: daysAgo(10, 15, 10), type: 'transfer', from: 'sreeram', to: 'divya',   rs: 950,  note: 'Birthday gift contribution' },
  { at: daysAgo(9,  10, 40), type: 'transfer', from: 'priya',   to: 'ananya',  rs: 1800, note: 'Concert tickets' },
  { at: daysAgo(7,  20, 30), type: 'bill',     user: 'sreeram', rs: 780,  biller: 'Indane Gas', consumer: 'IND55120', category: 'GAS' },
  { at: daysAgo(6,  12, 5),  type: 'topup',    user: 'sreeram', rs: 1500, label: 'Added via Debit Card', instrument: 'XXXX XXXX XXXX 8821' },
  { at: daysAgo(5,  18, 45), type: 'transfer', from: 'sreeram', to: 'rahul',   rs: 320,  note: 'Auto fare' },
  { at: daysAgo(4,  11, 20), type: 'transfer', from: 'divya',   to: 'karthik', rs: 1100, note: 'Groceries' },
  { at: daysAgo(3,  16, 0),  type: 'recharge', user: 'priya',   rs: 599,  operator: 'Airtel', mobile: '9834567890', data: '2 GB/day', validityDays: 56 },
  { at: daysAgo(2,  9,  25), type: 'transfer', from: 'ananya',  to: 'sreeram', rs: 2200, note: 'Repaying last month' },
  { at: daysAgo(1,  14, 35), type: 'transfer', from: 'sreeram', to: 'ananya',  rs: 640,  note: 'Lunch' },
  { at: daysAgo(1,  21, 10), type: 'bill',     user: 'karthik', rs: 460,  biller: 'Chennai Metro Water', consumer: 'CMW88213', category: 'WATER' },
  { at: daysAgo(0,  8,  50), type: 'transfer', from: 'rahul',   to: 'sreeram', rs: 1250, note: 'Weekend trip settle-up' },
];

async function main() {
  console.log('\nSeeding Paytm demo database...\n');

  // Wipe in dependency order so the seed is safely re-runnable.
  await prisma.ledgerEntry.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();
  await prisma.rechargePlan.deleteMany();
  await prisma.biller.deleteMany();

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  const userByKey = new Map();
  for (const spec of USERS) {
    const user = await prisma.user.create({
      data: {
        firstName: spec.firstName,
        lastName: spec.lastName,
        email: spec.email,
        phone: spec.phone,
        upiId: spec.upiId,
        passwordHash,
        avatarColor: pickAvatarColor(spec.email),
        createdAt: daysAgo(45),
        account: { create: { balancePaise: 0, createdAt: daysAgo(45) } },
      },
      include: { account: true },
    });
    userByKey.set(spec.key, user);
  }
  console.log(`  users            ${USERS.length}`);

  await prisma.rechargePlan.createMany({
    data: RECHARGE_PLANS.map((p) => ({
      operator: p.operator,
      category: p.category,
      pricePaise: p.price * RUPEE,
      validityDays: p.validityDays,
      data: p.data,
      talktime: p.talktime ?? null,
      sms: p.sms ?? null,
      description: p.description,
    })),
  });
  console.log(`  recharge plans   ${RECHARGE_PLANS.length}`);

  await prisma.biller.createMany({
    data: BILLERS.map((b) => ({
      name: b.name,
      category: b.category,
      icon: b.icon,
      minPaise: b.minRs * RUPEE,
      maxPaise: b.maxRs * RUPEE,
    })),
  });
  console.log(`  billers          ${BILLERS.length}`);

  // ---- simulate history in chronological order ------------------------------
  const balances = new Map();
  const rows = [];
  const fullName = (u) => `${u.firstName} ${u.lastName}`.trim();

  // Opening balances land in the passbook as the sign-up welcome credit.
  for (const spec of USERS) {
    const user = userByKey.get(spec.key);
    balances.set(spec.key, spec.openingPaise);
    rows.push({
      referenceId: buildReferenceId(),
      userId: user.id,
      direction: 'CREDIT',
      category: 'ADD_MONEY',
      status: 'SUCCESS',
      amountPaise: spec.openingPaise,
      balanceAfterPaise: spec.openingPaise,
      counterpartyName: 'Paytm Welcome Bonus',
      counterpartyHandle: 'paytm@demo',
      note: 'Demo money credited on sign up',
      metadata: JSON.stringify({ simulated: true, kind: 'SIGNUP_BONUS' }),
      createdAt: daysAgo(45),
    });
  }

  const credit = (key, paise) => {
    const next = balances.get(key) + paise;
    balances.set(key, next);
    return next;
  };
  const debit = (key, paise, when) => {
    const next = balances.get(key) - paise;
    if (next < 0) {
      throw new Error(
        `Seed event on ${when.toISOString()} would push ${key} negative ` +
          `(${formatINR(balances.get(key))} - ${formatINR(paise)}). Adjust EVENTS or openingPaise.`,
      );
    }
    balances.set(key, next);
    return next;
  };

  for (const event of [...EVENTS].sort((a, b) => a.at - b.at)) {
    const paise = event.rs * RUPEE;
    const referenceId = buildReferenceId();

    if (event.type === 'transfer') {
      const from = userByKey.get(event.from);
      const to = userByKey.get(event.to);
      rows.push({
        referenceId, userId: from.id, direction: 'DEBIT', category: 'TRANSFER', status: 'SUCCESS',
        amountPaise: paise, balanceAfterPaise: debit(event.from, paise, event.at),
        counterpartyId: to.id, counterpartyName: fullName(to), counterpartyHandle: to.upiId,
        note: event.note, createdAt: event.at,
      });
      rows.push({
        referenceId, userId: to.id, direction: 'CREDIT', category: 'TRANSFER', status: 'SUCCESS',
        amountPaise: paise, balanceAfterPaise: credit(event.to, paise),
        counterpartyId: from.id, counterpartyName: fullName(from), counterpartyHandle: from.upiId,
        note: event.note, createdAt: event.at,
      });
    } else if (event.type === 'topup') {
      rows.push({
        referenceId, userId: userByKey.get(event.user).id, direction: 'CREDIT', category: 'ADD_MONEY',
        status: 'SUCCESS', amountPaise: paise, balanceAfterPaise: credit(event.user, paise),
        counterpartyName: event.label, counterpartyHandle: event.instrument,
        note: 'Simulated top-up — no real bank was contacted',
        metadata: JSON.stringify({ simulated: true, method: event.label }),
        createdAt: event.at,
      });
    } else if (event.type === 'recharge') {
      rows.push({
        referenceId, userId: userByKey.get(event.user).id, direction: 'DEBIT', category: 'RECHARGE',
        status: 'SUCCESS', amountPaise: paise, balanceAfterPaise: debit(event.user, paise, event.at),
        counterpartyName: `${event.operator} Prepaid`, counterpartyHandle: event.mobile,
        note: `${event.data} for ${event.validityDays} days`,
        metadata: JSON.stringify({
          simulated: true, kind: 'MOBILE_RECHARGE', operator: event.operator,
          circle: 'All India', mobileNumber: event.mobile,
          validityDays: event.validityDays, data: event.data,
        }),
        createdAt: event.at,
      });
    } else if (event.type === 'bill') {
      rows.push({
        referenceId, userId: userByKey.get(event.user).id, direction: 'DEBIT', category: 'BILL_PAYMENT',
        status: 'SUCCESS', amountPaise: paise, balanceAfterPaise: debit(event.user, paise, event.at),
        counterpartyName: event.biller, counterpartyHandle: event.consumer,
        note: `${event.category.charAt(0)}${event.category.slice(1).toLowerCase()} bill payment`,
        metadata: JSON.stringify({
          simulated: true, kind: 'BILL_PAYMENT', billerName: event.biller,
          category: event.category, consumerNumber: event.consumer,
        }),
        createdAt: event.at,
      });
    }
  }

  await prisma.ledgerEntry.createMany({ data: rows });

  // Final account balances = the last simulated balance for each user.
  for (const spec of USERS) {
    await prisma.account.update({
      where: { userId: userByKey.get(spec.key).id },
      data: { balancePaise: balances.get(spec.key) },
    });
  }

  console.log(`  ledger entries   ${rows.length}\n`);
  console.log('  Demo accounts (password for all: %s)', DEMO_PASSWORD);
  console.log('  ' + '-'.repeat(72));
  for (const spec of USERS) {
    console.log(
      `  ${spec.email.padEnd(28)} ${spec.phone}  ${formatINR(balances.get(spec.key)).padStart(13)}`,
    );
  }
  console.log('  ' + '-'.repeat(72));
  console.log('\n  Sign in with any of the emails above (or the mobile number).\n');
}

main()
  .catch((err) => {
    console.error('\nSeeding failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
