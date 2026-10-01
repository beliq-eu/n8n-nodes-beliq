import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { Beliq } from '../nodes/Beliq/Beliq.node';
import {
	FACTURX_PROFILES_BY_STANDARD,
	NOT_OFFERED,
	resolveGenerateTarget,
} from '../nodes/Beliq/GenericFunctions';

// The dropdowns are hand-written copies of the API's enums. This suite compares
// them with test/fixtures/api-surface.json, a snapshot of the enums in
// https://api.beliq.eu/openapi.json and of the badge GET /v1/rulesets reports
// per format, which `npm run surface:sync` rewrites. After a sync, a value the
// API added fails here until a dropdown offers it or NOT_OFFERED says why not,
// and a value the API dropped fails until the dropdown stops offering it.

interface ApiSurface {
	enums: Record<string, Record<string, string[]>>;
	badges: Record<string, string>;
}

const surface = JSON.parse(
	readFileSync(new URL('./fixtures/api-surface.json', import.meta.url), 'utf8'),
) as ApiSurface;

const properties = new Beliq().description.properties;

interface Option {
	name: string;
	value: string;
	description?: string;
}

function optionsOf(field: string): Option[] {
	const fields = properties.filter((p) => p.name === field && p.type === 'options');
	expect(fields.length, `no options field named ${field}`).toBeGreaterThan(0);
	return fields.flatMap((p) => p.options as Option[]);
}

function valuesOf(field: string): string[] {
	return [...new Set(optionsOf(field).map((o) => o.value))];
}

/** What the node can put into each enum-typed request field, read off its dropdowns. */
const OFFERED: Record<string, () => string[]> = {
	'generate.standard': () => valuesOf('standard').map((v) => resolveGenerateTarget(v).standard),
	'generate.profile': () => [
		...valuesOf('facturxProfile'),
		...valuesOf('standard').flatMap((v) => resolveGenerateTarget(v).profile ?? []),
	],
	'generate.facturxProfile': () => valuesOf('facturxProfile'),
	'generate.output': () => valuesOf('output'),
	'validate.format': () => valuesOf('validateFormat'),
	'parse.format': () => valuesOf('parseFormat'),
	'convert.sourceFormat': () => valuesOf('sourceFormat'),
	'convert.targetFormat': () => valuesOf('targetFormat'),
	'convert.targetProfile': () => valuesOf('targetProfile'),
};

const ENUMS: [string, string[]][] = Object.entries(surface.enums).flatMap(([operation, fields]) =>
	Object.entries(fields).map(([field, values]): [string, string[]] => [`${operation}.${field}`, values]),
);

describe('the dropdowns against the API enums', () => {
	it('covers every enum in the snapshot', () => {
		expect(ENUMS.map(([key]) => key).sort()).toEqual(Object.keys(OFFERED).sort());
	});

	it.for(ENUMS)('%s: every value the API accepts is offered or has a reason', ([key, accepted]) => {
		const offered = new Set(OFFERED[key]());
		const withheld = NOT_OFFERED[key] ?? {};
		const unaccounted = accepted.filter((v) => !offered.has(v) && !(v in withheld));
		expect(unaccounted).toEqual([]);
	});

	it.for(ENUMS)('%s: every value offered is one the API accepts', ([key, accepted]) => {
		expect(OFFERED[key]().filter((v) => !accepted.includes(v))).toEqual([]);
	});

	it('names a reason only for a value the API accepts and no dropdown offers', () => {
		const enums = Object.fromEntries(ENUMS);
		for (const [key, withheld] of Object.entries(NOT_OFFERED)) {
			expect(Object.keys(enums), key).toContain(key);
			const offered = OFFERED[key]();
			for (const [value, reason] of Object.entries(withheld)) {
				expect(enums[key], `${key} ${value}`).toContain(value);
				expect(offered, `${key} ${value}`).not.toContain(value);
				expect(reason.trim().length, `${key} ${value}`).toBeGreaterThan(0);
			}
		}
	});

	it('accepts on each hybrid standard only profiles in the Factur-X enum', () => {
		const accepted = surface.enums.generate.facturxProfile;
		const perStandard = Object.values(FACTURX_PROFILES_BY_STANDARD).flat();
		expect(perStandard.filter((v) => !accepted.includes(v))).toEqual([]);
		expect(accepted.filter((v) => !perStandard.includes(v))).toEqual([]);
	});
});

// The labels beliq shows for the badge values GET /v1/rulesets returns. The
// three badges are defined at https://docs.beliq.eu/compliance/how-verification-works/.
const BADGE_LABEL: Record<string, string> = {
	'authority-verified': 'Authority-checked',
	'independently-rule-checked': 'Community-checked',
	'structure-checked': 'Schema-checked',
};

function badgeLabel(format: string): string {
	const badge = surface.badges[format];
	expect(badge, `GET /v1/rulesets snapshot has no format ${format}`).toBeDefined();
	expect(BADGE_LABEL[badge], badge).toBeDefined();
	return BADGE_LABEL[badge];
}

// The Standard dropdown's values are the API's, except Factur-X, which the
// rulesets catalog spells with a hyphen.
const rulesetsFormat = (standard: string) => (standard === 'facturx' ? 'factur-x' : standard);

describe('the badge beside each format', () => {
	it('offers a Generate standard for every format in the catalog', () => {
		expect(valuesOf('standard').map(rulesetsFormat).sort()).toEqual(Object.keys(surface.badges).sort());
	});

	it.for(optionsOf('standard'))('Generate $name opens with its badge', (option) => {
		expect(option.description?.startsWith(`${badgeLabel(rulesetsFormat(option.value))}: `)).toBe(true);
	});

	// A CII or UBL document can be any of several formats, so those hints and
	// Auto-Detect have no single badge. The national hints each name one format.
	const VALIDATE_FORMAT_TO_RULESETS_FORMAT: Record<string, string> = {
		fatturapa: 'fatturapa',
		facturae: 'facturae',
		eslog: 'eslog',
		poland_ksef_fa3: 'ksef',
	};

	it('gives every Validate format a badge, or is a syntax hint', () => {
		const unbadged = valuesOf('validateFormat').filter((v) => !(v in VALIDATE_FORMAT_TO_RULESETS_FORMAT));
		expect(unbadged.sort()).toEqual(['auto', 'cii', 'ubl']);
	});

	it.for(Object.entries(VALIDATE_FORMAT_TO_RULESETS_FORMAT))(
		'Validate %s opens with its badge',
		([value, format]) => {
			const option = optionsOf('validateFormat').find((o) => o.value === value);
			expect(option, value).toBeDefined();
			expect(option!.description?.startsWith(`${badgeLabel(format)}: `)).toBe(true);
		},
	);
});

describe('the README', () => {
	const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
	const badgeLines = readme.split('\n').filter((line) => /^- \*\*[A-Za-z]+-checked\*\*/.test(line));

	it.for(optionsOf('standard'))('lists $name under its badge and under no other', (option) => {
		const label = option.name.split(' (')[0];
		const badge = badgeLabel(rulesetsFormat(option.value));
		const listing = badgeLines.filter((line) => new RegExp(`[ ,]${label.replace(/[()]/g, '\\$&')}[,.]`).test(line));
		expect(listing.map((line) => line.split('**')[1])).toEqual([badge]);
	});
});

describe('fields shown for some standards only', () => {
	it('name standards the Standard dropdown offers', () => {
		const standards = valuesOf('standard');
		const conditional = properties.filter((p) => p.displayOptions?.show?.standard);
		expect(conditional.length).toBeGreaterThan(0);
		for (const property of conditional) {
			for (const standard of property.displayOptions!.show!.standard as string[]) {
				expect(standards, `${property.name} is shown for ${standard}`).toContain(standard);
			}
		}
	});
});

describe('the shipped templates', () => {
	const dir = new URL('../templates/', import.meta.url);
	const files = readdirSync(dir).filter((f) => f.endsWith('.json'));

	it('are found', () => {
		expect(files.length).toBeGreaterThan(0);
	});

	it.for(files)('%s sets every dropdown to a value the node offers', (file) => {
		const { nodes } = JSON.parse(readFileSync(new URL(file, dir), 'utf8')) as {
			nodes: { name: string; type: string; parameters: Record<string, unknown> }[];
		};
		const beliqNodes = nodes.filter((n) => n.type === 'n8n-nodes-beliq.beliq');
		expect(beliqNodes.length).toBeGreaterThan(0);

		const dropdowns = new Set(properties.filter((p) => p.type === 'options').map((p) => p.name));
		for (const node of beliqNodes) {
			for (const [field, value] of Object.entries(node.parameters)) {
				if (!dropdowns.has(field)) continue;
				expect(valuesOf(field), `${node.name}: ${field}`).toContain(value);
			}
		}
	});
});
