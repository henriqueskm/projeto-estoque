const requestWindowMs = 10 * 60 * 1_000;
const maximumRequestsPerWindow = 8;

const requestsByUser = new Map<string, number[]>();

export function takeAssistantVoiceTranscriptionSlot(
  userId: string,
  now = Date.now(),
) {
  const cutoff = now - requestWindowMs;
  const recent = (requestsByUser.get(userId) ?? []).filter(
    (requestedAt) => requestedAt > cutoff,
  );
  if (recent.length >= maximumRequestsPerWindow) {
    requestsByUser.set(userId, recent);
    return false;
  }
  recent.push(now);
  requestsByUser.set(userId, recent);
  return true;
}

export function resetAssistantVoiceRateLimitForTests() {
  requestsByUser.clear();
}
