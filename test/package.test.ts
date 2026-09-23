import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readJson(path: string): any {
	return JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
}

const pkg = readJson('package.json') as {
	name: string;
	scripts: Record<string, string>;
	n8n: { nodes: string[] };
};

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
});
