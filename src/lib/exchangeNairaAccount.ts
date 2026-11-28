/**
 * One company Naira account per exchange transaction.
 * The browser never receives the pool. Supabase function
 * request_exchange_naira_account picks and stores the account.
 */

export const EXCHANGE_NAIRA_TRANSACTION_STORAGE_KEY = 'koolmovez.exchange.nairaTransaction';
export const REQUEST_EXCHANGE_NAIRA_ACCOUNT_RPC = 'request_exchange_naira_account';
export const ATTACH_EXCHANGE_NAIRA_ACCOUNT_RPC = 'attach_exchange_naira_account';

const TRANSACTION_KEY_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export type NairaAccountView = {
  bankName: string;
  accountName: string;
  accountNumber: string;
};

export type NairaAccountPhase = 'idle' | 'loading' | 'ready' | 'empty' | 'unavailable';

export type NairaRevealOutcome =
  | { status: 'ready'; account: NairaAccountView }
  | { status: 'empty' }
  | { status: 'unavailable' }
  | { status: 'invalid' };

export type CompanyNairaAccount = NairaAccountView & {
  id: string;
  active: boolean;
};

export type AssignedNairaAccount = NairaAccountView & {
  transactionKey: string;
  accountId: string;
};

export type StoredExchangeTransaction = {
  transactionKey: string;
  revealed: boolean;
};

export type NairaAccountRpc = (
  name: string,
  args: Record<string, string>,
) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;

export function isTransactionKey(value: string): boolean {
  return TRANSACTION_KEY_PATTERN.test(value);
}

export function parseStoredExchangeTransaction(raw: string | null): StoredExchangeTransaction | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredExchangeTransaction>;
    if (!parsed || typeof parsed.transactionKey !== 'string' || !isTransactionKey(parsed.transactionKey)) {
      return null;
    }
    return { transactionKey: parsed.transactionKey, revealed: parsed.revealed === true };
  } catch {
    return null;
  }
}

export function serializeStoredExchangeTransaction(value: StoredExchangeTransaction): string {
  return JSON.stringify({
    transactionKey: value.transactionKey,
    revealed: value.revealed === true,
  });
}

export function pickRandomAccount<T>(accounts: readonly T[], random: () => number): T | null {
  if (accounts.length === 0) return null;
  const unit = random();
  const scaled = Number.isFinite(unit) ? Math.min(Math.max(unit, 0), 0.999999999999) : 0;
  const index = Math.min(accounts.length - 1, Math.floor(scaled * accounts.length));
  return accounts[index] ?? null;
}

function toView(account: NairaAccountView): NairaAccountView {
  return {
    bankName: account.bankName,
    accountName: account.accountName,
    accountNumber: account.accountNumber,
  };
}

/** Same transaction keeps its saved account. A new transaction picks once from the active pool. */
export function revealAssignedAccount(input: {
  transactionKey: string;
  existing: AssignedNairaAccount | null;
  pool: readonly CompanyNairaAccount[];
  random: () => number;
}): { assignment: AssignedNairaAccount | null; outcome: NairaRevealOutcome } {
  if (!isTransactionKey(input.transactionKey)) {
    return { assignment: null, outcome: { status: 'invalid' } };
  }

  if (input.existing && input.existing.transactionKey === input.transactionKey) {
    return {
      assignment: input.existing,
      outcome: { status: 'ready', account: toView(input.existing) },
    };
  }

  const active = input.pool.filter(
    (account) =>
      account.active &&
      account.bankName.trim() !== '' &&
      account.accountName.trim() !== '' &&
      account.accountNumber.trim() !== '',
  );
  const picked = pickRandomAccount(active, input.random);
  if (!picked) return { assignment: null, outcome: { status: 'empty' } };

  const assignment: AssignedNairaAccount = {
    transactionKey: input.transactionKey,
    accountId: picked.id,
    bankName: picked.bankName.trim(),
    accountName: picked.accountName.trim(),
    accountNumber: picked.accountNumber.trim(),
  };
  return { assignment, outcome: { status: 'ready', account: toView(assignment) } };
}

function textField(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return typeof value === 'string' ? value.trim() : '';
}

/** Reads the first returned row and only its three display fields. */
export function readSingleNairaAccount(data: unknown): NairaAccountView | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') return null;
  const record = row as Record<string, unknown>;
  const bankName = textField(record, 'bank_name');
  const accountName = textField(record, 'account_name');
  const accountNumber = textField(record, 'account_number');
  if (!bankName || !accountName || !accountNumber) return null;
  return { bankName, accountName, accountNumber };
}

export function outcomeFromAccountError(error: { message?: string; code?: string } | null): NairaRevealOutcome {
  const message = `${error?.code ?? ''} ${error?.message ?? ''}`;
  if (message.includes('no_active_naira_account')) return { status: 'empty' };
  if (message.includes('invalid_transaction')) return { status: 'invalid' };
  return { status: 'unavailable' };
}

export async function requestExchangeNairaAccount(
  rpc: NairaAccountRpc,
  transactionKey: string,
): Promise<NairaRevealOutcome> {
  if (!isTransactionKey(transactionKey)) return { status: 'invalid' };
  try {
    const { data, error } = await rpc(REQUEST_EXCHANGE_NAIRA_ACCOUNT_RPC, {
      p_transaction_key: transactionKey,
    });
    if (error) return outcomeFromAccountError(error);
    const account = readSingleNairaAccount(data);
    if (!account) return { status: 'unavailable' };
    return { status: 'ready', account };
  } catch {
    return { status: 'unavailable' };
  }
}
