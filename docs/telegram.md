# Telegram phase one

This change adds a customer menu in the KoolMovez Telegram bot, a private admin alert when an exchange or packing request is saved, and an admin-confirmed post of the current published exchange rate to a Telegram channel. It is code, tests, and this document. It does not deploy, apply SQL, set a webhook, or send a Telegram message.

No bot token is in this repository. A previously exposed token is not used here and must stay revoked. Put the replacement only in the Vercel production environment.

## What a customer can do

`/start`, `/help`, and `/menu` show four actions: Exchange, Logistics, Track my request, and Talk to support.

The replies use the website’s existing description: Naira to RMB, and Air or Sea freight from China to Nigeria. Exchange and logistics buttons send the existing website addresses (`/login`, `/dashboard`, `/air-freight`, `/sea-freight`). Those pages still require a normal KoolMovez sign-in. The chat does not sign anyone in, does not link a Telegram account to a KM ID, and does not look up a request.

The chat does not quote a rate. The website remains the place that shows the published rate. There is no policy FAQ in the product, so the bot says that and offers a person. It does not invent fees, a turnaround time, or a payment approval.

Talk to support opens one ticket for that private chat. A later tap adds to the same open ticket. A retried Telegram update does not open a second ticket. A message sent before Talk to support is not stored. Photos and files are refused. Text is stored as text. The bot does not ask Telegram to interpret bold, links, or other formatting.

An admin reads and answers tickets at `/admin/telegram` after the normal admin sign-in. The page shows a masked chat label, not a control that lets a browser choose which Telegram chat receives a reply. Closing a ticket stops new messages from attaching to it.

## What an admin is alerted about

A successful `exchange_requests` insert, the first saved line on an air or sea packing request, and a new Telegram support ticket each write one outbox row in the same database transaction. The alert contains the reference, the type, the status, and the existing admin URL. It does not contain an email, phone, account number, payment proof, or the support message text.

`/start` does not add anyone to the admin list. Admins are numeric Telegram user ids set in the server environment. A username is rejected.

The website insert does not wait on Telegram and does not roll back if the alert cannot be written or sent. The trigger catches that error. Direct inserts from the website into Supabase are covered by the database trigger, not by the browser.

### Immediate send

After the transaction commits, `pg_net` calls `https://koolmovez.com/api/telegram-worker`. Supabase does not start that HTTP call until the commit succeeds. The worker checks the bearer secret, ignores any message text in the body, and sends only the outbox row it loads from the database. The database stops waiting after 10 seconds. Each Telegram call aborts after 4 seconds. Immediate means this send starts when the row commits. It does not promise how fast a phone shows the notification.

Support tickets are also sent inside the bot webhook request, so a new support request does not depend on `pg_net`. Exchange and logistics requests do, because those inserts never pass through the Vercel app.

This does not require a new paid product. `pg_net` is the extension Supabase Database Webhooks use, and it is included on the Free and Pro plans. Enable it under Database → Extensions if it is not already on. A Free project that Supabase has paused for inactivity cannot fire the call until the project is restored.

The call stays off until you insert one config row yourself. This pull request does not insert it.

```sql
insert into public.telegram_dispatch_config (id, endpoint_url, bearer_token, enabled)
values (
  1,
  'https://koolmovez.com/api/telegram-worker',
  'the same random string as CRON_SECRET',
  true
);
```

Use the production URL only. A `vercel.app` address is rejected by the table check, and a preview function stays disabled because `VERCEL_ENV=preview`.

The admin page shows instant dispatch as ready only when that row is enabled. Until then, exchange and logistics alerts are saved and are not sent on commit.

### If the send fails

A rate-limit response is queued and tried again on the next committed request, or by the daily recovery cron, without sending a second copy to an admin chat that already accepted it. A timeout or a 5xx response stays `needs_review` and is not marked delivered. **Retry undelivered alerts** is optional recovery for that case. Use it only when the phone did not show the alert, because a timed-out call may already have been accepted.

The daily cron in `vercel.json` (`0 8 * * *`) is only that recovery. On Vercel Hobby it can run at most once a day, and not at an exact minute. It is not the instant path. A faster automatic retry, when no new request arrives to trigger another send, needs a paid schedule: Vercel Pro cron can run every minute. This file keeps the daily cron so a Hobby deploy is not rejected. Nothing was upgraded, and nothing in the Node process keeps running after the request ends.

`pg_net` keeps the HTTP response for about 6 hours in `net._http_response`. Its queue is unlogged, so a database crash can drop a call that had not been sent yet. The outbox row remains for the recovery cron.

## Channel rate

The number posted is the existing `site_settings` value `exchange_rate`, the same value the website calculator reads. It is formatted with the existing website line `1 RMB = ₦…`, plus the existing sentence that the rate is indicative and the final rate is locked when an exchange request is created. The post also includes the site link from `TELEGRAM_SITE_URL` (`https://koolmovez.com/` in production). Packing, freight, and clearing amounts are not part of that setting, so they are not added to the post. The post does not add a Mini App or a `t.me` startapp link.

Saving a published rate on `/admin` writes `site_settings.exchange_rate` directly. When that save succeeds and the published number changed, the admin page posts it in the same action: it calls `/api/telegram-admin` with `publish-saved-rate`, and that request sends the channel message before it returns. The first attempt is that request. It does not wait, debounce, or collect later saves into one post.

The rate can change many times in one day. Each changed save gets its own post, including a save that returns to a number already posted earlier that day. There is no daily cap and no once-per-day post. Saving the same rate again does not post. A different spelling of the same number, such as `210` and `210.00`, is the same published rate and does not post again.

If `supabase/telegram_rate_autopost.sql` has been applied, the save also inserts one `telegram_rate_changes` row and calls the same post-commit dispatcher used for exchange and logistics alerts (`telegram_notify_dispatcher` → `/api/telegram-worker`). That worker sends the queued change in that request. The save-path call and the dispatcher share one broadcast per change, so a rate is not posted twice for one save. Apply that SQL by hand if this database already has `supabase/telegram.sql`. This change does not apply it, and it does not change production environment variables, secrets, the webhook, or the dispatcher row. Until the SQL is applied, the save-path call still posts the current rate immediately.

Opening `/admin/telegram` or refreshing the website rate does not post. Preview still does not send. “Publish this preview” still re-reads the rate, cancels that preview if the saved rate changed, and sends only when the admin confirms. That manual publish remains available and can send the current rate again on purpose.

The website save does not wait on the database trigger and does not roll back if Telegram cannot accept the post. The save-path request does wait for the first Telegram attempt so the admin page can show whether it was delivered.

### If the channel post does not go out

The broadcast uses the same statuses as a manual publish. Only `sent` is delivered. A rate-limit response stays on that same broadcast and is retried later by the existing recovery path. That retry is not a second copy, and it is not how the first attempt is made. A timeout or another unconfirmed response stays `needs_review` and is not marked delivered. A rejected post stays `failed`. Saving the same rate again does not send another copy. An admin can mark the row not posted, or mark it already posted without another Telegram call, from `/admin/telegram`. A later save of a different rate still posts that new rate immediately, including while an older row is `needs_review`.

There is no new cron and no rate schedule. The daily cron already in `vercel.json` (`0 8 * * *`) remains recovery for alerts and for a rate broadcast whose first attempt was retryable. It is not the path that publishes a rate an admin just saved.

The channel id is a numeric id starting with `-100`, stored only on the server. Leaving `TELEGRAM_CHANNEL_ID` empty keeps alerts and support working and refuses channel posts. A save made while the channel id is empty does not leave a rate waiting to be posted later.

## Status

The admin page reads `/api/telegram-admin`. Only a row whose status is `sent` is delivered to Telegram. `Automatic send queued` and `Automatic send in progress` are not delivered. `Retrying after the automatic send` means an earlier attempt did not succeed and another attempt is waiting. `marked_by_admin` means a person attested that the channel already showed the rate post; the server did not call Telegram again for that action.

Webhook and admin requests must arrive on the host in `TELEGRAM_SITE_URL` (and its `www` pair). Preview deployments are off because Vercel sets `VERCEL_ENV=preview`. The worker is authenticated with `TELEGRAM_WORKER_SECRET` or `CRON_SECRET` instead of the host, because Vercel cron does not promise the custom domain as `Host`.

## Environment

Set these on the Vercel **Production** environment only. Do not prefix them with `VITE_`. Do not add them to Preview.

| Name | Required | Value |
| --- | --- | --- |
| `TELEGRAM_ENABLED` | Yes, to turn the feature on | `true` |
| `TELEGRAM_BOT_TOKEN` | Yes | The replacement token from BotFather. It is not in this repo. |
| `TELEGRAM_WEBHOOK_SECRET` | Yes | A random string, 16 to 256 characters, no spaces. Telegram sends it in `X-Telegram-Bot-Api-Secret-Token`. |
| `TELEGRAM_SITE_URL` | Yes | `https://koolmovez.com` or `https://www.koolmovez.com`, matching the host you open. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | The same server-only key passkeys already use. |
| `TELEGRAM_ADMIN_CHAT_IDS` | For alerts | Comma-separated positive numeric ids. Example shape: `123456789,987654321`. |
| `TELEGRAM_CHANNEL_ID` | For the rate post | The channel id, shape `-100` followed by digits. |
| `TELEGRAM_WORKER_SECRET` | For an external caller of the worker | A different random string, 16 to 256 characters, no spaces. |
| `CRON_SECRET` | For the daily Vercel cron | A random string of the same shape. Vercel sends it as `Authorization: Bearer`. |

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are optional. They default to the public project URL and anon key already in the website client.

Until `TELEGRAM_ENABLED=true` and the required values pass validation, the webhook answers `503` with `disabled` and does not call Telegram. A missing channel disables only the rate post. Missing admin ids leave alerts queued and unsent.

## Find the numeric ids without another bot

Do this in a private terminal. Do not paste the token into chat, a screenshot, or a ticket. The token will be inside the shell command.

1. In BotFather, confirm the bot is `@KoolmovezBot` and copy the replacement token into a shell variable: `TOKEN='…'`.
2. From the Telegram account that should receive private alerts, open a private chat with `@KoolmovezBot` and send `/start`. That message does not grant admin access.
3. Run `curl -s "https://api.telegram.org/bot${TOKEN}/getUpdates"`.
4. In the JSON, read `message.chat.id` and `message.from.id` for that private chat. They are the same positive number. That number is what goes in `TELEGRAM_ADMIN_CHAT_IDS`.
5. Create or open the public channel. Add `@KoolmovezBot` as a channel administrator with permission to post messages. Post any short message in the channel.
6. Run `getUpdates` again. Read `channel_post.chat.id`. It is a negative number beginning with `-100`. That number is `TELEGRAM_CHANNEL_ID`. If the update is missing, remove the bot from the channel, add it again with post permission, post another message, and repeat. Do not use a third-party “id bot”.
7. Remove the token from the shell with `unset TOKEN` and clear the shell scrollback if the machine is shared.

## SQL

Run `supabase/telegram.sql` once, by hand, in the SQL editor for project `qslfgnrivaacfwsojjhh`. Run it after `exchange_requests`, `packing_requests`, and `air_packing_request_items` already exist. If `sea_packing_request_items` is not there yet, the script still finishes and skips the sea trigger; run the file again after the sea freight SQL so sea requests are queued too.

The script forces row level security, adds no policies, and revokes the tables from `anon` and `authenticated`. The service role inside the Vercel function is the only reader. Customers do not gain a new table they can query.

Do not run `supabase/telegram_rollback.sql` during setup. It drops only the Telegram tables, triggers, and functions. It does not drop exchange, packing, profile, or settings tables.

## Activation

Do these in order. This pull request has not done any of them.

1. Apply `supabase/telegram.sql`. If that file was already applied, also apply `supabase/telegram_rate_autopost.sql` once so a changed exchange rate is queued at commit. The save button still posts immediately before that SQL is applied.
2. Set the production environment variables above. Leave the feature off on Preview.
3. Deploy the revision that contains this code.
4. Sign in as an admin and open `https://koolmovez.com/admin/telegram`. The status should say Enabled, and the channel line should match whether `TELEGRAM_CHANNEL_ID` is set. Queue counts of zero are expected.
5. Register the webhook yourself:

```bash
curl -s "https://api.telegram.org/bot${TOKEN}/setWebhook" \
  -d "url=https://koolmovez.com/api/telegram" \
  -d "secret_token=${TELEGRAM_WEBHOOK_SECRET}" \
  -d 'allowed_updates=["message","callback_query"]' \
  -d "drop_pending_updates=true" \
  -d "max_connections=10"
```

The URL must be HTTPS on port 443. `allowed_updates` is only `message` and `callback_query`. A response of `{"ok":true}` means Telegram stored the webhook. It does not mean a customer message was delivered. The installed site already keeps `/api/` out of the service worker cache, so webhook and admin calls are network-only.

6. Put `CRON_SECRET` in the production environment before relying on the daily cron. The cron request is unauthenticated without it and will receive `401` or `503`.

## Phone test, after the steps above

These checks were not run for this pull request. There is no claim that a phone or the production channel received a message.

1. On a phone, open `@KoolmovezBot` and send `/start`. The four buttons appear. The text does not contain a naira amount.
2. Tap Exchange, Logistics, and Track my request. Each reply links to the website. Opening a link while signed out goes to the existing sign-in page. Signing in still uses the password or passkey flow, unchanged.
3. Send a sentence before tapping Talk to support. It should say the message was not sent to support.
4. Tap Talk to support, then send a sentence. On `/admin/telegram`, one ticket appears with that sentence. Tap the button again from Telegram. A second ticket does not appear.
5. Reply from the admin page. The phone shows the reply only if the status becomes “Delivered to Telegram”. A queued or failed status means the phone should not be expected to have it.
6. Enable `pg_net` if needed, then insert `telegram_dispatch_config` as shown above. Reload `/admin/telegram`. Instant dispatch should say ready. Close the admin page.
7. Submit one test exchange from the website. The exchange still succeeds if Telegram is misconfigured. With dispatch ready, the private admin chat receives the reference, type, status, and admin link without anyone opening the admin page. It does not include the email or payment details. The page says delivered only when the status is `sent`. If it stays “Automatic send queued”, the config row is missing or `pg_net` did not call the worker.
8. Submit one packing request. The logistics alert uses the request id and mode, not the packing instructions, and does not wait on a timer.
9. From Telegram, tap Talk to support and send one sentence. The admin phone gets a support alert that does not include that sentence. The sentence is in the admin inbox. A second tap does not send a second alert.
10. Press “Preview channel message”. The text matches the rate on the website and says it is indicative. The channel does not receive it yet. Press “Publish this preview”. The channel receives that text once. On `/admin`, save a different rate. The channel receives that new text without opening preview. Save the same rate again. The channel does not receive another post. Save a third rate on the same day, including a return to an earlier number. The channel receives that post too. A failed send stays unconfirmed on `/admin/telegram` until an admin marks it; it is not described as delivered.
11. On a `*.vercel.app` preview, `/api/telegram` returns disabled. Do not point `pg_net` or the bot webhook at a preview URL.

## Rollback

1. Set `TELEGRAM_ENABLED` to `false`, or remove `TELEGRAM_BOT_TOKEN`, and redeploy. New webhook calls fail closed. Existing website exchange and logistics are unchanged.
2. Run `curl -s "https://api.telegram.org/bot${TOKEN}/deleteWebhook"`.
3. Remove the bot from the channel administrators.
4. If the tables should be removed as well, run `supabase/telegram_rollback.sql` manually. Queued alerts and stored support messages are deleted with the tables. Exchange requests, packing requests, and the published rate remain.

## What this does not do

It does not link Telegram to a KoolMovez account, offer Telegram login, open a Mini App, call an AI model, or approve a payment. It does not change passkeys, password reset, the exchange form, or the freight forms. It does not depend on the separate in-app exchange notification work, and it does not run that migration. It does not generate a rate. It does not post a rate on a schedule, and it does not cap or merge how many changed rates can be posted in a day. It does not prove that a message arrived on a phone.
