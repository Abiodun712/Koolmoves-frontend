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

A successful `exchange_requests` insert queues one private alert. The first saved line on an air or sea packing request queues one logistics alert, two minutes later, so a packing request that is deleted because its goods failed to save is not announced. The alert contains the reference, the type, the status, and the existing admin URL. It does not contain an email, phone, account number, or payment proof.

`/start` does not add anyone to the admin list. Admins are numeric Telegram user ids set in the server environment. A username is rejected.

The website insert does not wait for Telegram. If the queue cannot be written, the trigger swallows the error and the exchange or packing request still saves. A failed or unconfirmed Telegram call leaves the alert queued, failed, or needs review. It does not change the business row.

There is no durable in-process worker. Vercel’s cron calls `GET /api/telegram-worker` once a day at 08:00 UTC. On the Hobby plan that daily schedule is the platform limit, so it is not a near-real-time alert. The admin button “Deliver queued alerts” runs the same sender immediately and is the reliable way to deliver. A Pro plan can change the cron schedule to every few minutes; this file keeps the daily schedule so a Hobby deploy is not rejected. Nothing in the Node process keeps running after the request ends.

Automatic delivery retries only when Telegram says the call was rate-limited and the previous chats that already accepted the alert are not called again. A timeout or a 5xx response is `needs_review` and is not sent again until an admin presses “Retry unconfirmed alerts”. That explicit retry can repeat a private alert if Telegram had actually accepted the timed-out call.

## Channel rate

The number posted is the existing `site_settings` value `exchange_rate`, the same value the website calculator reads. It is formatted with the existing website line `1 RMB = ₦…`, plus the existing sentence that the rate is indicative and the final rate is locked when an exchange request is created. Packing, freight, and clearing amounts are not part of that setting, so they are not added to the post.

Saving the rate on `/admin` does not post it. Opening `/admin/telegram` or refreshing the website rate does not post it. An admin previews the exact text, then presses “Publish this preview”. The server reads the rate again at that moment. If it changed, the preview is cancelled. The publish action is the approval. There is no scheduled or automatic post.

If Telegram does not confirm the post, the status stays `needs_review` and a second preview cannot be published until an admin marks the first one not posted, or marks it already posted without making another Telegram call. The screen says which of those happened. `queued`, `sending`, `failed`, `needs_review`, `preview`, and `cancelled` are not described as delivered.

The channel id is a numeric id starting with `-100`, stored only on the server. Leaving `TELEGRAM_CHANNEL_ID` empty keeps alerts and support working and refuses channel posts.

## Status

The admin page reads `/api/telegram-admin`. Only a row whose status is `sent` is delivered to Telegram. `marked_by_admin` means a person attested that the channel already showed the post; the server did not call Telegram again for that action.

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

1. Apply `supabase/telegram.sql`.
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
6. Submit one test exchange from the website. The exchange still succeeds even if Telegram is misconfigured. The alert appears as queued. Press “Deliver queued alerts”. The private admin chat shows the reference, type, status, and admin link, and not the test account’s email or payment details. The page says delivered only after the status is `sent`.
7. Submit one packing request. Wait two minutes, or press “Queue alerts for recent requests” and then deliver. The logistics alert uses the request id and mode, not the packing instructions.
8. Press “Preview channel message”. The text matches the rate on the website and says it is indicative. The channel does not receive it yet. Press “Publish this preview”. The channel receives that text once. Save a different rate on `/admin` and confirm the channel does not receive another post until a new preview is confirmed.
9. On a `*.vercel.app` preview, `/api/telegram` returns disabled even if the production variables were copied by mistake only when `VERCEL_ENV` is `preview`. Do not point the webhook at a preview URL.

## Rollback

1. Set `TELEGRAM_ENABLED` to `false`, or remove `TELEGRAM_BOT_TOKEN`, and redeploy. New webhook calls fail closed. Existing website exchange and logistics are unchanged.
2. Run `curl -s "https://api.telegram.org/bot${TOKEN}/deleteWebhook"`.
3. Remove the bot from the channel administrators.
4. If the tables should be removed as well, run `supabase/telegram_rollback.sql` manually. Queued alerts and stored support messages are deleted with the tables. Exchange requests, packing requests, and the published rate remain.

## What this does not do

It does not link Telegram to a KoolMovez account, offer Telegram login, open a Mini App, call an AI model, or approve a payment. It does not change passkeys, password reset, the exchange form, or the freight forms. It does not depend on the separate in-app exchange notification work, and it does not run that migration. It does not generate a rate. It does not post a rate on a schedule. It does not prove that a message arrived on a phone.
