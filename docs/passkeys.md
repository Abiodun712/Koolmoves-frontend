# Device sign-in

Fingerprint, face, and device PIN can sign in to an existing KoolMovez account. The biometric or PIN stays on the device. The server stores a public key and checks a signed WebAuthn assertion before it asks Supabase for a normal session. Password sign-in, password reset, and admin role checks are unchanged.

This pull request does not change production settings, run the SQL, enroll a credential, send email, or deploy.

## Readiness

The code is ready for review. It is not ready for customers until the manual steps below are done and someone completes a real device sign-in on the production host.

Automated tests prove the server verifier, using a software key. They are not a fingerprint sensor, Face ID prompt, or phone. A software key can set the user-verification flag because it holds the private key; the tests show that this server rejects a signature whose flag is off, and that the browser is not treated as signed in unless Supabase returns a session.

## Why this does not use Supabase’s passkey switch

Supabase Auth has a native passkey API (`signInWithPasskey` / `registerPasskey`) since `@supabase/supabase-js` 2.105. This repo stays on 2.110.7 so the password-reset client is untouched. That native API was not used, for a specific reason:

As of the Auth source reviewed on 21 Nov 2026, passkey ceremonies set `UserVerification` to `preferred`. go-webauthn only rejects a missing user-verification flag when the value is `required`. There is no dashboard or environment setting to change it. [supabase/auth#2907](https://github.com/supabase/auth/issues/2907) asks for that setting and is open. A browser prompt that asks for a fingerprint does not bind the server: a custom client can submit an assertion the authenticator signed without user verification, and Auth will still create a session.

Do not turn on Authentication → Passkeys for this project as a shortcut. That would add a second sign-in path that does not enforce the check this screen describes.

## What happens on sign-in

1. `POST /api/passkeys` asks the server for a one-time challenge. The challenge expires after five minutes and can be consumed once.
2. The browser calls `navigator.credentials.get()` through `@simplewebauthn/browser`. The device may ask for a fingerprint, face, or PIN. Cancelling the prompt stops here. Nothing is sent for verification.
3. `@simplewebauthn/server` checks the signature, the challenge, the relying party id, the origin, and the user-verification flag. `requireUserVerification` is `true`. A failed check does not create a session. On sign-in, that flag is inside the signed authenticator data, so a modified page cannot flip it without the private key. Registration uses attestation `none`, which does not prove which authenticator created the key. Someone who is already signed in could register a software key. That is the same trust as their password. The private key still never comes to KoolMovez.
4. The credential id is looked up in `passkey_credentials`. The account id comes from that row, not from anything the browser sends.
5. The server calls Supabase Auth’s admin `generateLink({ type: 'magiclink' })` and immediately exchanges `properties.hashed_token` with `verifyOtp`. No email is sent. The action link and the hashed token are not returned to the browser.
6. The browser receives only the access token and refresh token, then calls `supabase.auth.setSession`. That stores a normal Supabase session and emits `SIGNED_IN`, not `PASSWORD_RECOVERY`. Profile role checks are the same ones password sign-in uses.

`generateLink` is refused before it is called when the account has no confirmed email, is anonymous, or is banned. A magic-link exchange can mark an unconfirmed address as confirmed, so that case never reaches it.

The Supabase session’s authentication method will look like a magic link, not WebAuthn, because Auth did not perform the ceremony. The WebAuthn check happened first, in this API. This is an alternative to the password, not a second factor and not an `aal2` session.

## What is stored

`public.passkey_credentials` stores the credential id, the COSE public key, a signature counter, a short device label, and timestamps. It does not store a fingerprint, face image, PIN, password, or private key.

Challenges live in `public.passkey_challenges` until they expire or are used. The table stores a hash of the request IP for rate limiting, not the raw address.

Both tables force row level security and grant nothing to `anon` or `authenticated`. There is no policy. The service role is used only inside the Vercel function. The publishable anon key cannot read the public keys.

Enrollment is rejected unless `auth.getUser` accepts the current access token and the email is confirmed. One account can save 10 devices. Removing a device does not remove the password.

## SQL

Run `supabase/passkeys.sql` once, by hand, in the SQL editor for project `qslfgnrivaacfwsojjhh`. Do not change Auth settings, the email templates, or the redirect URLs while doing that.

## Vercel environment

Set these on the Production environment only. Do not prefix them with `VITE_`. A `VITE_` variable is shipped to the browser.

| Name | Value |
| --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | The project service-role key. It is not in this repo. |
| `PASSKEY_RP_ID` | `koolmovez.com` |
| `PASSKEY_RP_NAME` | `KoolMovez` |
| `PASSKEY_ORIGINS` | `https://koolmovez.com,https://www.koolmovez.com` |

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are optional. They default to the public project URL and anon key already in `src/lib/supabaseClient.ts`.

The function needs Node.js 22 or newer because `@simplewebauthn/server` 14 requires it.

If only one host actually serves the site, list only that origin. Keep the relying party id as `koolmovez.com` even then. Passkeys are bound to that id forever: changing it later makes every enrolled device useless. `www.koolmovez.com` is a valid origin for relying party `koolmovez.com`. A preview host is not.

The loader rejects a relying party or origin on `vercel.app`. A preview deployment that inherits the production variables still fails, because the browser’s origin will not be in the allow list and WebAuthn will not create a credential for `koolmovez.com` on that host.

`http://localhost:5173` works only when `PASSKEY_RP_ID=localhost`. A key enrolled there will not work on `koolmovez.com`. Do not use the localhost pair in production.

`vercel.json` keeps `/api/` out of the SPA rewrite. After deploy, `POST https://koolmovez.com/api/passkeys` with `Origin: https://koolmovez.com` and `Content-Type: application/json` must return JSON. An HTML document means the function is not routed. The installed PWA does not use the navigation fallback for `/api/`, and those requests are network-only.

## Manual device test, after SQL and env and a deploy

Use a test account you control. Do not enroll a customer.

1. Open `https://koolmovez.com/login` (and `www` if that host is in `PASSKEY_ORIGINS`).
2. Sign in with the password. Forgot password still opens `/forgot-password`.
3. On Profile, add this device. The platform prompt should ask for a fingerprint, face, or device PIN. Cancel once and confirm the account stays signed in and no device is saved.
4. Add the device. Sign out. Sign in with “Sign in with fingerprint, face, or device PIN” and do not type the password. A customer lands on `/home`. An admin still lands on `/admin` only when `profiles.role` is `admin`.
5. Remove the device. Password sign-in still works. The removed device does not.
6. On a `*.vercel.app` preview, the same button should say device sign-in is not available on a preview link. Do not expect a production passkey to appear there.

## What this change does not do

It does not enable Supabase passkeys, change the implicit password-recovery flow, send mail, store biometrics, or put the service-role key in the frontend. A cancelled or unsupported browser keeps the password form. The automated suite does not replace the device test above.
