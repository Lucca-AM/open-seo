# Letting MCP clients reach a self-hosted deployment

Fork note. Applies to a self-hosted deployment running `AUTH_MODE=cloudflare_access`
with Cloudflare Access in front of the Worker. Written from the setup that is
running now, after getting it wrong twice.

## The problem

Cloudflare Access authenticates people in a browser. An MCP client sends a plain
HTTPS request with no Access session, so Access rejects it before the Worker sees
it. Pointing a plugin or connector at `https://<host>/mcp` returns 401 until Access
is told how to authenticate a non-browser client.

## The answer: Managed OAuth

Cloudflare's **Managed OAuth** exists for exactly this. Access becomes an OAuth
authorization server for the application, and an MCP client registers itself,
sends the user through a browser sign-in once, and then holds a token. The app's
own AI & MCP page says so directly:

> This instance is behind Cloudflare Access. MCP clients cannot connect until
> Managed OAuth is enabled on your Access application.

### Turn it on

Zero Trust → Access → Applications → your application → **Additional settings**
→ **OAuth** → **Managed OAuth**.

Three settings matter:

- **Allow localhost clients** and **Allow loopback clients** — on. CLI and desktop
  agents (Claude Code, Codex CLI) register `http://localhost:PORT/callback`.
- **Allowed redirect URIs** — the step that is easy to miss and produces the least
  obvious failure. Web connectors need their HTTPS callback listed here. For
  Claude's custom connectors:

  ```text
  https://claude.ai/api/mcp/auth_callback
  https://claude.com/api/mcp/auth_callback
  ```

  A path may end in `/*` for wildcard matching.

With the list empty, a web connector fails at registration with a message like
"Couldn't register with <app>'s sign-in service" and an `ofid_…` reference. The
upstream docs put it plainly: without these, clients cannot finish Dynamic Client
Registration, and they log in but expose no tools.

### Verify from outside

These are public and need no session:

```bash
curl -s https://<host>/.well-known/oauth-authorization-server | jq .registration_endpoint
curl -s https://<host>/.well-known/oauth-protected-resource/mcp
```

The first returns the registration endpoint the client uses; the second should
name `/mcp` as the resource and your team as the authorization server. If either
is missing, Managed OAuth is not on.

## POLICY_AUD has to match the hostname the client uses

Access applications each have their own audience tag, and the Worker validates
tokens against exactly one, `POLICY_AUD`. If the deployment answers on more than
one hostname (a workers.dev URL and a custom domain, say), check which application
guards the hostname the client will actually use — an application covering both
has one AUD, two applications have two, and the layout can change as the account
is reorganized.

Read it off the live login redirect rather than trusting a value from last week:

```bash
curl -sI -H 'Accept: text/html' https://<host>/ | grep -i '^location:'
```

The `kid` parameter in that URL is the audience tag guarding that hostname. It
must equal `POLICY_AUD`, and a changed secret only reaches the Worker on the next
deploy.

## What does not work

**Service tokens.** They get a request past Access, but the JWT identifies a
machine — `common_name`, no `email` — and
`src/middleware/ensure-user/cloudflareAccess.ts` requires both `sub` and `email`.
The request 401s after Access allowed it.

**A bypass policy on `/mcp`.** An earlier version of this document recommended
this. It is worse than Managed OAuth: it turns off Access for that path and leans
entirely on the app's own API-key check, and it is not what the product expects.
Use Managed OAuth.
