import { errors as joseErrors } from "jose";
import { AppError } from "@/server/lib/errors";

// Maps a jwtVerify failure to the right AppError. Config mistakes (wrong
// POLICY_AUD, TEAM_DOMAIN pointing at the wrong team, unreachable JWKS) must
// surface as AUTH_CONFIG_MISSING with guidance — collapsing them into bare
// UNAUTHENTICATED puts self-hosters in a sign-in loop with no signal anywhere,
// since UNAUTHENTICATED is a non-reportable code. Token-level failures
// (expired, bad signature) stay UNAUTHENTICATED: re-authenticating fixes them.
export function classifyAccessVerificationError(error: unknown): AppError {
  if (error instanceof joseErrors.JWTExpired) {
    return new AppError("UNAUTHENTICATED");
  }

  if (error instanceof joseErrors.JWTClaimValidationFailed) {
    if (error.claim === "aud") {
      return new AppError(
        "AUTH_CONFIG_MISSING",
        "Cloudflare Access token rejected: audience mismatch. POLICY_AUD does not match your Access application's AUD tag — copy it from Zero Trust -> Access controls -> Applications -> Configure -> Additional settings.",
      );
    }
    if (error.claim === "iss") {
      return new AppError(
        "AUTH_CONFIG_MISSING",
        "Cloudflare Access token rejected: issuer mismatch. TEAM_DOMAIN does not match the Cloudflare team that issued the token — check it against your team domain in Zero Trust settings.",
      );
    }
    return new AppError("UNAUTHENTICATED");
  }

  if (
    error instanceof joseErrors.JWKSNoMatchingKey ||
    error instanceof joseErrors.JWKSInvalid ||
    error instanceof joseErrors.JWKSTimeout ||
    // The caller only classifies errors thrown by jwtVerify itself, so a
    // non-jose error can only come from the remote JWKS fetch (TypeError in
    // browsers/node, plain Error like "Network connection lost" in workerd).
    !(error instanceof joseErrors.JOSEError)
  ) {
    return new AppError(
      "AUTH_CONFIG_MISSING",
      "Could not verify the Cloudflare Access token against TEAM_DOMAIN's signing keys. Check that TEAM_DOMAIN is your team's https://<team>.cloudflareaccess.com domain.",
    );
  }

  // A JWKS endpoint that answers with a non-200 raises a bare JOSEError, not
  // one of the JWKS* subclasses above — jose throws
  // `Expected 200 OK from the JSON Web Key Set HTTP response` from
  // createRemoteJWKSet. That is the signature of TEAM_DOMAIN naming a team
  // that does not exist (for example the auto-created team named after the
  // workers.dev subdomain, whose /cdn-cgi/access/certs 404s), so it belongs
  // with the other config errors. Letting it fall through to UNAUTHENTICATED
  // tells the operator their session expired and sends them re-authenticating
  // forever against a deployment that can never verify a token.
  if (
    error instanceof joseErrors.JOSEError &&
    error.message.includes("JSON Web Key Set")
  ) {
    return new AppError(
      "AUTH_CONFIG_MISSING",
      "Could not fetch TEAM_DOMAIN's signing keys: the JWKS endpoint did not return 200. Check that TEAM_DOMAIN is your team's https://<team>.cloudflareaccess.com domain — <team>/cdn-cgi/access/certs must answer 200.",
    );
  }

  return new AppError("UNAUTHENTICATED");
}
