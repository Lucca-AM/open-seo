# Issues to file against every-app/open-seo

Fork-local notes. Each section is written to be pasted into a GitHub issue as-is.
All three came out of one self-host deployment on 2026-08-31 and cost most of a
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

Following `docs/PREVIEW_DEPLOYMENTS.md` to build the CI token produces a token
that cannot deploy:

```
AuthError: Edge-preview secret read failed: Failed to create edge preview session
  [cause]: BadRequest: Secrets store binding authorization failed. Check your permissions and secret scopes.
```

**Why**

The doc says the token needs "**Secrets Store read** and **Account Settings
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

`alchemy.run.ts` passes `domain: prod ? [...] : undefined`, and alchemy
reconciles the Worker's domains on every deploy, so a non-prod stage asserts
"no custom domain" each time.

**What should happen**

Self-hosters running on their own domain need a supported way to declare it —
we added a `SELFHOST_DOMAIN` variable on our fork. Failing that, the self-host
docs should warn that a hand-attached custom domain will be removed by the next
deploy, because the failure is silent and looks like a DNS problem.
