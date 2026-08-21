import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const COMMERCIAL_PROPOSAL_COOKIE_NAME = "nk_proposal_session";
export const commercialProposalSessionLifetimeSeconds = 8 * 60 * 60;

const tokenVersion = 1 as const;

type CommercialProposalSessionPayload = {
  version: typeof tokenVersion;
  issuedAt: number;
  expiresAt: number;
};

export type CommercialProposalCredentials = {
  username: string;
  password: string;
  sessionSecret: string;
};

export function getCommercialProposalCredentials(): CommercialProposalCredentials | null {
  const username = process.env.NK_PROPOSAL_USERNAME;
  const password = process.env.NK_PROPOSAL_PASSWORD;
  const sessionSecret = process.env.NK_PROPOSAL_SESSION_SECRET;

  if (!username || !password || !sessionSecret || sessionSecret.trim().length < 32) return null;
  return { username, password, sessionSecret };
}

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest();
}

function safelyMatches(value: string, expected: string) {
  return timingSafeEqual(digest(value), digest(expected));
}

export function commercialProposalCredentialsMatch(
  username: string,
  password: string,
  credentials: CommercialProposalCredentials | null,
) {
  if (!credentials) return false;
  const usernameMatches = safelyMatches(username, credentials.username);
  const passwordMatches = safelyMatches(password, credentials.password);
  return usernameMatches && passwordMatches;
}

function parseSessionPayload(value: unknown): CommercialProposalSessionPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  const keys = Object.keys(payload).sort();
  const expectedKeys = ["expiresAt", "issuedAt", "version"];

  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index]) ||
    payload.version !== tokenVersion ||
    !Number.isSafeInteger(payload.issuedAt) ||
    !Number.isSafeInteger(payload.expiresAt) ||
    (payload.issuedAt as number) <= 0 ||
    (payload.expiresAt as number) <= (payload.issuedAt as number) ||
    (payload.expiresAt as number) - (payload.issuedAt as number) > commercialProposalSessionLifetimeSeconds
  ) return null;

  return {
    version: tokenVersion,
    issuedAt: payload.issuedAt as number,
    expiresAt: payload.expiresAt as number,
  };
}

function signature(encodedPayload: string, secret: string) {
  return createHmac("sha256", secret).update(encodedPayload, "utf8").digest();
}

export function createCommercialProposalSessionToken(secret: string, now = new Date()) {
  if (secret.trim().length < 32) return null;
  const issuedAt = Math.floor(now.getTime() / 1_000);
  const payload = parseSessionPayload({
    version: tokenVersion,
    issuedAt,
    expiresAt: issuedAt + commercialProposalSessionLifetimeSeconds,
  });
  if (!payload) return null;

  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encodedPayload}.${signature(encodedPayload, secret).toString("base64url")}`;
}

export function verifyCommercialProposalSessionToken(
  token: string | undefined,
  secret: string | undefined,
  now = new Date(),
) {
  if (!token || !secret || secret.trim().length < 32 || token.length > 1024) return false;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) return false;

  const expectedSignature = signature(parts[0], secret);
  const suppliedSignature = Buffer.from(parts[1], "base64url");
  if (expectedSignature.length !== suppliedSignature.length || !timingSafeEqual(expectedSignature, suppliedSignature)) return false;

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  } catch {
    return false;
  }

  const payload = parseSessionPayload(decoded);
  if (!payload) return false;
  const currentSeconds = Math.floor(now.getTime() / 1_000);
  return payload.issuedAt <= currentSeconds + 60 && payload.expiresAt > currentSeconds;
}
