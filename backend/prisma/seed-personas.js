/**
 * The cast of the demo, and the behaviour each persona is built to demonstrate.
 *
 * This file is deliberately declarative: it describes WHAT each persona's money
 * looks like, and seed.js turns that into eighteen months of ledger rows. The
 * point is that every persona is a different, legible story for the behaviour
 * engine to find — not ten variations of "some transactions happened".
 *
 * The six original wallet personas keep their exact emails, phones and UPI ids,
 * so the README's demo credentials and the existing tests still hold.
 *
 * MONEY CIRCULATES. Vendors (Karthik's tea stall, Meena's provisions store) are
 * paid by the salaried personas, and Karthik buys his supplies from Meena. That
 * closes the loop: nobody is funded by an invisible faucet, the trust graph has
 * real supplier and customer edges to find, and a vendor's income genuinely is a
 * stream of small UPI receipts rather than a single synthetic credit.
 */

/** 18 months of history for everyone except the deliberately-new persona. */
export const TENURE_MONTHS = 18;

export const PERSONAS = [
  {
    key: 'karthik',
    firstName: 'Karthik',
    lastName: 'Balaji',
    email: 'karthik@paytm.test',
    phone: '9845678901',
    upiId: 'karthik.balaji@paytm',
    tenureMonths: 18,
    headline: 'Tea stall owner · the thin-file hero',
    demonstrates:
      'Invisible to a credit bureau, obvious to Nambikai: 18 months of small daily receipts and a perfect savings-group record.',
    // No income block. A vendor's income is simply what his customers send him,
    // which the buyers below declare. Nobody is funded by an invisible faucet.
    buys: [
      { who: 'meena', perMonth: [5, 8], rs: [900, 2400], note: 'Stock purchase' },
      { who: 'meena', perMonth: [2, 3], rs: [300, 800], note: 'Daily expenses' },
    ],
    bills: [
      { biller: 'TNEB - Tamil Nadu Electricity', consumer: 'TN9930112', category: 'ELECTRICITY', rs: [420, 780], day: 19, fromMonthsAgo: 12 },
      { biller: 'Chennai Metro Water', consumer: 'CMW88213', category: 'WATER', rs: [180, 320], day: 24, fromMonthsAgo: 9 },
    ],
    recharge: { operator: 'Jio', mobile: '9845678901', rs: 189, data: '2 GB/day', validityDays: 28, day: 12 },
  },
  {
    key: 'sreeram',
    firstName: 'Sreeram',
    lastName: 'R',
    email: 'sreeram@paytm.test',
    phone: '9876543210',
    upiId: 'sreeram.r@paytm',
    tenureMonths: 18,
    headline: 'Salaried · the healthy baseline',
    demonstrates: 'What a strong score looks like: steady top-ups, a real buffer, contributions always on time.',
    // A Paytm wallet is spending money, not a salary account — so the top-up is
    // what a salaried person actually loads, not their full pay. Modelling the
    // whole salary here would inject far more money than the demo economy can
    // circulate, and every wallet would drift into lakhs.
    topup: { rs: [19000, 22000], day: 1, label: 'Added from Salary Account', instrument: 'HDFC Bank' },
    buys: [
      { who: 'karthik', perMonth: [18, 26], rs: [60, 220], note: 'Tea stall' },
      { who: 'meena', perMonth: [7, 10], rs: [700, 2400], note: 'Groceries' },
    ],
    discretionary: { to: ['ananya', 'rahul', 'divya'], perMonth: [1, 3], rs: [400, 1600] },
    bills: [
      { biller: 'TNEB - Tamil Nadu Electricity', consumer: 'TN4471902', category: 'ELECTRICITY', rs: [1500, 2300], day: 18 },
      { biller: 'ACT Fibernet', consumer: 'ACT10029384', category: 'BROADBAND', rs: [899, 1199], day: 6 },
      { biller: 'Tata Play', consumer: '1092384756', category: 'DTH', rs: [400, 600], day: 26 },
    ],
    recharge: { operator: 'Airtel', mobile: '9876543210', rs: 299, data: '1.5 GB/day', validityDays: 28, day: 22 },
  },
  {
    key: 'ananya',
    firstName: 'Ananya',
    lastName: 'Iyer',
    email: 'ananya@paytm.test',
    phone: '9812345678',
    upiId: 'ananya.iyer@paytm',
    tenureMonths: 18,
    headline: 'High earner, spends it all',
    demonstrates:
      'Good income is not a good score. Large inflows, near-zero net flow, and a buffer measured in days.',
    topup: { rs: [36000, 41000], day: 2, label: 'Added from Salary Account', instrument: 'ICICI Bank' },
    buys: [
      { who: 'karthik', perMonth: [16, 24], rs: [60, 240], note: 'Tea stall' },
      { who: 'meena', perMonth: [9, 13], rs: [900, 2600], note: 'Groceries' },
    ],
    discretionary: { to: ['sreeram', 'rahul', 'divya', 'priya'], perMonth: [4, 7], rs: [900, 2600] },
    bills: [
      { biller: 'Adani Electricity Mumbai', consumer: 'AEM7781234', category: 'ELECTRICITY', rs: [2600, 4200], day: 14 },
      { biller: 'ACT Fibernet', consumer: 'ACT77120934', category: 'BROADBAND', rs: [1299, 1599], day: 8 },
      { biller: 'Mahanagar Gas', consumer: 'MGL99231', category: 'GAS', rs: [700, 1100], day: 21 },
    ],
    recharge: { operator: 'Jio', mobile: '9812345678', rs: 399, data: '2.5 GB/day', validityDays: 28, day: 16 },
  },
  {
    key: 'rahul',
    firstName: 'Rahul',
    lastName: 'Menon',
    email: 'rahul@paytm.test',
    phone: '9823456789',
    upiId: 'rahul.menon@paytm',
    tenureMonths: 18,
    headline: 'Was fine, then wasn’t',
    demonstrates:
      'A score that moves. Twelve good months, then lost work: income falls, the buffer drains, contributions slip and gates fire.',
    topup: { rs: [21000, 24000], day: 3, label: 'Added from Salary Account', instrument: 'Axis Bank' },
    // From six months ago the income drops and the spending does not keep pace.
    // Income collapses; the bills, the rent and the habits do not. That gap is
    // the whole story, and a spendFactor near 1 is what makes the buffer drain
    // instead of politely shrinking alongside the income.
    decline: { fromMonthsAgo: 6, incomeFactor: 0.35, spendFactor: 0.95 },
    buys: [
      { who: 'karthik', perMonth: [10, 16], rs: [60, 220], note: 'Tea stall' },
      { who: 'meena', perMonth: [8, 12], rs: [900, 2600], note: 'Groceries' },
    ],
    discretionary: { to: ['sreeram', 'ananya'], perMonth: [2, 3], rs: [600, 2200] },
    bills: [
      { biller: 'BESCOM Bengaluru', consumer: 'BES4410023', category: 'ELECTRICITY', rs: [3200, 4600], day: 17 },
      { biller: 'JioFiber', consumer: 'JIO88213409', category: 'BROADBAND', rs: [699, 999], day: 9 },
      { biller: 'Indane Gas', consumer: 'IND44100', category: 'GAS', rs: [820, 1000], day: 25 },
    ],
    recharge: { operator: 'Vi', mobile: '9823456789', rs: 319, data: '2 GB/day', validityDays: 30, day: 20 },
  },
  {
    key: 'priya',
    firstName: 'Priya',
    lastName: 'Nair',
    email: 'priya@paytm.test',
    phone: '9834567890',
    upiId: 'priya.nair@paytm',
    tenureMonths: 18,
    headline: 'Solid, but no group history',
    demonstrates:
      'The weight-redistribution case. She never joined a circle, so COMMITMENTS is unmeasured — she is scored on what is visible, not punished for a blank.',
    topup: { rs: [26000, 29000], day: 1, label: 'Added from Salary Account', instrument: 'SBI' },
    buys: [
      { who: 'karthik', perMonth: [14, 20], rs: [60, 220], note: 'Tea stall' },
      { who: 'meena', perMonth: [7, 10], rs: [800, 2200], note: 'Groceries' },
    ],
    discretionary: { to: ['ananya', 'divya'], perMonth: [1, 2], rs: [500, 2000] },
    bills: [
      { biller: 'TNEB - Tamil Nadu Electricity', consumer: 'TN2219087', category: 'ELECTRICITY', rs: [1100, 1800], day: 15 },
      { biller: 'Indane Gas', consumer: 'IND55120', category: 'GAS', rs: [780, 950], day: 27 },
    ],
    recharge: { operator: 'Airtel', mobile: '9834567890', rs: 599, data: '2 GB/day', validityDays: 56, day: 11 },
  },
  {
    key: 'divya',
    firstName: 'Divya',
    lastName: 'Krishnan',
    email: 'divya@paytm.test',
    phone: '9856789012',
    upiId: 'divya.krishnan@paytm',
    tenureMonths: 18,
    headline: 'Freelancer · lumpy income, disciplined saver',
    demonstrates:
      'Categories that disagree. Income stability is poor by construction; savings consistency is excellent. A single number would hide both.',
    // Project work: some months are feast, some are nothing at all.
    freelance: { from: ['ananya', 'sreeram', 'priya', 'meena'], perMonth: [1, 3], rs: [3000, 19000], dryChance: 0.3 },
    buys: [
      { who: 'karthik', perMonth: [10, 16], rs: [60, 220], note: 'Tea stall' },
      { who: 'meena', perMonth: [8, 12], rs: [900, 2400], note: 'Groceries' },
    ],
    discretionary: { to: ['ananya', 'priya', 'karthik'], perMonth: [1, 3], rs: [600, 2600] },
    bills: [
      { biller: 'JioFiber', consumer: 'JIO55120987', category: 'BROADBAND', rs: [899, 999], day: 7 },
      { biller: 'BESCOM Bengaluru', consumer: 'BES9912034', category: 'ELECTRICITY', rs: [1100, 1900], day: 19 },
    ],
    recharge: { operator: 'Jio', mobile: '9856789012', rs: 349, data: '2 GB/day', validityDays: 28, day: 14 },
  },
  {
    key: 'meena',
    firstName: 'Meena',
    lastName: 'Sundaram',
    email: 'meena@paytm.test',
    phone: '9867012345',
    upiId: 'meena.sundaram@paytm',
    tenureMonths: 18,
    headline: 'Provisions store owner · runs two circles',
    demonstrates: 'The group admin, and an SME with GST filings and receivables on top of a personal score.',
    // The shop's income is what the neighbourhood spends there; the shop's cost
    // is wholesale stock from the two traders. That closes the loop.
    buys: [
      { who: 'vignesh', perMonth: [4, 6], rs: [4000, 9500], note: 'Wholesale stock' },
      { who: 'lakshmi', perMonth: [4, 6], rs: [3500, 8500], note: 'Wholesale stock' },
      { who: 'karthik', perMonth: [3, 5], rs: [60, 200], note: 'Tea stall' },
    ],
    discretionary: { to: ['divya'], perMonth: [1, 2], rs: [2000, 6000] },
    bills: [
      // Commercial connection: a provisions store's power bill is an order of
      // magnitude above a household's, and it is the largest single cost here.
      { biller: 'TNEB - Tamil Nadu Electricity', consumer: 'TN6612340', category: 'ELECTRICITY', rs: [18000, 24000], day: 16 },
      { biller: 'Chennai Metro Water', consumer: 'CMW44120', category: 'WATER', rs: [1400, 2400], day: 23 },
      { biller: 'Mahanagar Gas', consumer: 'MGL66120', category: 'GAS', rs: [1800, 2600], day: 11 },
    ],
    recharge: { operator: 'BSNL', mobile: '9867012345', rs: 199, data: '2 GB/day', validityDays: 30, day: 10 },
  },
  {
    key: 'vignesh',
    firstName: 'Vignesh',
    lastName: 'Kumar',
    email: 'vignesh@paytm.test',
    phone: '9878123456',
    upiId: 'vignesh.kumar@paytm',
    tenureMonths: 18,
    headline: 'Trader in a struggling pool · opted out of cluster scoring',
    demonstrates:
      'Cluster scoring is opt-in. He never consented, so his report carries cluster_signal: null with CLUSTER_SIGNAL_NOT_CONSENTED.',
    buys: [
      { who: 'lakshmi', perMonth: [3, 5], rs: [3500, 8500], note: 'Trade settlement' },
      { who: 'karthik', perMonth: [6, 10], rs: [60, 220], note: 'Tea stall' },
      { who: 'meena', perMonth: [6, 9], rs: [900, 2400], note: 'Groceries' },
    ],
    bills: [
      { biller: 'TNEB - Tamil Nadu Electricity', consumer: 'TN7781200', category: 'ELECTRICITY', rs: [13000, 17000], day: 20 },
      { biller: 'Mahanagar Gas', consumer: 'MGL77812', category: 'GAS', rs: [3600, 5200], day: 6 },
    ],
    recharge: { operator: 'Vi', mobile: '9878123456', rs: 269, data: '1.5 GB/day', validityDays: 28, day: 18 },
  },
  {
    key: 'lakshmi',
    firstName: 'Lakshmi',
    lastName: 'Devi',
    email: 'lakshmi@paytm.test',
    phone: '9889234567',
    upiId: 'lakshmi.devi@paytm',
    tenureMonths: 18,
    headline: 'Reliable trader in an unreliable pool · has an open appeal',
    demonstrates:
      'The fairness case the guardrails exist for. She pays every contribution on time; her pool does not. Her appeal suppresses the cluster signal immediately.',
    buys: [
      { who: 'vignesh', perMonth: [3, 5], rs: [3000, 7500], note: 'Trade settlement' },
      { who: 'karthik', perMonth: [6, 10], rs: [60, 220], note: 'Tea stall' },
      { who: 'meena', perMonth: [4, 7], rs: [700, 1800], note: 'Groceries' },
    ],
    bills: [
      { biller: 'TNEB - Tamil Nadu Electricity', consumer: 'TN3312876', category: 'ELECTRICITY', rs: [11000, 15000], day: 21 },
      { biller: 'Indane Gas', consumer: 'IND77230', category: 'GAS', rs: [2600, 3600], day: 28 },
    ],
    recharge: { operator: 'Airtel', mobile: '9889234567', rs: 199, data: '1 GB/day', validityDays: 28, day: 13 },
  },
  {
    key: 'arjun',
    firstName: 'Arjun',
    lastName: 'Pillai',
    email: 'arjun@paytm.test',
    phone: '9890345678',
    upiId: 'arjun.pillai@paytm',
    // Deliberately new. Everything about this persona is "not enough yet".
    tenureMonths: 2,
    headline: 'Brand new · not enough history to score',
    demonstrates:
      'Two walls in one: the consent gate (he has granted nothing) and GATE_INSUFFICIENT_HISTORY. An honest "we cannot say yet" beats a confident guess.',
    topup: { rs: [6000, 7500], day: 4, label: 'Added from Salary Account', instrument: 'Kotak' },
    buys: [
      { who: 'karthik', perMonth: [4, 8], rs: [60, 200], note: 'Tea stall' },
      { who: 'meena', perMonth: [3, 5], rs: [400, 900], note: 'Groceries' },
    ],
    bills: [{ biller: 'Chennai Metro Water', consumer: 'CMW10093', category: 'WATER', rs: [200, 300], day: 22 }],
    recharge: { operator: 'Jio', mobile: '9890345678', rs: 189, data: '2 GB/day', validityDays: 28, day: 15 },
  },
];

/**
 * The three savings circles, and exactly how each member behaves in each one.
 *
 * `behaviour` is per member: `onTime` is the probability a due contribution is
 * paid on the day, `late` the probability it is paid within the grace period,
 * and whatever remains is MISSED. Rates are drawn with the seeded RNG so the
 * same numbers come out on every machine.
 *
 * `from`/`until` (months ago) let a member's behaviour change partway through —
 * that is how Rahul's decline shows up as a falling score rather than a flat one.
 */
export const GROUPS = [
  {
    key: 'annanagar',
    name: 'Anna Nagar Vendors Chit',
    purpose: 'ROTATING_SAVINGS',
    cadence: 'MONTHLY',
    rs: 2000,
    startedMonthsAgo: 15,
    // One cycle beyond the elapsed count, so the newest cycle is still open and
    // the demo always has a real contribution to pay rather than a closed history.
    cycles: 17,
    // Order is the payout rotation.
    members: ['meena', 'karthik', 'rahul', 'sreeram', 'ananya', 'divya'],
    admin: 'meena',
    behaviour: {
      meena: [{ onTime: 1 }],
      karthik: [{ onTime: 1 }], // the hero's record: never once late
      sreeram: [{ onTime: 1 }],
      ananya: [{ onTime: 0.86, late: 0.14 }],
      divya: [{ onTime: 0.93, late: 0.07 }],
      rahul: [
        { until: 7, onTime: 1 },
        { from: 6, onTime: 0.1, late: 0.45 }, // the decline, visible cycle by cycle
      ],
    },
  },
  {
    key: 'besantnagar',
    name: 'Besant Nagar Savers',
    purpose: 'SAVINGS',
    cadence: 'WEEKLY',
    rs: 500,
    startedMonthsAgo: 7,
    cycles: 34,
    members: ['sreeram', 'karthik', 'divya', 'ananya'],
    admin: 'sreeram', // in a savings circle the admin collects
    behaviour: {
      karthik: [{ onTime: 1 }],
      divya: [{ onTime: 0.97, late: 0.03 }],
      ananya: [{ onTime: 0.9, late: 0.1 }],
    },
  },
  {
    key: 'tnagar',
    name: 'T Nagar Traders Pool',
    purpose: 'BUSINESS_POOL',
    cadence: 'MONTHLY',
    rs: 5000,
    startedMonthsAgo: 9,
    cycles: 12,
    members: ['meena', 'vignesh', 'lakshmi', 'rahul'],
    admin: 'meena',
    // Tuned so the pool lands in the CAUTION band. That is the whole point of
    // this group: Lakshmi is personally impeccable inside a pool that is not,
    // which is exactly the unfairness the cluster guardrails exist to prevent.
    behaviour: {
      lakshmi: [{ onTime: 1 }], // impeccable, inside a pool that is not
      meena: [{ onTime: 0.15, late: 0.35 }], // even the admin is struggling here
      vignesh: [{ onTime: 0, late: 0 }],
      rahul: [
        { until: 7, onTime: 1 },
        { from: 6, onTime: 0, late: 0 },
      ],
    },
  },
];

/** Businesses for the SME slice (Phase 8 fills in their GST and invoice records). */
export const BUSINESSES = [
  {
    key: 'karthik-tea',
    ownerKey: 'karthik',
    name: 'Karthik Tea Stall',
    sector: 'FOOD',
    gstNumber: null, // unregistered — the point of the thin-file story
    city: 'Chennai',
    employeeCount: 1,
    monthlyRevenueRs: 14000,
    monthlyInflowRs: 13000,
    receivablesRs: 0,
    existingDebtRs: 18000,
  },
  {
    key: 'meena-provisions',
    ownerKey: 'meena',
    name: 'Meena Provisions',
    sector: 'RETAIL',
    gstNumber: '33AABCM9603R1ZM',
    // Two late filings in the last six periods, so GST compliance is a real
    // signal with a downside rather than a row of perfect ticks.
    lateFilingMonths: [3, 5],
    city: 'Chennai',
    employeeCount: 3,
    monthlyRevenueRs: 62000,
    monthlyInflowRs: 58000,
    receivablesRs: 42000,
    existingDebtRs: 180000,
  },
];

/**
 * Seeded consent.
 *
 * Most personas have granted the everyday permissions thirty days ago, so the
 * demo does not dead-end on a wall the moment you sign in. Two deliberately have
 * not, because the refusal path has to be demonstrable too:
 *
 *   - Arjun has granted NOTHING. Signing in as him shows the consent wall, which
 *     is the honest state for someone who has not opted in — not a zero score.
 *   - Vignesh has the everyday permissions but has NOT opted in to cluster
 *     scoring, so his report carries cluster_signal: null with
 *     CLUSTER_SIGNAL_NOT_CONSENTED rather than a number he never agreed to.
 *
 * Nobody is granted CLUSTER_TRUST_SIGNAL by default. It is opt-in, and a seed
 * that quietly switched it on for everyone would make the opt-in meaningless.
 */
export const EVERYDAY_CONSENTS = [
  { dataType: 'WALLET_LEDGER', purpose: 'HEALTH_SCORE' },
  { dataType: 'GROUP_CONTRIBUTIONS', purpose: 'HEALTH_SCORE' },
  { dataType: 'WALLET_LEDGER', purpose: 'ASSISTANT' },
];

/**
 * Granted by business owners. SME_UNDERWRITING is deliberately its own purpose:
 * consenting to a personal score never implies consenting to have your shop
 * assessed, and vice versa.
 */
export const SME_CONSENTS = [
  { dataType: 'WALLET_LEDGER', purpose: 'SME_UNDERWRITING' },
  { dataType: 'BUSINESS_GST', purpose: 'SME_UNDERWRITING' },
  { dataType: 'BUSINESS_INVOICES', purpose: 'SME_UNDERWRITING' },
];

/** Granted only by personas who are ready to approach a lender. */
export const UNDERWRITING_CONSENTS = [
  { dataType: 'WALLET_LEDGER', purpose: 'UNDERWRITING' },
  { dataType: 'GROUP_CONTRIBUTIONS', purpose: 'UNDERWRITING' },
  { dataType: 'BILL_PAYMENTS', purpose: 'UNDERWRITING' },
  { dataType: 'LOAN_HISTORY', purpose: 'UNDERWRITING' },
];

/** Conduct is a separate disclosure from existence — see loan.features.js. */
export const REPAYMENT_CONSENTS = [
  { dataType: 'REPAYMENT_HISTORY', purpose: 'UNDERWRITING' },
  // Also for the person's OWN score screen. Seeing your own repayment record is
  // not a disclosure to anyone — it is the strongest positive signal the engine
  // holds about you, and hiding it from you while showing it to a lender would
  // be exactly backwards.
  { dataType: 'LOAN_HISTORY', purpose: 'HEALTH_SCORE' },
  { dataType: 'REPAYMENT_HISTORY', purpose: 'HEALTH_SCORE' },
];

export const CONSENT_PLAN = {
  // The hero is mid-application: everything a lender-facing report needs.
  karthik: { everyday: true, underwriting: true },
  sreeram: { everyday: true, underwriting: true },
  ananya: { everyday: true, underwriting: false },
  rahul: { everyday: true, underwriting: true },
  priya: { everyday: true, underwriting: false },
  divya: { everyday: true, underwriting: true },
  meena: { everyday: true, underwriting: true },
  // Opted out of cluster scoring specifically — see above.
  vignesh: { everyday: true, underwriting: true },
  // Personally impeccable, inside a CAUTION pool. She needs the appeal path.
  lakshmi: { everyday: true, underwriting: true },
  // Granted nothing at all. This is the consent wall.
  arjun: { everyday: false, underwriting: false },
};

/**
 * Seeded loan history.
 *
 * Every persona here exists to make one property of the lending layer visible on
 * first load, rather than requiring someone to take a loan and wait a year.
 *
 * `behaviour` is per instalment index, drawn from the seeded RNG:
 *   onTime — paid on the due date
 *   late   — paid within `lateDays` of it
 *   missed — never paid
 */
export const LOAN_PLAN = {
  // The hero, mid-loan and flawless. Shows REPAYMENT_TRACK_RECORD lifting a
  // thin-file score, and the graduated cap starting to lift.
  karthik: {
    partnerId: 'partner_demo_mfi',
    productKey: 'mfi_chit_advance',
    purpose: 'WORKING_CAPITAL',
    principalRs: 20000,
    rateBps: 2800,
    tenureMonths: 12,
    disbursedMonthsAgo: 7,
    dueDay: 14, // chosen from his daily-receipts pattern, not a convention
    behaviour: { onTime: 1 },
  },

  // The decline, deepened. Two missed instalments and a live delinquency, which
  // fires the gate and holds the band regardless of everything else.
  rahul: {
    partnerId: 'partner_demo_nbfc',
    productKey: 'nbfc_emergency',
    purpose: 'EMERGENCY',
    principalRs: 15000,
    rateBps: 3000,
    tenureMonths: 6,
    disbursedMonthsAgo: 5,
    dueDay: 5,
    behaviour: {
      // Fine while the income held, then not.
      byIndex: { 1: 'onTime', 2: 'onTime', 3: 'late', 4: 'missed', 5: 'missed' },
      lateDays: 9,
    },
  },

  // A loan seen all the way through. Shows the completion bonus and the
  // graduated ceiling lifting for a second, larger loan.
  meena: {
    partnerId: 'partner_demo_bank',
    productKey: 'bank_business_term',
    purpose: 'WORKING_CAPITAL',
    principalRs: 60000,
    rateBps: 1800,
    tenureMonths: 12,
    disbursedMonthsAgo: 15,
    dueDay: 20,
    behaviour: { onTime: 0.92, late: 0.08, lateDays: 3 },
  },
};

/** Who has verified identity. Arjun and Sreeram have not — one to show the
 *  gate before disbursement, one because he has never applied. */
export const KYC_PLAN = {
  karthik: { idType: 'PAN', value: 'AXTPB1234K' },
  rahul: { idType: 'PAN', value: 'BJKPM4521R' },
  meena: { idType: 'AADHAAR', value: '234123412346' },
  ananya: { idType: 'PAN', value: 'CQWPI7788A' },
  lakshmi: { idType: 'PAN', value: 'DLMPD9911L' },
};
