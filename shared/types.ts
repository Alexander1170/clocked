/** A calendar day in the device's local time zone, formatted 'YYYY-MM-DD'. */
export type LocalDate = string;

export interface BaseRecord {
  id: string;
  /** Milliseconds since epoch, set by whichever device wrote this version. Last write wins. */
  updatedAt: number;
  createdAt?: number;
  /** Tombstone: deleted records stay in the store so the deletion can sync. */
  deleted?: boolean;
}

export interface Shift {
  /** 'HH:MM', 24-hour. */
  start: string;
  /** 'HH:MM'. An end at or before the start means the shift runs past midnight. */
  end: string;
  /** Unpaid break length in minutes. */
  breakMinutes?: number;
  /** 'HH:MM' when the unpaid break starts. Defaults to the middle of the shift. */
  breakStart?: string;
}

export type PayFrequency = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';

export interface ScheduledJob extends BaseRecord {
  kind: 'scheduled';
  name: string;
  /** Categorical color slot, 1-8. Stored on the job so filtering never repaints it. */
  color: number;
  /** Salary: the check is the same no matter how the hours land. Hourly: pay follows actual hours. */
  salaried: boolean;
  /** Take-home pay per paycheck. */
  takeHome: number;
  /** Gross pay per paycheck, optional. */
  gross?: number;
  frequency: PayFrequency;
  /** Any known payday. The anchor for weekly and every-2-weeks schedules. */
  payday: LocalDate;
  /** Each check pays for work through this many days before payday. */
  payLagDays: number;
  /** Paydays for twice-a-month pay. 31 means the last day of the month. */
  semimonthlyDays?: [number, number];
  /** Payday for monthly pay. 31 means the last day of the month. */
  monthlyDay?: number;
  /** Shifts per weekday, index 0-6 = Sunday-Saturday. */
  schedule: Shift[][];
  startDate?: LocalDate;
  endDate?: LocalDate;
  archived?: boolean;
}

export interface GigJob extends BaseRecord {
  kind: 'gig';
  name: string;
  color: number;
  archived?: boolean;
}

export type Job = ScheduledJob | GigJob;

export type OverrideType = 'off_paid' | 'off_unpaid' | 'custom';

/** A one-day change to a scheduled job: a day off or different hours. */
export interface DayOverride extends BaseRecord {
  jobId: string;
  date: LocalDate;
  type: OverrideType;
  shifts?: Shift[];
  note?: string;
}

export interface GigOrder {
  at: number;
  amount: number;
}

/** A stretch of gig work. A running dash has no end yet. */
export interface GigSession extends BaseRecord {
  jobId: string;
  start: number;
  end: number | null;
  /** Total payout including tips. */
  earnings: number;
  tips?: number;
  orders?: GigOrder[];
  miles?: number;
  note?: string;
}

export type TxSource = 'manual' | 'plaid' | 'shortcut';

/** Money in or out. Positive amounts are money out (Plaid's convention). */
export interface Transaction extends BaseRecord {
  date: LocalDate;
  at?: number;
  amount: number;
  merchant: string;
  categoryId: string;
  note?: string;
  source: TxSource;
  pending?: boolean;
  /** Hidden from spending, e.g. a transfer between your own accounts. */
  excluded?: boolean;
  /** From a bank account you switched off: hidden everywhere. */
  accountOff?: boolean;
  /**
   * What the money was. Only 'spend' counts as spending: income was already
   * counted as hourly pay, and transfers just move money between accounts.
   */
  flow?: TxFlow;
  /** A payment toward this bill. Covered by the bill's daily set-aside, so it isn't spending that day. */
  billId?: string;
  /** The user changed this bank transaction, so later bank updates keep their category, note, and flags. */
  edited?: boolean;
  plaidId?: string;
  accountId?: string;
  /** "Checking ••1234". */
  accountName?: string;
  /** Plaid's detailed category, e.g. FOOD_AND_DRINK_COFFEE. */
  pfc?: string;
  /** The bank's raw description. */
  rawName?: string;
  /** Income matched to a job, so it isn't counted twice. */
  jobId?: string;
}

export type TxFlow = 'spend' | 'income' | 'transfer';

export interface Category extends BaseRecord {
  name: string;
  icon: string;
  sort: number;
}

/** Always file a merchant's transactions under one category. */
export interface Rule extends BaseRecord {
  /** Lowercased merchant name. */
  match: string;
  categoryId: string;
}

export type BillFrequency = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';

/** A recurring bill. Its amount is set aside a little each workday until it's due. */
export interface Bill extends BaseRecord {
  name: string;
  amount: number;
  frequency: BillFrequency;
  /** Any due date. Monthly and longer bills repeat on its day of the month (31 means the last day). */
  dueDate: LocalDate;
  categoryId: string;
  /** Text in a transaction's merchant that marks it as a payment of this bill. */
  match?: string;
  /** Set money aside starting this day. Earlier days aren't touched. */
  startDate: LocalDate;
  /** Last day to set aside. Payments due after it are dropped. */
  endDate?: LocalDate;
}

export interface Settings extends BaseRecord {
  weekStartsOn: 0 | 1;
  /** Spread bills over the days you're scheduled to work, or over every day. */
  billSpread?: 'workdays' | 'everyday';
}

export interface CollectionMap {
  jobs: Job;
  overrides: DayOverride;
  gigs: GigSession;
  transactions: Transaction;
  categories: Category;
  settings: Settings;
  bills: Bill;
  rules: Rule;
}

export type CollectionName = keyof CollectionMap;

export const COLLECTIONS: readonly CollectionName[] = ['jobs', 'overrides', 'gigs', 'transactions', 'categories', 'settings', 'bills', 'rules'];

export interface Change {
  c: CollectionName;
  rec: BaseRecord;
}

export interface SyncRequest {
  since: number;
  changes: Change[];
}

export interface SyncResponse {
  /** Identifies this server database. A new id means start over from zero. */
  dbId: string;
  /** The server's latest sequence number (or the last one in this page). */
  seq: number;
  more: boolean;
  changes: Change[];
}
