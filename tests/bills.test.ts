import { describe, expect, it } from 'vitest';
import type { Bill, DayOverride, ScheduledJob, Shift } from '../shared/types.ts';
import { billForPayment, billShares, billStatus, dueDatesBetween, earningDays, lineTotal, paidLog, payDateFor, payDatesFor, paymentsTouching, planBills, saveWindow, upcomingPaychecks } from '../shared/bills.ts';
import { paycheckSlot } from '../shared/pay.ts';

const nineToFive: Shift = { start: '08:00', end: '17:00', breakMinutes: 60, breakStart: '12:00' };
const dayJob: ScheduledJob = {
  id: 'dayJob',
  updatedAt: 1,
  kind: 'scheduled',
  name: 'Day job',
  color: 1,
  salaried: true,
  takeHome: 1480,
  frequency: 'biweekly',
  payday: '2026-10-09',
  payLagDays: 6,
  schedule: [[], [nineToFive], [nineToFive], [nineToFive], [nineToFive], [nineToFive], []],
};
const data = { jobs: [dayJob], overrides: [] as DayOverride[], gigs: [] };

const bill = (over: Partial<Bill> = {}): Bill => ({
  id: 'b1',
  updatedAt: 1,
  name: 'Phone',
  amount: 100,
  frequency: 'monthly',
  dueDate: '2026-10-15',
  categoryId: 'cat_bills',
  startDate: '2026-10-05',
  ...over,
});

const workdays = (d: string) => earningDays(data, '2026-09-01', '2027-01-31').has(d);
const sum = (m: Map<string, number>) => [...m.values()].reduce((t, v) => t + v, 0);

describe('due dates', () => {
  it('repeats monthly on the same day, and on the last day for 31', () => {
    expect(dueDatesBetween(bill(), '2026-10-01', '2026-12-31')).toEqual(['2026-10-15', '2026-11-15', '2026-12-15']);
    expect(dueDatesBetween(bill({ dueDate: '2026-01-31' }), '2027-01-01', '2027-03-31')).toEqual(['2027-01-31', '2027-02-28', '2027-03-31']);
  });

  it('handles weekly, quarterly, and yearly bills', () => {
    expect(dueDatesBetween(bill({ frequency: 'weekly', dueDate: '2026-10-09' }), '2026-10-01', '2026-10-20')).toEqual(['2026-10-02', '2026-10-09', '2026-10-16']);
    expect(dueDatesBetween(bill({ frequency: 'quarterly' }), '2026-01-01', '2027-01-31')).toEqual(['2026-01-15', '2026-04-15', '2026-07-15', '2026-10-15', '2027-01-15']);
    expect(dueDatesBetween(bill({ frequency: 'yearly', dueDate: '2026-03-01' }), '2026-10-01', '2027-12-31')).toEqual(['2027-03-01']);
  });
});

describe('spreading a bill over workdays', () => {
  it('spreads the first payment from the start date to the due date', () => {
    // Mon Oct 5 through Thu Oct 15 has 9 workdays.
    const shares = billShares(bill(), '2026-10-01', '2026-10-15', workdays);
    expect(shares.size).toBe(9);
    expect(shares.get('2026-10-05')).toBeCloseTo(100 / 9, 6);
    expect(shares.has('2026-10-10')).toBe(false); // Saturday
    expect(sum(shares)).toBeCloseTo(100, 6);
  });

  it('spreads later payments over the whole cycle', () => {
    // Fri Oct 16 through Sun Nov 15 has 21 workdays.
    const shares = billShares(bill(), '2026-10-16', '2026-11-15', workdays);
    expect(shares.size).toBe(21);
    expect(sum(shares)).toBeCloseTo(100, 6);
  });

  it('can spread over every day instead', () => {
    const shares = billShares(bill(), '2026-10-01', '2026-10-15', () => true);
    expect(shares.size).toBe(11);
    expect(shares.get('2026-10-10')).toBeCloseTo(100 / 11, 6);
  });

  it('moves shares off unpaid days off', () => {
    const off: DayOverride = { id: 'o', updatedAt: 1, jobId: 'dayJob', date: '2026-10-07', type: 'off_unpaid' };
    const plan = planBills([bill()], { ...data, overrides: [off] }, '2026-10-05', '2026-10-15');
    // With a job, it's paid from the Oct 9 paycheck, so it saves Oct 5-9, less the day off.
    expect(plan.byDay.has('2026-10-07')).toBe(false);
    expect(plan.byDay.get('2026-10-05')).toBeCloseTo(100 / 4, 6);
  });

  it('stops after the end date', () => {
    expect(saveWindow(bill({ endDate: '2026-10-20' }), '2026-11-15')).toBeNull();
    expect(billShares(bill({ endDate: '2026-10-20' }), '2026-10-16', '2026-11-15', workdays).size).toBe(0);
  });

  it('spreads a weekly bill over the five workdays before it', () => {
    const weekly = bill({ frequency: 'weekly', dueDate: '2026-10-16', amount: 35, startDate: '2026-10-01' });
    const shares = billShares(weekly, '2026-10-10', '2026-10-16', workdays);
    expect([...shares.keys()]).toEqual(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']);
    expect(shares.get('2026-10-12')).toBeCloseTo(7, 6);
  });

  it('adds up several bills per day', () => {
    const plan = planBills([bill(), bill({ id: 'b2', amount: 45, name: 'Netflix' })], data, '2026-10-05', '2026-10-05');
    expect(plan.byDay.get('2026-10-05')).toBeCloseTo(145 / 5, 6);
  });
});

describe('bill status', () => {
  it('tracks what is set aside so far', () => {
    const s = billStatus(bill(), '2026-10-07', workdays)!;
    expect(s.due).toBe('2026-10-15');
    expect(s.perDay).toBeCloseTo(100 / 9, 6);
    expect(s.savedSoFar).toBeCloseTo((100 / 9) * 3, 6);
    expect(s.daysLeft).toBe(6);
  });

  it('saves toward the next payment when the bill starts after this one', () => {
    const s = billStatus(bill({ startDate: '2026-10-16' }), '2026-10-12', workdays)!;
    expect(s.due).toBe('2026-11-15');
    expect(s.savedSoFar).toBe(0);
  });
});

describe('bills paid from a paycheck', () => {
  // Every other Friday, each check covering work through payday.
  const fridays: ScheduledJob = { ...dayJob, id: 'fridays', payday: '2026-10-16', payLagDays: 0 };
  const jobs = [fridays];
  const everyDay = () => true;
  const rent = bill({ id: 'rent', name: 'Rent', amount: 1000, dueDate: '2026-11-01', startDate: '2026-10-03', payFrom: 'end' });
  const internet = bill({ id: 'net', name: 'Internet', amount: 80, dueDate: '2026-10-22', startDate: '2026-09-22', payFrom: 'end', lateDays: 10 });
  const phone = bill({ id: 'phone', name: 'Phone', amount: 60, dueDate: '2026-10-09', startDate: '2026-09-01', payFrom: 'mid', lateDays: 7 });
  const power = bill({ id: 'power', name: 'Power', amount: 150, dueDate: '2026-10-15', startDate: '2026-09-15', payFrom: 'mid' });
  const music = bill({ id: 'music', name: 'Music', amount: 12, dueDate: '2026-10-05', startDate: '2026-09-05' });

  it('tells the paycheck before the 1st from the one after it, and the extra ones', () => {
    expect(['2026-09-18', '2026-10-02', '2026-10-16', '2026-10-30', '2026-11-13'].map((d) => paycheckSlot(fridays, d))).toEqual(['end', 'mid', 'extra', 'end', 'mid']);
  });

  it('pays on the last paycheck of its kind before the due date, or within the late days', () => {
    expect(payDateFor(rent, '2026-11-01', jobs)).toBe('2026-10-30');
    expect(payDateFor(rent, '2026-12-01', jobs)).toBe('2026-11-27');
    expect(payDateFor(internet, '2026-10-22', jobs)).toBe('2026-10-30');
    expect(payDateFor({ ...internet, lateDays: 0 }, '2026-10-22', jobs)).toBe('2026-09-18');
    expect(payDateFor(phone, '2026-11-09', jobs)).toBe('2026-11-13');
    expect(payDateFor(phone, '2026-12-09', jobs)).toBe('2026-12-11');
    expect(payDateFor(power, '2026-11-15', jobs)).toBe('2026-11-13');
    // A bill not set to a paycheck goes out on the last payday before it's due.
    expect(payDateFor(music, '2026-11-05', jobs)).toBe('2026-10-30');
    expect(payDateFor(music, '2026-11-05', [])).toBe('2026-11-05');
  });

  it('has the money set aside by the payday, not the due date', () => {
    const shares = billShares(rent, '2026-10-01', '2026-11-27', everyDay, jobs);
    expect(shares.get('2026-10-03')).toBeCloseTo(1000 / 28, 6);
    expect(shares.get('2026-10-30')).toBeCloseTo(1000 / 28, 6);
    expect(shares.get('2026-10-31')).toBeCloseTo(1000 / 28, 6);
    expect(sum(shares)).toBeCloseTo(2000, 6);
    const s = billStatus(rent, '2026-10-30', everyDay, jobs)!;
    expect(s).toMatchObject({ due: '2026-11-01', pay: '2026-10-30', daysLeft: 0 });
    expect(s.savedSoFar).toBeCloseTo(1000, 6);
  });

  it('saves for two payments at once when one paycheck pays both', () => {
    const early = { ...phone, lateDays: 0 };
    expect(payDateFor(early, '2026-10-09', jobs)).toBe('2026-10-02');
    expect(payDateFor(early, '2026-11-09', jobs)).toBe('2026-10-02');
    const s = billStatus(early, '2026-09-20', everyDay, jobs)!;
    expect(s).toMatchObject({ pay: '2026-10-02', amount: 120 });
    const next = billStatus(early, '2026-10-03', everyDay, jobs)!;
    expect(next).toMatchObject({ pay: '2026-11-13', amount: 60, windowFrom: '2026-10-03', days: 42 });
  });

  it('lists what each paycheck pays', () => {
    const checks = upcomingPaychecks(fridays, [rent, internet, phone, power, music], jobs, '2026-10-20', 3);
    expect(checks.map((c) => [c.payday, c.slot, c.bills.map((b) => b.bill.id), c.billTotal])).toEqual([
      ['2026-10-30', 'end', ['net', 'rent', 'music'], 1092],
      ['2026-11-13', 'mid', ['phone', 'power'], 210],
      ['2026-11-27', 'end', ['net', 'rent', 'music'], 1092],
    ]);
  });

  it('saves for the first payment from the start date when the paycheck before it came earlier', () => {
    // Added Oct 20, due Oct 25: the last paycheck before it (Oct 16) came before the bill did.
    const added = bill({ id: 'new', amount: 30, dueDate: '2026-10-25', startDate: '2026-10-20' });
    const [first] = paymentsTouching(added, '2026-10-20', '2026-10-31', jobs);
    expect(first).toMatchObject({ pay: '2026-10-25', from: '2026-10-20', amount: 30 });
    // After that it goes back to the paycheck before it's due.
    expect(payDateFor(added, '2026-11-25', jobs)).toBe('2026-11-13');
  });

  it('needs a payment for each due date a paycheck covers', () => {
    const weekly = bill({ id: 'w', frequency: 'weekly', amount: 20, dueDate: '2026-11-06', startDate: '2026-10-01', payFrom: 'end' });
    const one = paidLog([{ billId: 'w', date: '2026-10-30', amount: 20 }], '2026-10-31');
    const check = upcomingPaychecks(fridays, [weekly], jobs, '2026-10-30', 1, false, one)[0];
    expect(check.bills[0].dues.length).toBeGreaterThan(1);
    expect(check.bills[0].done).toBe(false);
  });

  it('pays bills that don’t name a paycheck from the first job still going', () => {
    const old = { ...fridays, id: 'old', payday: '2026-10-09', archived: true, createdAt: 1 };
    expect(payDateFor(music, '2026-11-05', [old, { ...fridays, createdAt: 2 }])).toBe('2026-10-30');
  });

  it('splits a bill between both paychecks', () => {
    const split = { ...phone, payFrom: 'both' as const };
    expect(payDatesFor(split, '2026-11-09', jobs)).toEqual(['2026-10-30', '2026-11-13']);
    const checks = upcomingPaychecks(fridays, [split], jobs, '2026-10-20', 3);
    expect(checks.map((c) => [c.payday, c.bills.map((b) => [b.amount, b.share, b.dues[0]])])).toEqual([
      ['2026-10-30', [[30, 0.5, '2026-11-09']]],
      ['2026-11-13', [[30, 0.5, '2026-11-09']]],
      ['2026-11-27', [[30, 0.5, '2026-12-09']]],
    ]);
  });

  it('goes by what the bank shows you paid', () => {
    const paid = paidLog([{ billId: 'rent', date: '2026-10-30', amount: 950 }], '2026-11-02');
    const [check] = upcomingPaychecks(fridays, [rent], jobs, '2026-10-30', 1, false, paid);
    expect(check.bills[0]).toMatchObject({ amount: 950, paid: 950, done: true });
    // The days that saved for it add up to what was paid.
    expect(sum(billShares(rent, '2026-10-01', '2026-10-30', everyDay, jobs, paid))).toBeCloseTo(950, 6);
  });

  it('keeps a part payment open until the rest comes in', () => {
    const part = { billId: 'phone', date: '2026-10-30', amount: 25, billPart: true };
    const first = upcomingPaychecks(fridays, [phone], jobs, '2026-11-01', 1, false, paidLog([part], '2026-11-01'))[0].bills[0];
    expect(first).toMatchObject({ pay: '2026-11-13', amount: 60, paid: 25, done: false });
    // The rest posts a few days after the paycheck that pays it.
    const rest = paidLog([part, { billId: 'phone', date: '2026-11-16', amount: 35 }], '2026-11-17');
    expect(upcomingPaychecks(fridays, [phone], jobs, '2026-11-01', 1, false, rest)[0].bills[0]).toMatchObject({ amount: 60, done: true });
  });

  it('settles a split bill half by half', () => {
    const split = { ...phone, payFrom: 'both' as const };
    const half = paidLog([{ billId: 'phone', date: '2026-10-30', amount: 30 }], '2026-11-01');
    const [a, b] = upcomingPaychecks(fridays, [split], jobs, '2026-10-30', 2, false, half).map((c) => c.bills[0]);
    expect(a).toMatchObject({ pay: '2026-10-30', paid: 30, done: true });
    expect(b).toMatchObject({ pay: '2026-11-13', paid: 0, done: false });
  });
});

describe('bills you marked paid', () => {
  const fridays: ScheduledJob = { ...dayJob, id: 'fridays', payday: '2026-10-16', payLagDays: 0 };
  const jobs = [fridays];
  const rent = bill({ id: 'rent', name: 'Rent', amount: 1000, dueDate: '2026-11-01', startDate: '2026-10-03', payFrom: 'end' });
  const power = bill({ id: 'power', name: 'Power', amount: 150, dueDate: '2026-10-15', startDate: '2026-09-15', payFrom: 'mid' });

  it('leaves out payments from before you started tracking', () => {
    const log = paidLog(
      [
        { billId: 'power', date: '2026-09-29', amount: 140 },
        { billId: 'power', date: '2026-10-14', amount: 150 },
      ],
      '2026-10-20',
      '2026-10-04',
    );
    expect(log.byBill.get('power')).toEqual([{ date: '2026-10-14', amount: 150 }]);
  });

  it('counts a payment toward the due date you said it was for', () => {
    // Paid a few days after October's was due, but it's for November's.
    const early = paidLog([{ billId: 'power', date: '2026-10-19', amount: 150, billDue: '2026-11-15' }], '2026-10-20');
    expect(upcomingPaychecks(fridays, [power], jobs, '2026-11-01', 1, false, early)[0].bills[0]).toMatchObject({ pay: '2026-11-13', dues: ['2026-11-15'], paid: 150, done: true });
    // Without saying, it goes to October's.
    const plain = paidLog([{ billId: 'power', date: '2026-10-19', amount: 150 }], '2026-10-20');
    expect(upcomingPaychecks(fridays, [power], jobs, '2026-11-01', 1, false, plain)[0].bills[0]).toMatchObject({ paid: 0, done: false });
  });

  it('takes the rest of a bill from the next paycheck when you say so', () => {
    const part = { billId: 'rent', date: '2026-10-30', amount: 400, billPart: true, restNext: true, billDue: '2026-11-01' };
    const [now, next] = upcomingPaychecks(fridays, [rent], jobs, '2026-10-30', 2, false, paidLog([part], '2026-10-31'));
    expect(now.bills[0]).toMatchObject({ pay: '2026-10-30', amount: 1000, paid: 400, done: false, restNext: true });
    // This paycheck pays only what you paid; the rest comes out of the next one.
    expect(lineTotal(now.bills[0])).toBe(400);
    expect(now.billTotal).toBe(400);
    expect(next.bills.map((b) => [b.bill.id, b.amount, !!b.carried])).toEqual([['rent', 600, true]]);
    expect(next.billTotal).toBe(600);
    // However long that takes, it waits for the rest.
    const later = upcomingPaychecks(fridays, [rent], jobs, '2026-11-13', 1, false, paidLog([part], '2026-11-20'))[0];
    expect(later.bills.find((b) => b.carried)).toMatchObject({ amount: 600 });
  });

  it('puts the next payment toward the rest first', () => {
    const part = { billId: 'rent', date: '2026-10-30', amount: 400, billPart: true, restNext: true };
    // The bank's payment of the rest, a little short, with nothing saying which one it's for.
    const rest = paidLog([part, { billId: 'rent', date: '2026-11-13', amount: 590 }], '2026-11-14');
    const [now, next, after] = upcomingPaychecks(fridays, [rent], jobs, '2026-10-30', 3, false, rest);
    expect(now.bills[0]).toMatchObject({ amount: 990, paid: 990, done: true });
    expect(next.bills).toEqual([]);
    // December's rent is still to pay in full.
    expect(after.bills[0]).toMatchObject({ pay: '2026-11-27', amount: 1000, paid: 0, done: false });
  });
});

describe('which bill a payment pays', () => {
  const games = bill({ id: 'games', name: 'Game Club', amount: 9.99, match: 'Contoso' });
  const rent = bill({ id: 'rent', name: 'Rent', amount: 1000, match: 'Withdrawal Branch' });
  const car = bill({ id: 'car', name: 'Car app', amount: 9.99, match: 'Fabrikam Inc Subs' });
  const video = bill({ id: 'video', name: 'Video Plus', amount: 12.99 });

  it('needs the name and an amount close to the bill', () => {
    expect(billForPayment([games], 'Contoso', 10.49, 'CONTOSO.COM/BILL')?.id).toBe('games');
    expect(billForPayment([games], 'Contoso', 59.99, 'CONTOSO.COM/BILL')).toBeUndefined();
    expect(billForPayment([rent], 'Withdrawal Branch', 1150, 'WITHDRAWAL BRANCH 0001')?.id).toBe('rent');
    expect(billForPayment([rent], 'Withdrawal Branch', 300, 'WITHDRAWAL BRANCH 0001')).toBeUndefined();
  });

  it('reads words the bank ran together', () => {
    expect(billForPayment([car], 'Fabrikam', 9.99, 'FABRIKAM, INC. SUBSDenverCO US')?.id).toBe('car');
    // Same company and a similar amount, but a charge rather than the subscription.
    expect(billForPayment([car], 'Fabrikam', 8.5, 'Fabrikam Inc ChargeDenverCO')).toBeUndefined();
  });

  it('falls back to the bill name, as whole words', () => {
    expect(billForPayment([video], 'Video Plus', 12.99)?.id).toBe('video');
    expect(billForPayment([video], 'Video', 12.99)).toBeUndefined();
    expect(billForPayment([bill({ name: 'Rent', amount: 1000 })], 'Parent Teacher Assoc', 1000)).toBeUndefined();
  });
});
