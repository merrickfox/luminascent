function formatZodIssues(issues: unknown): string | null {
  if (!Array.isArray(issues)) return null;

  const lines = issues
    .map((issue) => {
      if (!issue || typeof issue !== 'object') return null;
      const record = issue as { path?: unknown; message?: unknown };
      const path = Array.isArray(record.path)
        ? record.path.map(String).join('.')
        : 'unknown';
      const message = typeof record.message === 'string' ? record.message : 'invalid';
      return `${path}: ${message}`;
    })
    .filter(Boolean);

  return lines.length > 0 ? lines.join('; ') : null;
}

export function formatApiError(body: unknown, status: number): string {
  if (body == null) return `HTTP ${status}`;

  if (typeof body === 'string') {
    return body.trim() || `HTTP ${status}`;
  }

  if (typeof body !== 'object') {
    return String(body);
  }

  const record = body as Record<string, unknown>;

  if (typeof record.error === 'string') {
    return record.error;
  }

  if (record.error && typeof record.error === 'object') {
    const nested = record.error as Record<string, unknown>;
    const fromIssues = formatZodIssues(nested.issues);
    if (fromIssues) return fromIssues;

    if (typeof nested.message === 'string') {
      return nested.message;
    }
  }

  const topLevelIssues = formatZodIssues(record.issues);
  if (topLevelIssues) return topLevelIssues;

  if (typeof record.message === 'string') {
    return record.message;
  }

  try {
    return JSON.stringify(body);
  } catch {
    return `HTTP ${status}`;
  }
}
