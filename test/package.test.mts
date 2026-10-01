import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BeliqApi } from '../credentials/BeliqApi.credentials';
import { Beliq } from '../nodes/Beliq/Beliq.node';

const root = fileURLToPath(new URL('..', import.meta.url));

function readJson(path: string): any {
	return JSON.parse(readFileSync(resolve(root, path), 'utf8'));
}

const pkg = readJson('package.json') as {
	name: string;
	scripts: Record<string, string>;
	n8n: { strict?: boolean; nodes: string[]; credentials: string[] };
	dependencies?: Record<string, string>;
	overrides?: Record<string, string>;
	resolutions?: Record<string, string>;
};

/** Every `file:` path an n8n `icon` value names, whichever of its two forms it takes. */
function iconFiles(icon: unknown): string[] {
	const values = typeof icon === 'string' ? [icon] : Object.values(icon as Record<string, string>);
	return values.map((value) => value.replace(/^file:/, ''));
}

function compareVersions(a: string, b: string): number {
	const [x, y] = [a, b].map((v) => v.split('.').map(Number));
	for (let i = 0; i < 3; i++) {
		if (x[i] !== y[i]) return x[i] - y[i];
	}
	return 0;
}

describe('package metadata', () => {
	// n8n loads a node's codex from the JSON file beside the compiled node. For a
	// community node the codex `node` field is the package name, per
	// https://docs.n8n.io/connect/create-nodes/build-your-node/reference/codex-files
	// and the codex that `npm create @n8n/node` scaffolds. `n8n-nodes-base.` is
	// the namespace of n8n's own built-in nodes.
	it('names this package in the codex of every node n8n loads', () => {
		expect(pkg.n8n.nodes.length).toBeGreaterThan(0);
		for (const compiled of pkg.n8n.nodes) {
			const codex = readJson(`${compiled.replace(/^dist\//, '')}on`);
			expect(codex.node, compiled).toBe(pkg.name);
		}
	});

	// dist is gitignored and CI never publishes, so nothing else notices when a
	// local `npm publish` would ship whatever dist is on disk.
	it('rebuilds dist before npm publish', () => {
		expect(pkg.scripts.prepublishOnly).toBe('npm run build');
	});

	// n8n resolves an icon path against the compiled file that declares it, and
	// scripts/copy-icons.mjs mirrors nodes/ and credentials/ into dist, so a path
	// that resolves in the source tree resolves in the package too.
	it('points every icon at a file that exists', () => {
		const declared: Array<[string, unknown]> = [
			['nodes/Beliq', new Beliq().description.icon],
			['credentials', new BeliqApi().icon],
		];
		for (const [dir, icon] of declared) {
			const files = iconFiles(icon);
			expect(files.length, dir).toBeGreaterThan(0);
			for (const file of files) {
				const path = resolve(root, dir, file);
				expect(existsSync(path), path).toBe(true);
			}
		}
	});
});

// What n8n's verification scanner (`npx @n8n/scan-community-package`) rejects in
// package.json, per https://docs.n8n.io/connect/create-nodes/build-your-node/reference/verification-guidelines
describe('n8n verification constraints', () => {
	it('declares no runtime dependencies and no overrides', () => {
		expect(pkg.dependencies ?? {}).toEqual({});
		expect(pkg.overrides).toBeUndefined();
		expect(pkg.resolutions).toBeUndefined();
	});

	it('keeps strict mode on, which n8n Cloud eligibility requires', () => {
		expect(pkg.n8n.strict).toBe(true);
		expect(pkg.scripts.lint).toBe('n8n-node lint');
	});

	// An `overrides` entry used to hold nanoid clear of GHSA-2v37-7h3g-55p8, whose
	// vulnerable ranges are `< 3.3.18` and `>= 4.0.0, < 5.1.6`. The scanner forbids
	// overrides, so the floor now rests on n8n-workflow resolving an @n8n/utils
	// that pins a patched nanoid.
	it('locks no nanoid inside the vulnerable ranges', () => {
		const lock = readJson('package-lock.json') as {
			packages: Record<string, { version: string }>;
		};
		const locked = Object.entries(lock.packages).filter(([path]) =>
			path.endsWith('node_modules/nanoid'),
		);
		expect(locked.length).toBeGreaterThan(0);
		for (const [path, { version }] of locked) {
			const vulnerable =
				compareVersions(version, '3.3.18') < 0 ||
				(compareVersions(version, '4.0.0') >= 0 && compareVersions(version, '5.1.6') < 0);
			expect(vulnerable, `${path}@${version}`).toBe(false);
		}
	});
});
