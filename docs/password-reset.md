# Password reset configuration

This frontend sends password-reset email through the existing Supabase Auth client. It does not send mail itself and it does not store the provider's URL allowlist, email template, or SMTP settings. Those live in the Supabase project and have to be confirmed by someone with dashboard access.

## What this repository proves

- `src/lib/supabaseClient.ts` constructs the client with the publishable anon key already committed for project ref `qslfgnrivaacfwsojjhh` (`https://qslfgnrivaacfwsojjhh.supabase.co`). The service-role key is not in this repo and is not required for this flow.
- The client pins `auth.flowType: 'implicit'` and `auth.detectSessionInUrl: true`. That is the default for `@supabase/auth-js` 2.110.7 (locked in `package-lock.json`). `resetPasswordForEmail` therefore does **not** create a PKCE code verifier.
- With that client, a successful recovery redirect comes back to `/reset-password` as a URL fragment: `#access_token=...&refresh_token=...&type=recovery`. The client stores the session and emits `PASSWORD_RECOVERY`. The app then removes the fragment with `history.replaceState`.
- Signup already requires a password of at least 6 characters and a matching confirmation (`src/lib/passwordPolicy.ts`). The reset form uses that same check. The dashboard minimum can be higher; a stricter server rejection is shown with the server's length.
- A read-only `GET /auth/v1/settings` on 11 Nov 2026, using the repo's anon key, returned email auth enabled, phone auth disabled, signup enabled, and `mailer_autoconfirm: false`. That response does **not** include the Site URL, redirect allowlist, SMTP credentials, email templates, OTP lifetime, password minimum, or rate limits.

Do not switch this client to `flowType: 'pkce'` unless the email template and this callback are changed together. PKCE stores the code verifier in the browser that requested the email, so a reset link opened on another device cannot be exchanged, and a `?code=` redirect is rejected by the implicit client.

## Required Supabase URL configuration

In Authentication → URL Configuration, set **Site URL** to the origin users actually open. This repo only shows `support@koolmovez.com` on the landing page. It does not record whether production is `https://koolmovez.com`, `https://www.koolmovez.com`, or another host. If `redirectTo` is not on the allowlist, Supabase ignores it and sends the browser to the Site URL.

Add every origin the app is served from, without a trailing slash, for both routes:

- `http://localhost:5173/reset-password`
- `http://localhost:5173/auth/confirm`
- `https://<production-host>/reset-password`
- `https://<production-host>/auth/confirm`

Add the `www` and apex hosts when both serve the app, and each preview host if those links must work. The app's `redirectTo` is `${window.location.origin}/reset-password`.

`/reset-password` and `/auth/confirm` are client routes. `vercel.json` rewrites document requests to `index.html` so an email link can load the SPA. Another host needs the same fallback. The installed PWA already uses a navigation fallback, which only helps after the app has been installed.

## Email template

The built-in Reset password template is the one this implicit client expects. Keep the link on `{{ .ConfirmationURL }}`, which is Supabase's verify URL and then redirects to the allowlisted `redirectTo`:

```html
<h2>Reset password</h2>
<p>Follow this link to reset the password for your user:</p>
<p><a href="{{ .ConfirmationURL }}">Reset password</a></p>
```

That template is **not** in this repository. Compare it in Authentication → Email Templates before relying on reset in production. Do not put `{{ .Token }}` in a link on the app's own origin; the browser should exchange it on `*.supabase.co`, and only the short-lived session fragment should reach the app.

This app also accepts a cross-device `token_hash` link, which avoids putting an access token in the fragment. Use it only as a replacement for the default template:

```html
<h2>Reset password</h2>
<p>Follow this link to choose a new password:</p>
<p><a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery">Reset password</a></p>
```

`redirectTo` is already `/reset-password` on the app origin. The Supabase PKCE guide's `/auth/confirm` link also works because that route renders the same reset screen:

```html
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password">Reset password</a></p>
```

For that variant, **Site URL must be the app origin**, not `https://qslfgnrivaacfwsojjhh.supabase.co`. The page deletes `token_hash` from the address bar before calling `verifyOtp`. `next` is not used as a browser redirect: the only accepted in-app path is `/reset-password`, and any other value, including an external URL, is ignored. A refresh before `verifyOtp` finishes cannot reuse the hash; the person requests a new email.

## SMTP and limits that need dashboard access

The public settings call cannot show these. Someone with access to project `qslfgnrivaacfwsojjhh` needs to confirm them:

- **SMTP.** Supabase's built-in mailer is for trials (documented limit: 2 emails per hour) and is not a production sender. Custom SMTP is not configured in this repo. Use a mailbox on the domain users trust, such as `noreply@koolmovez.com`, only after that address exists and the provider credentials are saved in Authentication → SMTP. This change does not create that mailbox or send a message.
- **OTP expiry.** Authentication → Email → Email OTP Expiration. GoTrue's usual default is 3600 seconds. This repo cannot see the live value. Expired and already-used links both come back as `otp_expired`; the screen uses `error_description` when Supabase includes "expired", "invalid", or "already used", and otherwise says the link is invalid or expired and may already have been used.
- **Minimum password length and leaked-password protection.** Keep the dashboard minimum at 6 unless signup is raised to the same number. If leaked-password protection is on, the reset form shows that the password is too easy to guess and lets the person try another one.
- **Rate limits.** Recovery cooldown ("you can only request this after N seconds") and the email send limit are dashboard settings. The request screen shows the wait when Supabase returns it, and offers a retry for rate limits, network failures, and mailer failures.
- **Confirm email.** `mailer_autoconfirm` is false, so new accounts must confirm before they can sign in. The reset screen does not say whether an address is registered or still unconfirmed. Unknown addresses, "user not found", and "email not confirmed" all show the same sent confirmation, because those responses would reveal whether an account exists.

No service-role key, SMTP password, or database change is required for the screens in this pull request. Do not send a recovery email to a real customer to verify the template; use Supabase's template preview or a mailbox you control.
