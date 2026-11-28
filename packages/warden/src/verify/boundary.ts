/** ADR 0015: a change is a boundary change exactly when it touches a configured boundary class, and a boundary change always comes to the maintainer (a one-way door).
 *  The classes are path globs (configurable in `.github/warden.yml` under `boundaries.classes`), plus two patch-aware detectors: a new or major-version dependency in a manifest,
 *  and removed files. The door type comes from these classes only, never from a model's judgment. Heuristic by construction: a miss is possible, an extra hit costs one decision. */
export const DEFAULT_BOUNDARY_CLASSES: Readonly<Record<string, readonly string[]>> = {
  'public-interface': ['*.d.ts', 'openapi*.json', 'openapi*.yaml', 'openapi*.yml', 'swagger*.json', 'swagger*.yaml', '*.proto', '*.graphql', '*.gql', 'api/', 'schemas/'],
  'database-schema': ['migrations/', 'migration/', 'db/', '*.sql', 'schema.prisma', 'schema.rb'],
  'auth-secrets': ['auth/', 'authentication/', 'authorization/', 'secrets/', 'secret/', 'credentials/', 'security/', 'permissions/', '.env', '.env.*', '*.pem', '*.key'],
  'dependency': ['package.json'],
  'shared-component': [],
  'verification-ci': ['.github/workflows/', '.github/ORDERS.yaml', '.github/warden.yml', 'jest.config.*', 'vitest.config.*', 'playwright.config.*', '.mocharc*', 'stryker.conf*', '.stryker*', 'eslint.config.*', '.eslintrc*', '.nycrc*', '.c8rc*', 'codecov.yml', '.codecov.yml'],
  'external-effect': ['.github/workflows/*release*', '.github/workflows/*publish*', '.github/workflows/*deploy*', 'Dockerfile', 'Dockerfile.*', 'docker-compose*.yml', 'release.config.*', '.releaserc*', '.npmrc', 'deploy/', 'scripts/release*', 'scripts/publish*', 'scripts/deploy*', 'terraform/', '*.tf', 'helm/', 'k8s/'],
  'file-removal': ['*'],
};

const esc = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
const conv = (g: string) => g.split('**/').map((p) => esc(p).replace(/\*\*|\*/g, (m) => (m === '**' ? '.*' : '[^/]*'))).join('(.*/)?');
/** `dir/` matches that directory anywhere in the path; a glob without `/` matches a file name anywhere; one with `/` matches the whole path. `*` stops at `/`, `**` does not. */
export function pathMatches(glob: string, path: string): boolean {
  const norm = path.replace(/\\/g, '/');
  if (glob.endsWith('/')) return new RegExp(`(^|/)${conv(glob.slice(0, -1))}/`).test(norm);
  if (!glob.includes('/')) return new RegExp(`(^|/)${conv(glob)}$`).test(norm);
  return new RegExp(`^${conv(glob)}$`).test(norm);
}

export interface BoundaryFile { path: string; status?: string; patch?: string }
export interface BoundaryHit { class: string; path: string; why: string }
const removed = (s?: string) => s === 'D' || s === 'removed' || s === 'deleted';
const VERSION = /^[~^<>=v\s]*\d+(\.\d+|\.x|\.\*)?/;
const NOT_DEP = new Set(['version', 'name', 'main', 'type', 'license', 'description', 'engines', 'node', 'npm', 'private']);
/** New dependency, or a major-version change, read from a package.json patch. Any other manifest (go.mod, requirements.txt, ...) is not parsed: a configured one counts when it changes at all. */
export function dependencyChanges(patch: string): string[] {
  const pick = (sign: '-' | '+') => { const m = new Map<string, string>(); for (const l of patch.split('\n')) { if (!l.startsWith(sign) || l.startsWith(sign.repeat(3))) continue; const x = l.slice(1).match(/^\s*"([^"]+)"\s*:\s*"([^"]+)"/); if (x && !NOT_DEP.has(x[1]) && VERSION.test(x[2])) m.set(x[1], x[2]); } return m; };
  const del = pick('-'); const add = pick('+'); const out: string[] = [];
  for (const [name, v] of add) { const o = del.get(name); if (o === undefined) out.push(`new dependency ${name} ${v}`); else { const a = Number(v.match(/(\d+)/)?.[1]); const b = Number(o.match(/(\d+)/)?.[1]); if (a > b) out.push(`major-version change of ${name}: ${o} -> ${v}`); } }
  return out;
}

export function boundaryHits(files: readonly BoundaryFile[], classes: Readonly<Record<string, readonly string[]>> = DEFAULT_BOUNDARY_CLASSES): BoundaryHit[] {
  const hits: BoundaryHit[] = [];
  for (const f of files) {
    for (const [name, globs] of Object.entries(classes)) {
      if (!globs.some((g) => pathMatches(g, f.path))) continue;
      if (name === 'file-removal') { if (removed(f.status)) hits.push({ class: name, path: f.path, why: 'a file was removed' }); continue; }
      if (name === 'dependency' && f.path.split('/').pop() === 'package.json') { for (const why of dependencyChanges(f.patch ?? '')) hits.push({ class: name, path: f.path, why }); continue; }
      hits.push({ class: name, path: f.path, why: `touches ${name}` });
    }
  }
  return hits;
}
export const boundaryClassesOf = (hits: readonly BoundaryHit[]): string[] => [...new Set(hits.map((h) => h.class))];
