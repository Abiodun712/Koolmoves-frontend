import { describe, expect, it, vi } from 'vitest';
import {
  REQUEST_EXCHANGE_NAIRA_ACCOUNT_RPC,
  isTransactionKey,
  outcomeFromAccountError,
  parseStoredExchangeTransaction,
  pickRandomAccount,
  readSingleNairaAccount,
  requestExchangeNairaAccount,
  revealAssignedAccount,
  serializeStoredExchangeTransaction,
  type CompanyNairaAccount,
} from './exchangeNairaAccount';

const KEY = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

function account(id: string, accountNumber: string, active = true): CompanyNairaAccount {
  return {
    id,
    bankName: `Bank ${id}`,
    accountName: `Account ${id}`,
    accountNumber,
    active,
  };
}

const pool = [account('1', '1111111111'), account('2', '2222222222'), account('3', '3333333333', false)];

describe('revealAssignedAccount', () => {
  it('picks one active account and hides the rest', () => {
    const first = revealAssignedAccount({
      transactionKey: KEY,
      existing: null,
      pool,
      random: () => 0,
    });
    expect(first.outcome).toEqual({
      status: 'ready',
      account: { bankName: 'Bank 1', accountName: 'Account 1', accountNumber: '1111111111' },
    });
    expect(JSON.stringify(first.outcome)).not.toContain('2222222222');
    expect(JSON.stringify(first.outcome)).not.toContain('3333333333');
    expect(first.assignment?.accountId).toBe('1');
  });

  it('keeps the account already stored for that transaction', () => {
    const first = revealAssignedAccount({
      transactionKey: KEY,
      existing: null,
      pool,
      random: () => 0,
    });
    const again = revealAssignedAccount({
      transactionKey: KEY,
      existing: first.assignment,
      pool,
      random: () => 0.99,
    });
    expect(again.outcome).toEqual(first.outcome);
    expect(again.assignment).toEqual(first.assignment);
    expect(JSON.stringify(again.outcome)).not.toContain('2222222222');
  });

  it('can choose a different account for a different transaction', () => {
    const first = revealAssignedAccount({ transactionKey: KEY, existing: null, pool, random: () => 0 });
    const second = revealAssignedAccount({ transactionKey: OTHER, existing: null, pool, random: () => 0.6 });
    expect(first.outcome.status === 'ready' && first.outcome.account.accountNumber).toBe('1111111111');
    expect(second.outcome.status === 'ready' && second.outcome.account.accountNumber).toBe('2222222222');
  });

  it('returns empty when every account is inactive', () => {
    const result = revealAssignedAccount({
      transactionKey: KEY,
      existing: null,
      pool: [account('9', '9999999999', false)],
      random: () => 0,
    });
    expect(result).toEqual({ assignment: null, outcome: { status: 'empty' } });
  });

  it('rejects a transaction id that is not a uuid', () => {
    expect(isTransactionKey('not-a-transaction')).toBe(false);
    expect(revealAssignedAccount({
      transactionKey: 'not-a-transaction',
      existing: null,
      pool,
      random: () => 0,
    }).outcome).toEqual({ status: 'invalid' });
  });
});

describe('pickRandomAccount', () => {
  it('uses the random value to choose an index and does not return the other rows', () => {
    expect(pickRandomAccount(['a', 'b', 'c'], () => 0)).toBe('a');
    expect(pickRandomAccount(['a', 'b', 'c'], () => 0.34)).toBe('b');
    expect(pickRandomAccount(['a', 'b', 'c'], () => 0.99)).toBe('c');
    expect(pickRandomAccount([], () => 0.2)).toBeNull();
  });
});

describe('readSingleNairaAccount', () => {
  it('returns only the first account and only its display fields', () => {
    const accountView = readSingleNairaAccount([
      { bank_name: ' Shown Bank ', account_name: 'KoolMovez', account_number: '1111222233', id: 4 },
      { bank_name: 'Hidden Bank', account_name: 'Other', account_number: '9999888877', id: 5 },
    ]);
    expect(accountView).toEqual({
      bankName: 'Shown Bank',
      accountName: 'KoolMovez',
      accountNumber: '1111222233',
    });
    expect(accountView && 'id' in accountView).toBe(false);
  });
});

describe('requestExchangeNairaAccount', () => {
  it('does not call the server for an invalid transaction id', async () => {
    const rpc = vi.fn();
    await expect(requestExchangeNairaAccount(rpc, 'bad')).resolves.toEqual({ status: 'invalid' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('asks for one account and ignores any extra row', async () => {
    const rpc = vi.fn(async () => ({
      data: [
        { bank_name: 'Shown Bank', account_name: 'KoolMovez', account_number: '1111222233' },
        { bank_name: 'Hidden Bank', account_name: 'Other', account_number: '9999888877' },
      ],
      error: null,
    }));
    await expect(requestExchangeNairaAccount(rpc, KEY)).resolves.toEqual({
      status: 'ready',
      account: { bankName: 'Shown Bank', accountName: 'KoolMovez', accountNumber: '1111222233' },
    });
    expect(rpc).toHaveBeenCalledWith(REQUEST_EXCHANGE_NAIRA_ACCOUNT_RPC, { p_transaction_key: KEY });
  });

  it('maps a missing pool and a missing function without showing an account', async () => {
    expect(outcomeFromAccountError({ message: 'no_active_naira_account' })).toEqual({ status: 'empty' });
    const missing = vi.fn(async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }));
    await expect(requestExchangeNairaAccount(missing, KEY)).resolves.toEqual({ status: 'unavailable' });
  });
});

describe('stored transaction', () => {
  it('remembers whether this transaction was already revealed', () => {
    const raw = serializeStoredExchangeTransaction({ transactionKey: KEY, revealed: true });
    expect(parseStoredExchangeTransaction(raw)).toEqual({ transactionKey: KEY, revealed: true });
    expect(parseStoredExchangeTransaction('{"transactionKey":"nope","revealed":true}')).toBeNull();
    expect(parseStoredExchangeTransaction('not-json')).toBeNull();
  });
});
