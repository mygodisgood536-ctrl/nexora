/**
 * Portal host grammar (Part 1 §9):
 *   {company}.nexora.app            head office
 *   {company}-{branch}.nexora.app   branch portal
 * Local development equivalents end in .localhost. Because a company slug may
 * itself contain dashes, the parser yields every left-to-right split as an
 * ordered candidate list; the auth resolver picks the first pair that matches
 * real rows, so immutable IDs behind the slugs always win.
 */
export interface HostCandidate {
  companySlug: string;
  branchSlug: string | null;
}

export function parsePortalHost(hostHeader: string | undefined | null): HostCandidate[] {
  if (!hostHeader) return [];
  const host = hostHeader.split(":")[0]!.toLowerCase();
  const label =
    host.endsWith(".localhost") || host.endsWith(".nexora.app")
      ? host.split(".")[0]!
      : host === "localhost" || /^(\d{1,3})(\.\d{1,3}){3}$/.test(host)
        ? null
        : host;
  if (!label) return [];

  // Head-office candidate first, then every dash position as the
  // company/branch boundary (longest company first). A company slug may
  // itself contain dashes, and so may a branch slug — the resolver tries
  // candidates against real rows and picks the first that matches both.
  const candidates: HostCandidate[] = [{ companySlug: label, branchSlug: null }];
  for (let i = 0; i < label.length; i++) {
    if (label[i] !== "-") continue;
    const companySlug = label.slice(0, i);
    const branchSlug = label.slice(i + 1);
    if (companySlug.length > 0 && branchSlug.length > 0) {
      candidates.push({ companySlug, branchSlug });
    }
  }
  return candidates;
}
