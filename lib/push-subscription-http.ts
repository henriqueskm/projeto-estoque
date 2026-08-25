export const pushSubscriptionBodyLimitBytes = 8 * 1024;

const firebaseInstallationIdMaxLength = 512;
const controlCharacterPattern = /[\u0000-\u001f\u007f]/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isPushSubscriptionSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");

  if (!origin || (fetchSite && fetchSite !== "same-origin")) return false;

  try {
    return new URL(origin).origin === origin && new URL(request.url).origin === origin;
  } catch {
    return false;
  }
}

export function parsePushSubscriptionBody(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length !== 2 ||
    !keys.includes("deviceId") ||
    !keys.includes("firebaseInstallationId") ||
    typeof record.deviceId !== "string" ||
    !uuidPattern.test(record.deviceId) ||
    typeof record.firebaseInstallationId !== "string" ||
    record.firebaseInstallationId.trim().length === 0 ||
    record.firebaseInstallationId.length > firebaseInstallationIdMaxLength ||
    controlCharacterPattern.test(record.firebaseInstallationId)
  ) {
    return null;
  }

  return {
    deviceId: record.deviceId,
    firebaseInstallationId: record.firebaseInstallationId.trim(),
  };
}

export async function readPushSubscriptionBody(
  request: Request,
): Promise<
  | { data: { deviceId: string; firebaseInstallationId: string } }
  | { error: 400 | 413 | 415 }
> {
  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json") return { error: 415 as const };

  const contentLength = request.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^\d+$/.test(contentLength) || Number(contentLength) > pushSubscriptionBodyLimitBytes)
  ) {
    return { error: 413 as const };
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return { error: 400 as const };
  }

  if (new TextEncoder().encode(rawBody).byteLength > pushSubscriptionBodyLimitBytes) {
    return { error: 413 as const };
  }

  try {
    const parsed = parsePushSubscriptionBody(JSON.parse(rawBody));
    return parsed ? { data: parsed } : { error: 400 as const };
  } catch {
    return { error: 400 as const };
  }
}
