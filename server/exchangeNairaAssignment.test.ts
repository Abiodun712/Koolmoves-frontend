import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('exchange Naira assignment SQL', () => {
  const sql = readFileSync(resolve(root, 'supabase/exchange_naira_assignment.sql'), 'utf8').toLowerCase();

  it('stores one random active admin bank and returns that same account later', () => {
    const existingLookup = sql.indexOf('a.transaction_key = p_transaction_key');
    const randomPick = sql.indexOf('order by random()');
    expect(existingLookup).toBeGreaterThan(-1);
    expect(randomPick).toBeGreaterThan(existingLookup);
    expect(sql).toContain('limit 1');
    expect(sql).toContain("lower(coalesce(b.status, '')) = 'active'");
    expect(sql).toContain('from public.admin_banks');
    expect(sql).not.toContain('from public.bank_accounts');
    expect(sql).toContain('on conflict (user_id, transaction_key) do nothing');
    expect(sql).toContain('security definer');
    expect(sql).toContain('user_id = auth.uid()');
    expect(sql).toContain('revoke all on function public.request_exchange_naira_account(text) from public, anon');
    expect(sql).toContain('grant execute on function public.request_exchange_naira_account(text) to authenticated');
    expect(sql).not.toContain('using (true)');
    expect(sql).not.toContain('drop table if exists public.exchange_requests');
    expect(sql).not.toContain('drop table if exists public.admin_banks');
    expect(sql).not.toContain('0123456789');
  });
});

describe('exchange screen boundaries', () => {
  const dashboard = readFileSync(resolve(root, 'src/components/UserDashboard.tsx'), 'utf8');

  it('does not list the company account pool and still uploads the Naira receipt', () => {
    expect(dashboard).not.toContain("from('admin_banks')");
    expect(dashboard).not.toContain('0123456789');
    expect(dashboard).not.toContain('9876543210');
    expect(dashboard).toContain('Upload Proof of Payment');
    expect(dashboard).toContain('payload.receipts = paymentProof');
    expect(dashboard).toContain("from('payment-receipts')");
    expect(dashboard).toContain('NairaAccountRequest');
  });
});
