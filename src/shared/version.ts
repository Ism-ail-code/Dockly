// Minimal semantic-version helpers shared by the updater (main process) and
// the unit tests. Only the compare logic lives here so it stays free of any
// electron imports and can be unit-tested with plain node:test.

const VERSION_RE = /^[vV]?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

export function parseVersion(input: string): ParsedVersion | null {
  const m = VERSION_RE.exec(String(input).trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/**
 * Compares two version strings ("1.0.0", "v1.2.0" both accepted).
 * Returns 1 when `a` is newer, -1 when `b` is newer, 0 when equal.
 * Unparsable input is treated as lower than any valid version (0.0.0).
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a) ?? { major: 0, minor: 0, patch: 0 };
  const pb = parseVersion(b) ?? { major: 0, minor: 0, patch: 0 };
  if (pa.major !== pb.major) return pa.major > pb.major ? 1 : -1;
  if (pa.minor !== pb.minor) return pa.minor > pb.minor ? 1 : -1;
  if (pa.patch !== pb.patch) return pa.patch > pb.patch ? 1 : -1;
  return 0;
}

/** True when `latest` is a valid version newer than `current`. */
export function isNewerVersion(latest: string, current: string): boolean {
  if (!parseVersion(latest)) return false;
  return compareVersions(latest, current) > 0;
}

/** Normalizes "v1.2.0" → "1.2.0". */
export function stripVersionPrefix(v: string): string {
  return String(v).replace(/^v/i, '');
}