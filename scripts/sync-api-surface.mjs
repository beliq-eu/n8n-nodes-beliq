// Rewrites test/fixtures/api-surface.json from the two public views of the
// beliq API: the enums the four operations accept (openapi.json) and the badge
// each format carries (GET /v1/rulesets, which takes no API key). The node's
// dropdowns are compared with that file in test/apiSurface.test.mts, so the
// lists are checked against what the API published and not against memory.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OPENAPI_URL = 'https://api.beliq.eu/openapi.json';
const RULESETS_URL = 'https://api.beliq.eu/v1/rulesets';

const out = resolve(fileURLToPath(new URL('..', import.meta.url)), 'test/fixtures/api-surface.json');

async function getJson(url) {
	const res = await fetch(url, { headers: { Accept: 'application/json' } });
	if (!res.ok) throw new Error(`${url} answered ${res.status}`);
	return res.json();
}

/** The spec writes an enum either as `enum` or as an `anyOf` of one-value enums. */
function enumOf(schema, where) {
	const values = schema?.enum ?? schema?.anyOf?.flatMap((s) => s.enum ?? []);
	if (!Array.isArray(values) || values.length === 0) {
		throw new Error(`${where} carries no enum in ${OPENAPI_URL}`);
	}
	return values;
}

function queryEnum(spec, path, name) {
	const param = spec.paths[path].post.parameters.find((p) => p.in === 'query' && p.name === name);
	return enumOf(param?.schema, `${path} ?${name}`);
}

function bodyEnum(spec, path, name) {
	const schema = spec.paths[path].post.requestBody.content['application/json'].schema;
	return enumOf(schema.properties[name], `${path} body.${name}`);
}

const [spec, rulesets] = await Promise.all([getJson(OPENAPI_URL), getJson(RULESETS_URL)]);

const surface = {
	source: {
		openapi: OPENAPI_URL,
		openapiVersion: spec.info.version,
		rulesets: RULESETS_URL,
		fetchedOn: new Date().toISOString().slice(0, 10),
	},
	enums: {
		generate: {
			standard: bodyEnum(spec, '/v1/generate', 'standard'),
			profile: bodyEnum(spec, '/v1/generate', 'profile'),
			facturxProfile: bodyEnum(spec, '/v1/generate', 'facturxProfile'),
			output: bodyEnum(spec, '/v1/generate', 'output'),
		},
		validate: { format: queryEnum(spec, '/v1/validate', 'format') },
		parse: { format: queryEnum(spec, '/v1/parse', 'format') },
		convert: {
			sourceFormat: queryEnum(spec, '/v1/convert', 'sourceFormat'),
			targetFormat: queryEnum(spec, '/v1/convert', 'targetFormat'),
			targetProfile: queryEnum(spec, '/v1/convert', 'targetProfile'),
		},
	},
	badges: Object.fromEntries(rulesets.data.rulesets.map((r) => [r.format, r.verificationBadge])),
};

writeFileSync(out, `${JSON.stringify(surface, null, '\t')}\n`);
console.log(`wrote ${out}`);
