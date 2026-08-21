/**
 * Seeds a demo-ready local database with EIGHTEEN MONTHS of behaviour.
 *
 * The original wallet seed wrote six weeks of hand-written events, which is
 * plenty for a passbook and useless for a behaviour engine: you cannot measure
 * savings consistency, income stability or commitment tenure over six weeks. So
 * this file simulates a small neighbourhood economy over eighteen months and
 * lets ten personas behave differently inside it.
 *
 * Four properties matter, and each is enforced rather than hoped for:
 *
 *  1. DETERMINISM. All variation comes from a seeded mulberry32 generator, never
 *     Math.random. The same seed produces byte-identical history on every
 *     machine, which is what lets a test assert an exact score.
 *
 *  2. UTC. Every date is built with Date.UTC. Local-calendar bucketing would put
 *     a late-night transaction in a different month depending on the machine's
 *     timezone, so the same data would score differently in Chennai and in
 *     San Francisco.
 *
 *  3. TRUTHFUL BALANCES. Events are simulated in chronological order and every
 *     row's balanceAfterPaise is what the wallet actually held at that moment.
 *     solveOpeningBalances() runs the whole simulation once with zero openings
 *     to discover each persona's deepest deficit, then funds them just enough —
 *     so "I added an event and the seed threw" cannot happen.
 *
 *  4. NO SHORTCUTS AROUND THE INVARIANTS. Group contributions are ordinary
 *     two-leg transfers, so the whole-database invariants (no negative wallet,
 *     balance equals the sum of its ledger, every transfer has one debit and one
 *     credit) hold by construction rather than by exemption.
 *
 * Run with:  npm run seed
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { buildReferenceId, pickAvatarColor } from '../src/lib/ids.js';
import { formatINR } from '../src/lib/money.js';
import { RECHARGE_PLANS, BILLERS } from './seed-catalogue.js';
import {
  PERSONAS,
  GROUPS,
  BUSINESSES,
  EVERYDAY_CONSENTS,
  UNDERWRITING_CONSENTS,
  SME_CONSENTS,
  CONSENT_PLAN,
} from './seed-personas.js';

const prisma = new PrismaClient();

const DEMO_PASSWORD = 'password123';
const RUPEE = 100;

/** One "now" for the whole run, so nothing drifts mid-seed. */
const NOW = new Date();

/** Grace period before an unpaid contribution counts as missed. Mirrors
 *  GRACE_DAYS in src/nambikai/groups.service.js. */
const GRACE_DAYS = { WEEKLY: 3, MONTHLY: 7 };

/* ----------------------------------------------------- deterministic RNG -- */

/**
 * mulberry32. Small, fast, and — the only property that matters here —
 * reproducible. Math.random would make every re-seed produce a different
 * history, so no test could ever assert a score and no two developers would see
 * the same demo.
 */
function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(0x4e424b31); // "NBK1"

const randInt = (min, max) => min + Math.floor(rand() * (max - min + 1));
const randRs = ([min, max]) => randInt(min, max);
const pick = (list) => list[Math.floor(rand() * list.length)];
const chance = (p) => rand() < p;

/* ------------------------------------------------------------ UTC dates -- */

const utc = (y, m, d, hh = 10, mm = 0) => new Date(Date.UTC(y, m, d, hh, mm, 0, 0));

/** `months` calendar months before now, on a given day-of-month. */
function monthsAgo(months, day = 1, hh = 10, mm = 0) {
  const base = utc(NOW.getUTCFullYear(), NOW.getUTCMonth() - months, 1, hh, mm);
  // Clamp the day so month lengths never roll a date into the next month.
  const lastDay = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  return utc(base.getUTCFullYear(), base.getUTCMonth(), Math.min(day, lastDay), hh, mm);
}

const daysAfter = (date, days, hh = 10, mm = 0) => {
  const d = new Date(date.getTime() + days * 86_400_000);
  return utc(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hh, mm);
};

const daysBetween = (from, to) => Math.max(0, Math.trunc((to.getTime() - from.getTime()) / 86_400_000));

/** Cycle due dates, computed exactly as src/nambikai/groups.service.js does. */
function cycleDueDate(startedAt, cadence, cycleIndex) {
  const n = cycleIndex - 1;
  if (cadence === 'WEEKLY') return new Date(startedAt.getTime() + n * 7 * 86_400_000);
  return utc(
    startedAt.getUTCFullYear(),
    startedAt.getUTCMonth() + n,
    startedAt.getUTCDate(),
    startedAt.getUTCHours(),
    startedAt.getUTCMinutes(),
  );
}

/* ------------------------------------------------------- event building -- */

const personaByKey = new Map(PERSONAS.map((p) => [p.key, p]));
const startOf = (persona) => monthsAgo(persona.tenureMonths, 2, 9, 0);

/** Behaviour rule in force for a member in a given month-ago offset. */
function behaviourFor(rules, monthsAgoValue) {
  if (!rules) return null;
  for (const rule of rules) {
    const afterStart = rule.from === undefined || monthsAgoValue <= rule.from;
    const beforeEnd = rule.until === undefined || monthsAgoValue >= rule.until;
    if (afterStart && beforeEnd) return rule;
  }
  return rules[rules.length - 1] ?? null;
}

/**
 * Turn the declarative personas and groups into a chronological event list,
 * plus the full contribution plan (including the ones that were never paid —
 * a missed cycle moves no money but is the single most important signal the
 * behaviour engine has).
 */
function buildEvents() {
  const events = [];
  const contributions = [];

  /* ---- per-persona monthly life ---- */
  for (const p of PERSONAS) {
    for (let m = p.tenureMonths - 1; m >= 0; m -= 1) {
      const decline = p.decline && m <= p.decline.fromMonthsAgo;
      const incomeFactor = decline ? p.decline.incomeFactor : 1;
      const spendFactor = decline ? p.decline.spendFactor : 1;
      const scale = (rs) => Math.max(1, Math.round(rs * spendFactor));

      // --- income ---
      if (p.topup) {
        events.push({
          at: monthsAgo(m, p.topup.day, 9, randInt(0, 55)),
          type: 'topup',
          user: p.key,
          rs: Math.round(randRs(p.topup.rs) * incomeFactor),
          label: p.topup.label,
          instrument: p.topup.instrument,
        });
      }

      if (p.freelance) {
        // Some months a freelancer simply does not get paid. That is the point.
        if (!chance(p.freelance.dryChance)) {
          const count = Math.max(1, randInt(...p.freelance.perMonth));
          for (let i = 0; i < count; i += 1) {
            events.push({
              at: monthsAgo(m, randInt(3, 26), randInt(10, 18), randInt(0, 59)),
              type: 'transfer',
              from: pick(p.freelance.from),
              to: p.key,
              rs: randRs(p.freelance.rs),
              note: 'Freelance project',
            });
          }
        }
      }

      // --- outflows ---
      // Every debit names a real counterparty, so one persona's spending IS
      // another persona's income. That is what makes the vendors' receipts look
      // like a genuine stream of small UPI payments rather than a synthetic
      // credit, and it gives the trust graph real supplier and customer edges.
      for (const block of p.buys ?? []) {
        const count = randInt(...block.perMonth);
        for (let i = 0; i < count; i += 1) {
          events.push({
            at: monthsAgo(m, randInt(1, 28), randInt(7, 21), randInt(0, 59)),
            type: 'transfer',
            from: p.key,
            to: block.who,
            rs: scale(randRs(block.rs)),
            note: block.note,
          });
        }
      }

      if (p.discretionary) {
        const count = randInt(...p.discretionary.perMonth);
        for (let i = 0; i < count; i += 1) {
          events.push({
            at: monthsAgo(m, randInt(1, 28), randInt(8, 21), randInt(0, 59)),
            type: 'transfer',
            from: p.key,
            to: pick(p.discretionary.to),
            rs: scale(randRs(p.discretionary.rs)),
            note: 'Sent to a friend',
          });
        }
      }

      for (const bill of p.bills ?? []) {
        if (bill.fromMonthsAgo !== undefined && m > bill.fromMonthsAgo) continue;
        // A persona under real pressure starts skipping bills.
        if (decline && chance(0.35)) continue;
        events.push({
          at: monthsAgo(m, bill.day, randInt(18, 21), randInt(0, 59)),
          type: 'bill',
          user: p.key,
          rs: scale(randRs(bill.rs)),
          biller: bill.biller,
          consumer: bill.consumer,
          category: bill.category,
        });
      }

      if (p.recharge && !(decline && chance(0.25))) {
        events.push({
          at: monthsAgo(m, p.recharge.day, randInt(9, 20), randInt(0, 59)),
          type: 'recharge',
          user: p.key,
          rs: p.recharge.rs,
          operator: p.recharge.operator,
          mobile: p.recharge.mobile,
          data: p.recharge.data,
          validityDays: p.recharge.validityDays,
        });
      }
    }
  }

  /* ---- group contributions ---- */
  for (const g of GROUPS) {
    const startedAt = monthsAgo(g.startedMonthsAgo, 5, 10, 0);
    const grace = GRACE_DAYS[g.cadence];
    const rotating = g.purpose === 'ROTATING_SAVINGS' || g.purpose === 'BUSINESS_POOL';

    for (let cycleIndex = 1; cycleIndex <= g.cycles; cycleIndex += 1) {
      const dueAt = cycleDueDate(startedAt, g.cadence, cycleIndex);
      const payoutKey = rotating ? g.members[(cycleIndex - 1) % g.members.length] : null;
      const collectorKey = rotating ? payoutKey : g.admin;

      for (const memberKey of g.members) {
        if (memberKey === collectorKey) continue; // the collector does not pay themselves

        const base = {
          groupKey: g.key,
          userKey: memberKey,
          cycleIndex,
          dueAt,
          payoutToKey: payoutKey,
        };

        // Not due yet: a real PENDING row, and the thing the demo can pay.
        if (dueAt > NOW) {
          contributions.push({ ...base, status: 'PENDING', daysLate: 0 });
          continue;
        }

        const monthsAgoValue = Math.round(daysBetween(dueAt, NOW) / 30);
        const rule = behaviourFor(g.behaviour[memberKey], monthsAgoValue) ?? { onTime: 1 };
        const roll = rand();
        const onTime = roll < (rule.onTime ?? 0);
        const late = !onTime && roll < (rule.onTime ?? 0) + (rule.late ?? 0);

        if (!onTime && !late) {
          // Still inside the grace window, so it is not missed yet — it is due.
          const status = daysBetween(dueAt, NOW) < grace ? 'PENDING' : 'MISSED';
          contributions.push({ ...base, status, daysLate: 0 });
          continue;
        }

        const daysLate = onTime ? 0 : randInt(1, grace);
        const paidAt = daysAfter(dueAt, daysLate, randInt(9, 19), randInt(0, 59));
        if (paidAt > NOW) {
          contributions.push({ ...base, status: 'PENDING', daysLate: 0 });
          continue;
        }

        const referenceId = buildReferenceId();
        contributions.push({ ...base, status: 'PAID', daysLate, paidAt, referenceId });
        events.push({
          at: paidAt,
          type: 'contribution',
          from: memberKey,
          to: collectorKey,
          rs: g.rs,
          referenceId,
          groupKey: g.key,
          groupName: g.name,
          cycleIndex,
          note: `${g.name} · cycle ${cycleIndex}`,
        });
      }
    }
  }

  // The current month is not over yet. Monthly events are placed on a random
  // day of the month, so without this the passbook would show transactions
  // dated into the future — and any "running balance equals the last row's
  // balanceAfterPaise" check would break the moment anything real was written
  // afterwards, because a future-dated row sorts after it.
  const dated = events.filter((e) => e.at <= NOW);
  dated.sort((a, b) => a.at - b.at);
  return { events: dated, contributions };
}

/* ----------------------------------------------------------- simulation -- */

/**
 * Walk the events in order, maintaining every wallet's running balance, and
 * produce the ledger rows. Called twice: once to discover how deep each persona
 * goes (probe mode), and once for real.
 */
function simulate(events, openings, { userByKey, probe }) {
  const balances = new Map();
  const lowest = new Map();
  const rows = [];
  const fullName = (u) => `${u.firstName} ${u.lastName}`.trim();

  const track = (key, value) => {
    if (!lowest.has(key) || value < lowest.get(key)) lowest.set(key, value);
  };

  for (const p of PERSONAS) {
    const opening = openings.get(p.key) ?? 0;
    balances.set(p.key, opening);
    track(p.key, opening);
    if (probe) continue;
    rows.push({
      referenceId: buildReferenceId(),
      userId: userByKey.get(p.key).id,
      direction: 'CREDIT',
      category: 'ADD_MONEY',
      status: 'SUCCESS',
      amountPaise: opening,
      balanceAfterPaise: opening,
      counterpartyName: 'Paytm Welcome Bonus',
      counterpartyHandle: 'paytm@demo',
      note: 'Demo money credited on sign up',
      metadata: JSON.stringify({ simulated: true, kind: 'SIGNUP_BONUS' }),
      createdAt: startOf(p),
    });
  }

  const credit = (key, paise) => {
    const next = balances.get(key) + paise;
    balances.set(key, next);
    track(key, next);
    return next;
  };

  const debit = (key, paise, when) => {
    const next = balances.get(key) - paise;
    balances.set(key, next);
    track(key, next);
    if (!probe && next < 0) {
      throw new Error(
        `Seed event on ${when.toISOString()} would push ${key} negative ` +
          `(${formatINR(balances.get(key) + paise)} - ${formatINR(paise)}). ` +
          `solveOpeningBalances should have made this unreachable.`,
      );
    }
    return next;
  };

  for (const event of events) {
    const paise = event.rs * RUPEE;

    if (event.type === 'transfer' || event.type === 'contribution') {
      const isContribution = event.type === 'contribution';
      const referenceId = event.referenceId ?? buildReferenceId();
      const metadata = isContribution
        ? JSON.stringify({
            simulated: true,
            kind: 'GROUP_CONTRIBUTION',
            groupKey: event.groupKey,
            groupName: event.groupName,
            cycleIndex: event.cycleIndex,
          })
        : null;

      const fromBalance = debit(event.from, paise, event.at);
      const toBalance = credit(event.to, paise);
      if (probe) continue;

      const from = userByKey.get(event.from);
      const to = userByKey.get(event.to);
      rows.push({
        referenceId, userId: from.id, direction: 'DEBIT', category: 'TRANSFER', status: 'SUCCESS',
        amountPaise: paise, balanceAfterPaise: fromBalance,
        counterpartyId: to.id, counterpartyName: fullName(to), counterpartyHandle: to.upiId,
        note: event.note, metadata, createdAt: event.at,
      });
      rows.push({
        referenceId, userId: to.id, direction: 'CREDIT', category: 'TRANSFER', status: 'SUCCESS',
        amountPaise: paise, balanceAfterPaise: toBalance,
        counterpartyId: from.id, counterpartyName: fullName(from), counterpartyHandle: from.upiId,
        note: event.note, metadata, createdAt: event.at,
      });
      continue;
    }

    if (event.type === 'topup') {
      const after = credit(event.user, paise);
      if (probe) continue;
      rows.push({
        referenceId: buildReferenceId(), userId: userByKey.get(event.user).id,
        direction: 'CREDIT', category: 'ADD_MONEY', status: 'SUCCESS',
        amountPaise: paise, balanceAfterPaise: after,
        counterpartyName: event.label, counterpartyHandle: event.instrument,
        note: 'Simulated top-up — no real bank was contacted',
        metadata: JSON.stringify({ simulated: true, method: event.label }),
        createdAt: event.at,
      });
      continue;
    }

    if (event.type === 'recharge') {
      const after = debit(event.user, paise, event.at);
      if (probe) continue;
      rows.push({
        referenceId: buildReferenceId(), userId: userByKey.get(event.user).id,
        direction: 'DEBIT', category: 'RECHARGE', status: 'SUCCESS',
        amountPaise: paise, balanceAfterPaise: after,
        counterpartyName: `${event.operator} Prepaid`, counterpartyHandle: event.mobile,
        note: `${event.data} for ${event.validityDays} days`,
        metadata: JSON.stringify({
          simulated: true, kind: 'MOBILE_RECHARGE', operator: event.operator,
          circle: 'All India', mobileNumber: event.mobile,
          validityDays: event.validityDays, data: event.data,
        }),
        createdAt: event.at,
      });
      continue;
    }

    if (event.type === 'bill') {
      const after = debit(event.user, paise, event.at);
      if (probe) continue;
      rows.push({
        referenceId: buildReferenceId(), userId: userByKey.get(event.user).id,
        direction: 'DEBIT', category: 'BILL_PAYMENT', status: 'SUCCESS',
        amountPaise: paise, balanceAfterPaise: after,
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

  return { rows, balances, lowest };
}

/**
 * Work out the smallest opening balance that keeps every wallet solvent.
 *
 * Pass one runs the entire simulation with zero openings and no negative guard,
 * recording how deep each persona goes. Pass two funds exactly that deficit plus
 * a comfort buffer. This removes an entire class of bug: adding an event can no
 * longer make the seed throw, so the test suite cannot be broken by a data edit.
 */
function solveOpeningBalances(events) {
  const zero = new Map(PERSONAS.map((p) => [p.key, 0]));
  const { lowest } = simulate(events, zero, { probe: true });

  const COMFORT = 3000 * RUPEE;
  const openings = new Map();
  for (const p of PERSONAS) {
    const deficit = Math.max(0, -(lowest.get(p.key) ?? 0));
    // Round up to a whole hundred rupees so the welcome credit reads like money.
    const rounded = Math.ceil((deficit + COMFORT) / (100 * RUPEE)) * (100 * RUPEE);
    openings.set(p.key, rounded);
  }
  return openings;
}

const chunk = (list, size) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

/* ----------------------------------------------------------------- main -- */

async function main() {
  console.log('\nSeeding Paytm + Nambikai demo database...\n');

  // Wipe in dependency order. The polymorphic Nambikai tables (BehaviourSignal,
  // TrustGraphEdge, ClusterTrustSignal) carry no foreign key by design, so
  // deleting users does NOT cascade to them — they must be listed explicitly or
  // stale signals from a previous run leak into the next demo.
  await prisma.consentAuditLog.deleteMany();
  await prisma.underwritingReport.deleteMany();
  await prisma.financialHealthScore.deleteMany();
  await prisma.clusterSignalAppeal.deleteMany();
  await prisma.clusterTrustSignal.deleteMany();
  await prisma.trustGraphEdge.deleteMany();
  await prisma.behaviourSignal.deleteMany();
  await prisma.consentRecord.deleteMany();
  await prisma.contribution.deleteMany();
  await prisma.groupMember.deleteMany();
  await prisma.group.deleteMany();
  await prisma.businessRecord.deleteMany();
  await prisma.business.deleteMany();
  await prisma.ledgerEntry.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();
  await prisma.rechargePlan.deleteMany();
  await prisma.biller.deleteMany();

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  const userByKey = new Map();
  for (const p of PERSONAS) {
    const createdAt = startOf(p);
    const user = await prisma.user.create({
      data: {
        firstName: p.firstName,
        lastName: p.lastName,
        email: p.email,
        phone: p.phone,
        upiId: p.upiId,
        passwordHash,
        avatarColor: pickAvatarColor(p.email),
        createdAt,
        account: { create: { balancePaise: 0, createdAt } },
      },
    });
    userByKey.set(p.key, user);
  }
  console.log(`  users              ${PERSONAS.length}`);

  await prisma.rechargePlan.createMany({
    data: RECHARGE_PLANS.map((p) => ({
      operator: p.operator, category: p.category, pricePaise: p.price * RUPEE,
      validityDays: p.validityDays, data: p.data, talktime: p.talktime ?? null,
      sms: p.sms ?? null, description: p.description,
    })),
  });
  await prisma.biller.createMany({
    data: BILLERS.map((b) => ({
      name: b.name, category: b.category, icon: b.icon,
      minPaise: b.minRs * RUPEE, maxPaise: b.maxRs * RUPEE,
    })),
  });
  console.log(`  recharge plans     ${RECHARGE_PLANS.length}`);
  console.log(`  billers            ${BILLERS.length}`);

  // ---- groups -------------------------------------------------------------
  const groupByKey = new Map();
  for (const g of GROUPS) {
    const startedAt = monthsAgo(g.startedMonthsAgo, 5, 10, 0);
    const created = await prisma.group.create({
      data: {
        name: g.name,
        purpose: g.purpose,
        cadence: g.cadence,
        contributionPaise: g.rs * RUPEE,
        plannedCycles: g.cycles,
        startedAt,
        status: 'ACTIVE',
        createdById: userByKey.get(g.admin).id,
        members: {
          create: g.members.map((key, i) => ({
            userId: userByKey.get(key).id,
            role: key === g.admin ? 'ADMIN' : 'MEMBER',
            payoutOrder: i + 1,
            // Founding members are in from cycle one, matching how the app
            // creates a backdated group.
            joinedAt: startedAt,
          })),
        },
      },
    });
    groupByKey.set(g.key, created);
  }
  console.log(`  savings groups     ${GROUPS.length}`);

  // ---- history ------------------------------------------------------------
  const { events, contributions } = buildEvents();
  const openings = solveOpeningBalances(events);
  const { rows, balances } = simulate(events, openings, { userByKey, probe: false });

  for (const batch of chunk(rows, 500)) {
    await prisma.ledgerEntry.createMany({ data: batch });
  }
  console.log(`  ledger entries     ${rows.length}`);

  // SQLite's createMany returns a count, not ids, so the paid contributions are
  // linked back to their debit legs by the referenceId they were written with.
  const contributionLegs = await prisma.ledgerEntry.findMany({
    where: {
      direction: 'DEBIT',
      referenceId: { in: contributions.filter((c) => c.referenceId).map((c) => c.referenceId) },
    },
    select: { id: true, referenceId: true, amountPaise: true },
  });
  const legByRef = new Map(contributionLegs.map((l) => [l.referenceId, l]));

  const contributionRows = contributions.map((c) => {
    const leg = c.referenceId ? legByRef.get(c.referenceId) : null;
    return {
      groupId: groupByKey.get(c.groupKey).id,
      userId: userByKey.get(c.userKey).id,
      cycleIndex: c.cycleIndex,
      dueAt: c.dueAt,
      paidAt: c.status === 'PAID' ? c.paidAt : null,
      amountDuePaise: groupByKey.get(c.groupKey).contributionPaise,
      // A paid contribution must agree with the ledger row it annotates.
      amountPaidPaise: leg ? leg.amountPaise : 0,
      status: c.status,
      daysLate: c.daysLate,
      ledgerEntryId: leg ? leg.id : null,
      payoutToUserId: c.payoutToKey ? userByKey.get(c.payoutToKey).id : null,
    };
  });

  for (const batch of chunk(contributionRows, 500)) {
    await prisma.contribution.createMany({ data: batch });
  }
  console.log(`  contributions      ${contributionRows.length}`);

  // ---- businesses ---------------------------------------------------------
  const businessByKey = new Map();
  for (const b of BUSINESSES) {
    const created = await prisma.business.create({
      data: {
        ownerId: userByKey.get(b.ownerKey).id,
        name: b.name,
        sector: b.sector,
        gstNumber: b.gstNumber,
        registeredAt: b.gstNumber ? monthsAgo(24, 1) : null,
        city: b.city,
        employeeCount: b.employeeCount,
        monthlyRevenueEstimatePaise: b.monthlyRevenueRs * RUPEE,
        monthlyInflowEstimatePaise: b.monthlyInflowRs * RUPEE,
        receivablesEstimatePaise: b.receivablesRs * RUPEE,
        existingDebtEstimatePaise: b.existingDebtRs * RUPEE,
      },
    });
    businessByKey.set(b.key, created);
  }
  // ---- the SME financial data layer -------------------------------------
  // Mock GST filings and invoices. These never touch Account or LedgerEntry, so
  // the wallet's whole-database invariants are untouched by the SME slice.
  const recordRows = [];
  for (const b of BUSINESSES) {
    const business = businessByKey.get(b.key);
    if (!b.gstNumber) continue; // an unregistered stall files nothing

    // 18 monthly GST filings, a couple of them late for the persona who needs a
    // compliance signal to exist.
    for (let m = 17; m >= 1; m -= 1) {
      const periodStart = monthsAgo(m, 1, 0, 0);
      const periodEnd = monthsAgo(m - 1, 1, 0, 0);
      const late = b.lateFilingMonths?.includes(m) ?? false;
      recordRows.push({
        businessId: business.id,
        kind: 'GST_FILING',
        periodStart,
        periodEnd,
        amountPaise: Math.round(b.monthlyRevenueRs * RUPEE * (0.85 + rand() * 0.3)),
        status: late ? 'LATE' : 'FILED',
        dueAt: daysAfter(periodEnd, 20, 18, 0),
        settledAt: daysAfter(periodEnd, late ? randInt(26, 40) : randInt(8, 19), 12, 0),
        metadata: JSON.stringify({ simulated: true, gstin: b.gstNumber }),
      });
    }

    // Trade invoices, with a realistic spread of settled, pending and overdue.
    const customers = ['Anna Nagar Retail', 'Mylapore Traders', 'Adyar Stores', 'T Nagar Bazaar', 'Velachery Mart'];
    for (let m = 11; m >= 0; m -= 1) {
      const count = randInt(6, 9);
      for (let i = 0; i < count; i += 1) {
        const issued = monthsAgo(m, randInt(1, 27), 11, 0);
        const dueAt = daysAfter(issued, 30, 18, 0);
        const roll = rand();
        // Older invoices have mostly settled; recent ones are still in flight.
        let status = 'PAID';
        let settledAt = daysAfter(issued, randInt(8, 34), 14, 0);
        if (m <= 1 && roll < 0.45) {
          status = 'PENDING';
          settledAt = null;
        } else if (roll > 0.9) {
          status = 'OVERDUE';
          settledAt = null;
        }
        if (settledAt && settledAt > NOW) {
          status = 'PENDING';
          settledAt = null;
        }
        recordRows.push({
          businessId: business.id,
          kind: 'INVOICE',
          periodStart: issued,
          periodEnd: dueAt,
          amountPaise: randInt(4000, 26000) * RUPEE,
          status,
          counterpartyName: customers[Math.floor(rand() * customers.length)],
          dueAt,
          settledAt,
          metadata: JSON.stringify({ simulated: true }),
        });
      }
    }
  }

  for (const batch of chunk(recordRows, 500)) {
    await prisma.businessRecord.createMany({ data: batch });
  }
  console.log(`  businesses         ${BUSINESSES.length}`);
  console.log(`  business records   ${recordRows.length}`);

  // ---- consent ------------------------------------------------------------
  // Granted thirty days ago, with a matching GRANT row in the audit log — a
  // consent that appears from nowhere with no trail would undercut the whole
  // point of the layer.
  const grantedAt = new Date(NOW.getTime() - 30 * 86_400_000);
  const consentRows = [];
  const auditRows = [];

  for (const p of PERSONAS) {
    const plan = CONSENT_PLAN[p.key] ?? { everyday: false, underwriting: false };
    const wanted = [
      ...(plan.everyday ? EVERYDAY_CONSENTS : []),
      ...(plan.underwriting ? UNDERWRITING_CONSENTS : []),
    ];
    for (const { dataType, purpose } of wanted) {
      consentRows.push({
        subjectType: 'USER',
        subjectId: userByKey.get(p.key).id,
        userId: userByKey.get(p.key).id,
        dataType,
        purpose,
        scope: JSON.stringify({ windowDays: 365, partnerIds: [] }),
        version: 1,
        grantedAt,
      });
    }
  }

  // Business consents are held against the BUSINESS as subject, granted by its
  // owner — so revoking a personal permission does not silently disable an SME
  // assessment, and vice versa.
  for (const b of BUSINESSES) {
    const business = businessByKey.get(b.key);
    for (const { dataType, purpose } of SME_CONSENTS) {
      consentRows.push({
        subjectType: 'BUSINESS',
        subjectId: business.id,
        userId: userByKey.get(b.ownerKey).id,
        dataType,
        purpose,
        scope: JSON.stringify({ windowDays: 365, partnerIds: [] }),
        version: 1,
        grantedAt,
      });
    }
  }

  await prisma.consentRecord.createMany({ data: consentRows });

  for (const record of await prisma.consentRecord.findMany()) {
    auditRows.push({
      consentRecordId: record.id,
      subjectType: record.subjectType,
      subjectId: record.subjectId,
      dataType: record.dataType,
      purpose: record.purpose,
      action: 'GRANT',
      actor: 'USER',
      actorId: record.userId,
      requestId: `seed-${record.id}`,
      createdAt: grantedAt,
    });
  }
  await prisma.consentAuditLog.createMany({ data: auditRows });
  console.log(`  consent records    ${consentRows.length}`);

  // ---- final balances -----------------------------------------------------
  for (const p of PERSONAS) {
    await prisma.account.update({
      where: { userId: userByKey.get(p.key).id },
      data: { balancePaise: balances.get(p.key) },
    });
  }

  // ---- summary ------------------------------------------------------------
  const stats = new Map(PERSONAS.map((p) => [p.key, { paid: 0, late: 0, missed: 0, due: 0 }]));
  for (const c of contributions) {
    const s = stats.get(c.userKey);
    s.due += 1;
    if (c.status === 'PAID') {
      s.paid += 1;
      if (c.daysLate > 0) s.late += 1;
    } else if (c.status === 'MISSED') s.missed += 1;
  }

  console.log(`\n  Demo accounts (password for all: ${DEMO_PASSWORD})`);
  console.log('  ' + '-'.repeat(94));
  console.log(
    '  ' +
      'email'.padEnd(24) +
      'mobile'.padEnd(13) +
      'balance'.padStart(13) +
      '  months'.padEnd(9) +
      'contributions',
  );
  console.log('  ' + '-'.repeat(94));
  for (const p of PERSONAS) {
    const s = stats.get(p.key);
    const record = s.due
      ? `${s.paid - s.late} on time, ${s.late} late, ${s.missed} missed of ${s.due}`
      : 'no group history';
    console.log(
      `  ${p.email.padEnd(24)}${p.phone.padEnd(13)}${formatINR(balances.get(p.key)).padStart(13)}` +
        `  ${String(p.tenureMonths).padStart(6)}   ${record}`,
    );
  }
  console.log('  ' + '-'.repeat(94));
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
