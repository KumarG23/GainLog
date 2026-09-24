export interface RefreshDomain {
  name: string;
  run: () => Promise<void>;
  setError: (message: string | null) => void;
}

export async function refreshIndependentDomains(domains: readonly RefreshDomain[]): Promise<string | null> {
  const results = await Promise.allSettled(domains.map(domain => domain.run()));
  let aggregate: string | null = null;
  results.forEach((result, index) => {
    const domain = domains[index];
    if (result.status === 'fulfilled') {
      domain.setError(null);
      return;
    }
    const message = result.reason instanceof Error
      ? result.reason.message
      : `Failed to refresh ${domain.name}.`;
    domain.setError(message);
    aggregate ??= message;
  });
  return aggregate;
}
