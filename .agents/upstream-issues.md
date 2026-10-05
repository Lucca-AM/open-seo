# Issues to file against every-app/open-seo

Fork-local notes. Each section is written to be pasted into a GitHub issue as-is.
All four were re-verified against upstream `db8bde1` on 2026-10-05 and still
reproduce; file paths below are the current upstream ones.

The first three came out of one self-host deployment on 2026-08-31 and cost most of a
day between them.

---

## 1. A bad TEAM_DOMAIN reports "session expired" instead of a config error

**What happens**

On a `cloudflare_access` deployment with `TEAM_DOMAIN` set to a team that does
not exist, the app shows the "Authentication required — refresh your access
session" card. Signing out and back in never helps, because nothing is wrong
with the session.

The Worker log shows the real cause:

```
Cloudflare Access token verification failed: JOSEError: Expected 200 OK from the JSON Web Key Set HTTP response
```

**Why**

`createRemoteJWKSet` fetches `${TEAM_DOMAIN}/cdn-cgi/access/certs`. When that
returns a non-200, jose throws a bare `JOSEError`, not one of the `JWKS*`
subclasses that `classifyAccessVerificationError` checks for. It therefore
falls through to the final `UNAUTHENTICATED`.

This is easy to hit: if the account had no Zero Trust team, deploy creates one
named after the workers.dev subdomain, and an operator who later reads their
real team domain off a login redirect can end up with the two disagreeing.
`<wrong-team>.cloudflareaccess.com/cdn-cgi/access/certs` returns 404.

**What should happen**

It should classify as `AUTH_CONFIG_MISSING` and name `TEAM_DOMAIN`, the same as
the neighbouring issuer and JWKS cases. Every other misconfiguration in that
function already does this; this one gap is what made it unfindable, because
`UNAUTHENTICATED` is deliberately non-reportable.

A patch and a regression test are on our fork.

---

## 2. Self-host CI token needs Secrets Store _edit_, not _read_

**What happens**

Following `docs/maintainers/preview-deployments.md` to build the CI token produces a token
that cannot deploy:

```
AuthError: Edge-preview secret read failed: Failed to create edge preview session
  [cause]: BadRequest: Secrets store binding authorization failed. Check your permissions and secret scopes.
```

**Why**

The doc (line 45) says the token needs "**Secrets Store read** and **Account Settings
read**". Cloudflare treats binding a secret to a Worker as a write against that
secret, so the state-store login needs **Secrets Store edit**. Cloudflare's own
docs call this out for exactly this CI case.

**What should happen**

The doc should say edit, and ideally mention that the secret's scope list has to
include `workers`.

---

## 3. A self-host deploy silently deletes a Worker custom domain

**What happens**

Attach a custom domain to the self-host Worker in the dashboard, then deploy.
The deploy succeeds and the domain is gone; the zone starts answering
`1016 Origin DNS error`. Re-adding it survives only until the next deploy.

**Why**

`deploy/alchemy/alchemy.run.ts:429` passes `domain: prod ? [...] : undefined`, and alchemy
reconciles the Worker's domains on every deploy, so a non-prod stage asserts
"no custom domain" each time.

**What should happen**

Self-hosters running on their own domain need a supported way to declare it —
we added a `SELFHOST_DOMAIN` variable on our fork. Failing that, the self-host
docs should warn that a hand-attached custom domain will be removed by the next
deploy, because the failure is silent and looks like a DNS problem.

---

## 4. The Managed OAuth warning never goes away, even once it is set up

**What happens**

Every `cloudflare_access` deployment shows a permanent warning on the AI & MCP
page:

> This instance is behind Cloudflare Access. MCP clients cannot connect until
> Managed OAuth is enabled on your Access application.

It keeps showing after Managed OAuth is enabled and MCP clients are connecting
fine, and there is no way to dismiss it. On a deployment where MCP genuinely
works, the banner states the opposite.

**Why**

`src/routes/_app/ai.tsx` gates it on auth mode alone:

```jsx
{getAuthMode(import.meta.env.AUTH_MODE) === "cloudflare_access" ? (
```

Nothing checks whether Managed OAuth is actually configured.

**What should happen**

The page can answer the question for real. Once Managed OAuth is on, Cloudflare
serves an authorization-server document on the application's own origin, and it
carries the `registration_endpoint` an MCP client needs:

```bash
curl -s https://<host>/.well-known/oauth-authorization-server | jq .registration_endpoint
```

Probing that from the client and showing the warning only when the endpoint is
absent keeps the guidance for deployments that need it and retires it for the
ones that don't. A failed probe should stay quiet rather than warn, since it
proves nothing either way.

This matters more than a cosmetic nit: when an MCP client later stops working
for an unrelated reason — an expired OAuth grant, say — a standing banner that
says "MCP clients cannot connect" reads as the diagnosis and sends the operator
back to a setting that was never wrong.
