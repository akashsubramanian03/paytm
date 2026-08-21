import { formatINR, paiseToRupees } from './money.js';

export function initialsOf(firstName = '', lastName = '') {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase() || '?';
}

function maskEmail(email = '') {
  const [name, domain] = email.split('@');
  if (!domain) return email;
  const head = name.slice(0, 2);
  return `${head}${'*'.repeat(Math.max(name.length - 2, 1))}@${domain}`;
}

function maskPhone(phone = '') {
  if (phone.length < 4) return phone;
  return `${phone.slice(0, 2)}${'*'.repeat(phone.length - 4)}${phone.slice(-2)}`;
}

/** What the signed-in user sees about themselves. Never includes passwordHash. */
export function selfUser(user) {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    name: `${user.firstName} ${user.lastName}`.trim(),
    initials: initialsOf(user.firstName, user.lastName),
    email: user.email,
    phone: user.phone,
    upiId: user.upiId,
    avatarColor: user.avatarColor,
    createdAt: user.createdAt,
  };
}

/** What one user is allowed to see about another user. Contact details are masked. */
export function contactUser(user) {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    name: `${user.firstName} ${user.lastName}`.trim(),
    initials: initialsOf(user.firstName, user.lastName),
    upiId: user.upiId,
    avatarColor: user.avatarColor,
    maskedEmail: maskEmail(user.email),
    maskedPhone: maskPhone(user.phone),
  };
}

export function balance(account) {
  return {
    balancePaise: account.balancePaise,
    balance: paiseToRupees(account.balancePaise),
    balanceFormatted: formatINR(account.balancePaise),
    updatedAt: account.updatedAt,
  };
}

const CATEGORY_LABEL = {
  TRANSFER: 'Money Transfer',
  ADD_MONEY: 'Added to Wallet',
  RECHARGE: 'Mobile Recharge',
  BILL_PAYMENT: 'Bill Payment',
};

export function ledgerEntry(entry) {
  let metadata = null;
  if (entry.metadata) {
    try {
      metadata = JSON.parse(entry.metadata);
    } catch {
      metadata = null;
    }
  }
  return {
    id: entry.id,
    referenceId: entry.referenceId,
    direction: entry.direction,
    category: entry.category,
    categoryLabel: CATEGORY_LABEL[entry.category] ?? entry.category,
    status: entry.status,
    amountPaise: entry.amountPaise,
    amount: paiseToRupees(entry.amountPaise),
    amountFormatted: formatINR(entry.amountPaise),
    balanceAfterPaise: entry.balanceAfterPaise,
    balanceAfterFormatted: formatINR(entry.balanceAfterPaise),
    counterparty: {
      id: entry.counterpartyId,
      name: entry.counterpartyName,
      handle: entry.counterpartyHandle,
      initials: entry.counterpartyName
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w.charAt(0))
        .join('')
        .toUpperCase(),
    },
    note: entry.note,
    metadata,
    createdAt: entry.createdAt,
  };
}

export function rechargePlan(plan) {
  return {
    id: plan.id,
    operator: plan.operator,
    circle: plan.circle,
    category: plan.category,
    pricePaise: plan.pricePaise,
    price: paiseToRupees(plan.pricePaise),
    priceFormatted: formatINR(plan.pricePaise),
    validityDays: plan.validityDays,
    validityLabel: plan.validityDays === 1 ? '1 Day' : `${plan.validityDays} Days`,
    data: plan.data,
    talktime: plan.talktime,
    sms: plan.sms,
    description: plan.description,
  };
}

export function biller(b) {
  return {
    id: b.id,
    name: b.name,
    category: b.category,
    icon: b.icon,
    minPaise: b.minPaise,
    maxPaise: b.maxPaise,
    minFormatted: formatINR(b.minPaise),
    maxFormatted: formatINR(b.maxPaise),
  };
}
