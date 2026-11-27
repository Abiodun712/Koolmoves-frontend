# Customer exchange

The signed-in exchange screen is `/dashboard`. Submitting an exchange still saves an `exchange_requests` row. The Naira payment image receipt is still uploaded on that form and stored on the request as `receipts`. This change does not remove that step.

Naira account details are hidden when the form opens. They appear only after the customer presses **Request Naira account**. The screen then shows one company account for that exchange. The other company accounts stay hidden.

## When the button reveals an account

The button calls `request_exchange_naira_account` with a transaction id kept in this browser tab. Before that call succeeds, the form does not show a bank name, account name, or account number, and it does not list the company accounts.

A successful call shows that one account: bank name, account name, and account number. The customer can copy the number, upload the Naira payment receipt, and submit as before.

If no active company account exists, the screen says so and still shows no account. If the database function is not installed yet, the details stay hidden. The form does not substitute placeholder account numbers.

## How one account is chosen and kept

The pool is `public.admin_banks` where `status` is `active`. That is the same company Naira list the exchange screen used to read. `public.bank_accounts` is not part of this pool.

The function picks one active row with `order by random() limit 1` and stores it on `exchange_naira_assignments` for this customer and this transaction id. A refresh calls the function again with the same id. The stored row is returned, and the function does not pick again. A new exchange after a successful submit uses a new transaction id, so it can receive a different account.

Customers cannot select the `admin_banks` list. The function returns only the one stored account. Another customer's assignment is not readable.

After submit, the same function link stores the exchange reference on that assignment. The request history can show the account already chosen for that reference. It does not show any other company account.

## Recent notifications

`/home` is the customer dashboard. Its **Recent notifications** list is the existing activity feed on that page.

After an exchange is submitted, that customer's own `exchange_requests` row appears there as an exchange submission. The same list includes that customer's packing requests, shipments, and logistics payments. It does not add an admin dashboard or an admin notification list.

The exchange and packing queries read columns that exist today (`created_at`, not `updated_at`) and are limited to the signed-in user.

## SQL

Run `supabase/exchange_naira_assignment.sql` once, by hand, in the SQL editor for project `qslfgnrivaacfwsojjhh`. This repository does not apply that file. No production env var, secret, webhook, or live config is changed.

Until the file is applied, requesting an account leaves the details hidden, and submitting an exchange still works, including the receipt upload.
