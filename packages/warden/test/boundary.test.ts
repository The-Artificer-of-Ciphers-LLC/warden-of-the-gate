import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boundaryClassesOf, boundaryHits, dependencyChanges, pathMatches } from '../src/verify/boundary.ts';

/** ADR 0015: boundary classes decide the door; detection is path globs plus two patch-aware detectors. */
const f = (path: string, status = 'modified', patch = '') => ({ path, status, patch });
const classes = (files: Array<ReturnType<typeof f>>, cfg?: Record<string, string[]>) => boundaryClassesOf(boundaryHits(files, cfg));

test('glob forms: a directory anywhere, a file name anywhere, a full path, and ** across directories', () => {
  assert.equal(pathMatches('migrations/', 'db/migrations/001.sql'), true); assert.equal(pathMatches('migrations/', 'src/migrationsx/a.js'), false);
  assert.equal(pathMatches('*.sql', 'a/b/c.sql'), true); assert.equal(pathMatches('*.sql', 'a/b/c.sqlx'), false);
  assert.equal(pathMatches('.github/workflows/*release*', '.github/workflows/auto-release.yml'), true); assert.equal(pathMatches('.github/workflows/*release*', '.github/workflows/sub/auto-release.yml'), false);
  assert.equal(pathMatches('src/**/api.ts', 'src/a/b/api.ts'), true); assert.equal(pathMatches('src/**/api.ts', 'src/api.ts'), true); assert.equal(pathMatches('src/**/api.ts', 'lib/api.ts'), false);
});

test('each default class is detected, and ordinary source, tests and docs are not boundary changes', () => {
  assert.deepEqual(classes([f('src/sum.js'), f('test/sum.test.js', 'added'), f('docs/guide.md'), f('README.md')]), []);
  assert.deepEqual(classes([f('migrations/001.sql')]), ['database-schema']);
  assert.deepEqual(classes([f('src/auth/login.js')]), ['auth-secrets']); assert.deepEqual(classes([f('.env.production')]), ['auth-secrets']);
  assert.deepEqual(classes([f('api/v1/openapi.yaml')]).sort(), ['public-interface']); assert.deepEqual(classes([f('types/index.d.ts')]), ['public-interface']);
  assert.deepEqual(classes([f('.github/workflows/ci.yml')]), ['verification-ci']); assert.deepEqual(classes([f('jest.config.js')]), ['verification-ci']);
  assert.deepEqual(classes([f('.github/workflows/release.yml')]).sort(), ['external-effect', 'verification-ci'], 'releases are an external effect and also CI infrastructure');
  assert.deepEqual(classes([f('Dockerfile')]), ['external-effect']); assert.deepEqual(classes([f('infra/main.tf')]), ['external-effect']);
  assert.deepEqual(classes([f('src/old.js', 'D')]), ['file-removal']); assert.deepEqual(classes([f('src/old.js', 'removed')]), ['file-removal']); assert.deepEqual(classes([f('src/new.js', 'A')]), []);
});

test('dependencies: a new dependency or a major-version change counts; a patch or minor bump and non-dependency fields do not', () => {
  const p = (del: string[], add: string[]) => ['@@', ...del.map((l) => '-' + l), ...add.map((l) => '+' + l)].join('\n');
  assert.deepEqual(dependencyChanges(p([], ['    "left-pad": "^1.3.0",'])), ['new dependency left-pad ^1.3.0']);
  assert.deepEqual(dependencyChanges(p(['    "ajv": "^8.12.0",'], ['    "ajv": "^9.0.1",'])), ['major-version change of ajv: ^8.12.0 -> ^9.0.1']);
  assert.deepEqual(dependencyChanges(p(['    "ajv": "^8.12.0",'], ['    "ajv": "^8.17.1",'])), []);
  assert.deepEqual(dependencyChanges(p(['  "version": "1.2.0",'], ['  "version": "2.0.0",'])), [], 'the package\'s own version is not a dependency');
  assert.deepEqual(classes([f('package.json', 'modified', p([], ['    "left-pad": "^1.3.0",']))]), ['dependency']); assert.deepEqual(classes([f('package.json', 'modified', p(['"test": "node --test"'], ['"test": "node --test --x"']))]), [], 'a script edit is not a dependency change');
  assert.deepEqual(classes([f('packages/web/package.json', 'modified', p([], ['    "react": "^19.0.0",']))]), ['dependency'], 'nested manifests too');
});

test('classes are configurable: a repository can name shared components and drop or add classes', () => {
  assert.deepEqual(classes([f('src/shared/ui/Button.tsx')]), []);
  assert.deepEqual(classes([f('src/shared/ui/Button.tsx')], { 'shared-component': ['src/shared/'] }), ['shared-component']);
  assert.deepEqual(classes([f('migrations/001.sql')], { 'shared-component': ['src/shared/'] }), [], 'a configured set replaces the defaults, it does not extend them');
});

test('other ecosystems: go.mod, requirements.txt, Cargo.toml and Gemfile new and major-version changes count; minor bumps and non-dependency lines do not; an unparsed configured manifest counts on any change', () => {
  const p = (del: string[], add: string[]) => ['@@', ...del.map((l) => '-' + l), ...add.map((l) => '+' + l)].join('\n');
  assert.deepEqual(dependencyChanges(p([], ['\tgithub.com/x/y v1.2.3']), 'go.mod'), ['new dependency github.com/x/y v1.2.3']);
  assert.deepEqual(dependencyChanges(p(['\tgithub.com/x/y v1.2.3'], ['\tgithub.com/x/y v2.0.0']), 'go.mod'), ['major-version change of github.com/x/y: v1.2.3 -> v2.0.0']);
  assert.deepEqual(dependencyChanges(p(['\tgithub.com/x/y v1.2.3'], ['\tgithub.com/x/y v1.9.0']), 'go.mod'), []); assert.deepEqual(dependencyChanges(p(['go 1.21'], ['go 1.22']), 'go.mod'), []); assert.deepEqual(dependencyChanges(p(['module example.com/m v1'], ['module example.com/m v2']), 'go.mod'), []);
  assert.deepEqual(dependencyChanges(p(['flask==2.3.1'], ['flask==3.0.0']), 'requirements.txt'), ['major-version change of flask: 2.3.1 -> 3.0.0']); assert.deepEqual(dependencyChanges(p([], ['requests>=2.31']), 'requirements-dev.txt'), ['new dependency requests 2.31']); assert.deepEqual(dependencyChanges(p(['flask==2.3.1'], ['flask==2.3.2']), 'requirements.txt'), []);
  assert.deepEqual(dependencyChanges(p([], ['serde = "1.0"', 'tokio = { version = "1.2", features = ["full"] }']), 'Cargo.toml'), ['new dependency serde 1.0', 'new dependency tokio 1.2']); assert.deepEqual(dependencyChanges(p(['version = "0.1.0"', 'edition = "2018"'], ['version = "0.2.0"', 'edition = "2021"']), 'Cargo.toml'), []);
  assert.deepEqual(dependencyChanges(p(["gem 'rails', '~> 6.1'"], ["gem 'rails', '~> 7.0'"]), 'Gemfile'), ['major-version change of rails: 6.1 -> 7.0']);
  assert.deepEqual(classes([f('services/core/go.mod', 'modified', p([], ['\tgithub.com/x/y v1.2.3']))]), ['dependency']); assert.deepEqual(classes([f('go.sum', 'modified', p([], ['x']))]), []);
  assert.deepEqual(classes([f('pyproject.toml', 'modified', p([], ['x']))], { dependency: ['pyproject.toml'] }), ['dependency'], 'a configured manifest that is not parsed counts on any change');
});
