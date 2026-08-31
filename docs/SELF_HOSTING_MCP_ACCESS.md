# Letting MCP clients reach a self-hosted deployment

Fork note. Applies to a self-hosted deployment running `AUTH_MODE=cloudflare_access`
with Cloudflare Access in front of the Worker.

## The problem

Cloudflare Access authenticates people in a browser. An MCP client
(`claude mcp add --transport http ...`, Codex, the bundled plugin) sends a plain
HTTPS request with no Access session, so Access rejects it before the Worker sees
it. Pointing a plugin at `https://openseo.luccaam.com/mcp` therefore
returns 401 for every teammate until Access is told to leave that one path alone.

## Service tokens do not solve this

The obvious fix is a Cloudflare Access service token, which does get a request
past Access. It does not work here. `src/middleware/ensure-user/cloudflareAccess.ts`
requires both claims off the Access JWT:

```ts
const userId = typeof payload.sub === "string" ? payload.sub : null;
const userEmail = typeof payload.email === "string" ? payload.email : null;
if (!userId || !userEmail) {
  throw new AppError("UNAUTHENTICATED");
}
```

A service-token JWT identifies a machine, carrying `common_name` and no `email`,
so it fails that check and the request 401s with `UNAUTHENTICATED` even though
Access allowed it through. Supporting service tokens would mean changing how the
app maps an Access identity to a user, which is an auth change, not configuration.

## What does work: bypass Access on /mcp only

`/mcp` does not rely on Access for identity. It authenticates itself, before any
Access-derived context is resolved. In `src/server/mcp/oauth-provider.ts` the
Worker's fetch handler runs the API-key check first:

```ts
const apiKeyResponse = await handleMcpApiKeyRequest(request, env, ctx);
if (apiKeyResponse) return apiKeyResponse;
```

and otherwise hands the request to the MCP OAuth provider. `handleMcpApiKeyRequest`
(`src/server/mcp/api-key-auth.ts`) is scoped to `MCP_ROUTE` (`/mcp`), accepts a key
with the `oseo_` prefix from either an `x-api-key` header or `Authorization: Bearer`,
and verifies it through Better Auth.

So an Access bypass on `/mcp` does not leave the endpoint open. It moves the gate
from Access to the app's own API key and OAuth checks, which is what the hosted
product uses for the same route.

### Zero Trust steps

1. Zero Trust -> Access -> Applications -> **Add an application** -> Self-hosted.
2. Set the domain to the same hostname as the main application and set the **path**
   to `mcp`. Path-scoped applications take precedence over the hostname-wide one.
3. Add a single policy: action **Bypass**, include **Everyone**.
4. Leave the existing hostname-wide application untouched, so the dashboard keeps
   its Google Workspace sign-in.

### Verify before telling the team

Issue an API key in the self-hosted app (Settings -> API keys), then:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' \
  -H 'x-api-key: oseo_YOUR_KEY' \
  -H 'Content-Type: application/json' \
  -X POST https://openseo.luccaam.com/mcp \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Before the bypass this returns 401 from Access. After it, a 2xx means the API-key
path accepted the key. A 401 that mentions the API key means Access is out of the
way and the key itself was rejected.

## One thing to confirm on a self-hosted deployment

The API-key path resolves the caller with `AuthRepository.getHostedUser` and
`getOrCreateDefaultHostedOrganization`, and its comments describe the hosted
product. It is not gated on `AUTH_MODE`, so it should run the same way here, but
this has not been exercised against a self-hosted deployment. Run the curl above
and confirm a real tool call succeeds before pointing the team's plugin at this
endpoint.
