/** ADR 0015: a change is a boundary change exactly when it touches a configured boundary class, and a boundary change always comes to the maintainer (a one-way door).
 *  The classes are path globs (configurable in `.github/warden.yml` under `boundaries.classes`), plus two patch-aware detectors: a new or major-version dependency in a manifest,
 *  and removed files. The door type comes from these classes only, never from a model's judgment. Heuristic by construction: a miss is possible, an extra hit costs one decision. */
export const DEFAULT_BOUNDARY_CLASSES: Readonly<Record<string, readonly string[]>> = {
  'public-interface': ['*.d.ts', 'openapi*.json', 'openapi*.yaml', 'openapi*.yml', 'swagger*.json', 'swagger*.yaml', '*.proto', '*.graphql', '*.gql', 'api/', 'schemas/'],
  'database-schema': ['migrations/', 'migration/', 'db/', '*.sql', 'schema.prisma', 'schema.rb'],
  'auth-secrets': ['auth/', 'authentication/', 'authorization/', 'secrets/', 'secret/', 'credentials/', 'security/', 'permissions/', '.env', '.env.*', '*.pem', '*.key'],
  'dependency': ['package.json', 'go.mod', 'requirements*.txt', 'Cargo.toml', 'Gemfile'],
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
const NOT_DEP = new Set(['version', 'name', 'main', 'type', 'license', 'description', 'engines', 'node', 'npm', 'private', 'edition', 'rust-version', 'authors', 'publish']);
/** One dependency per line, by manifest: `[name, version]` or null. package.json and Cargo.toml (`name = "1.2"`), go.mod (`mod v1.2.3`), requirements.txt (`name==1.2`), Gemfile (`gem 'name', '~> 1.2'`). */
const lineDep = (file: string, line: string): [string, string] | null => {
  if (file === 'go.mod') { const m = line.match(/^\s*(?:require\s+)?([\w.\-]+\.[\w.\-]+\/[\w.\-\/]+|[\w.\-]+\.[\w.\-]+)\s+(v\d[\w.\-+]*)/); return m && !/^(module|go|toolchain|replace|exclude|retract)\b/.test(line.trim()) ? [m[1], m[2]] : null; }
  if (/^requirements.*\.txt$/.test(file)) { const m = line.match(/^\s*([A-Za-z0-9_.\-]+)\s*(?:\[[^\]]*\])?\s*(?:==|>=|~=|<=|>|<|===)\s*(\d[\w.*+\-]*)/); return m ? [m[1], m[2]] : null; }
  if (file === 'Gemfile') { const m = line.match(/^\s*gem\s+['"]([^'"]+)['"]\s*,\s*['"][~><=!\s]*([\d][\w.]*)['"]/); return m ? [m[1], m[2]] : null; }
  const m = file === 'Cargo.toml' ? line.match(/^\s*([A-Za-z0-9_\-]+)\s*=\s*(?:"([~^<>=\s]*\d[\w.\-*]*)"|\{[^}]*version\s*=\s*"([~^<>=\s]*\d[\w.\-*]*)")/) : line.match(/^\s*"([^"]+)"\s*:\s*"([^"]+)"/);
  if (!m) return null; const v = m[2] ?? m[3]; return NOT_DEP.has(m[1]) || !VERSION.test(v) ? null : [m[1], v];
};
const PARSED_MANIFEST = /^(package\.json|Cargo\.toml|go\.mod|Gemfile|requirements.*\.txt)$/;
const majorOf = (v: string): number => Number(v.match(/(\d+)/)?.[1]);
/** New dependency, or a major-version change, read from a manifest patch. A configured manifest of a kind that is not parsed counts as changed when it changes at all (see boundaryHits). */
export function dependencyChanges(patch: string, file = 'package.json'): string[] {
  const pick = (sign: '-' | '+') => { const m = new Map<string, string>(); for (const l of patch.split('\n')) { if (!l.startsWith(sign) || l.startsWith(sign.repeat(3))) continue; const d = lineDep(file, l.slice(1)); if (d) m.set(d[0], d[1]); } return m; };
  const del = pick('-'); const add = pick('+'); const out: string[] = [];
  for (const [name, v] of add) { const o = del.get(name); if (o === undefined) out.push(`new dependency ${name} ${v}`); else if (majorOf(v) > majorOf(o)) out.push(`major-version change of ${name}: ${o} -> ${v}`); }
  return out;
}

export function boundaryHits(files: readonly BoundaryFile[], classes: Readonly<Record<string, readonly string[]>> = DEFAULT_BOUNDARY_CLASSES): BoundaryHit[] {
  const hits: BoundaryHit[] = [];
  for (const f of files) {
    for (const [name, globs] of Object.entries(classes)) {
      if (!globs.some((g) => pathMatches(g, f.path))) continue;
      if (name === 'file-removal') { if (removed(f.status)) hits.push({ class: name, path: f.path, why: 'a file was removed' }); continue; }
      if (name === 'dependency') { const base = f.path.split('/').pop() ?? ''; if (!PARSED_MANIFEST.test(base)) { hits.push({ class: name, path: f.path, why: `touches ${name} (a manifest Warden does not parse: any change counts)` }); continue; } for (const why of dependencyChanges(f.patch ?? '', base)) hits.push({ class: name, path: f.path, why }); continue; }
      hits.push({ class: name, path: f.path, why: `touches ${name}` });
    }
  }
  return hits;
}
export const boundaryClassesOf = (hits: readonly BoundaryHit[]): string[] => [...new Set(hits.map((h) => h.class))];
