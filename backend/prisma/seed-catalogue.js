/**
 * Static catalogue data for the demo: prepaid plans and billers.
 *
 * Split out of seed.js so that file can stay focused on simulating 18 months of
 * behaviour. These lists are unchanged from the original wallet seed.
 */

export const RECHARGE_PLANS = [
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

export const BILLERS = [
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
