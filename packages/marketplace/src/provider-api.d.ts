/** Plugin Hub API v1. Host-side data contributions, not browser UI slots. */
export interface CatalogPlugin {
  packageName: string;
  displayName: string;
  description: string;
  owner: string;
  origin: 'internal' | 'community';
  tags: string[];
  documentationUrl?: string;
  troubleshootingUrl?: string;
  repositoryUrl?: string;
  locales?: Record<string, { displayName?: string; description?: string }>;
}
export interface Catalog {
  schemaVersion: 1;
  plugins: CatalogPlugin[];
}
export interface SourceOptions {
  /** Unique within one marketplace; lowercase letters, digits, dot, dash, underscore. */
  id: string;
  displayName?: string;
  /** -1000 to 1000; higher wins between contributors. Contributors beat main data. */
  priority?: number;
  /** Change when cache identity/meaning changes. Never put credentials here. */
  cacheVersion?: string;
}
export type CatalogSource = SourceOptions & (
  | { kind: 'json'; getCatalog: (options: { signal: AbortSignal }) => Catalog | Promise<Catalog> }
  | { kind: 'npm'; packageName: string }
);
export interface ProviderApi {
  readonly apiVersion: 1;
  /** Returns an idempotent disposer; bind it to the contributing plugin's lifecycle. */
  registerSource(source: CatalogSource): () => void;
}
export function createProviderApi(providers: Pick<ProviderApi, 'registerSource'>): ProviderApi;
