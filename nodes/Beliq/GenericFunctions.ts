import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
} from 'n8n-workflow';

export const DEFAULT_BASE_URL = 'https://api.beliq.eu';

/**
 * Per-request deadline, matching the beliq SDKs. Generous on purpose: a generate
 * with `verify` runs a full Schematron pass server-side, and a client that gives
 * up first abandons work that is still running without learning whether the
 * document was produced. Without it the request falls back to n8n's global axios
 * default of 300s, which strands a workflow execution for five minutes on a
 * black-holed host.
 */
export const REQUEST_TIMEOUT_MS = 90_000;

export type BeliqOperation = 'generate' | 'validate' | 'parse' | 'convert';

/** Raw-input ops (validate/parse/convert) read the document from a binary field or pasted text. */
export type BeliqInputSource = 'binary' | 'text';

/** What the response carries: parsed JSON, or bytes (a generated/converted document). */
export type BeliqOutputKind = 'json' | 'binary';

export interface BeliqParams {
	operation: BeliqOperation;

	// generate (JSON body in, document bytes out)
	standard?: string;
	output?: 'xml' | 'pdf';
	/** General profile (e.g. netherlands-nlcius for NLCIUS); distinct from facturxProfile. */
	profile?: string;
	facturxProfile?: string;
	invoice?: IDataObject;
	verify?: boolean;

	// validate / parse / convert (raw document bytes in)
	rawBody?: Buffer;
	rawContentType?: string;

	// validate
	validateFormat?: string;
	franceCtc?: boolean;

	// parse
	parseFormat?: string;

	// convert
	sourceFormat?: string;
	targetFormat?: string;
	targetProfile?: string;
	dropFranceCtcOverlay?: boolean;

	/** Raw JSON deep-merged into the request body (generate) or query (raw-input ops). */
	advanced?: IDataObject;
}

export interface BeliqRequest {
	method: IHttpRequestMethods;
	endpoint: string;
	query?: IDataObject;
	/** Set for generate (JSON request body). */
	jsonBody?: IDataObject;
	/** Set for validate/parse/convert (raw document bytes). */
	rawBody?: Buffer;
	contentType: string;
	outputKind: BeliqOutputKind;
}

function isPlainObject(value: unknown): value is IDataObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Deep-merge `source` into `target` (source wins). Arrays and scalars overwrite. */
export function mergeDeep(target: IDataObject, source: IDataObject): IDataObject {
	const out: IDataObject = { ...target };
	for (const [key, value] of Object.entries(source)) {
		// The advanced JSON is user-supplied; skip prototype-pollution keys.
		if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
		if (isPlainObject(value) && isPlainObject(out[key])) {
			out[key] = mergeDeep(out[key] as IDataObject, value);
		} else {
			out[key] = value as IDataObject[string];
		}
	}
	return out;
}

/** Drop undefined/empty entries so optional query params are omitted, not sent blank. */
function compactQuery(query: IDataObject): IDataObject {
	const out: IDataObject = {};
	for (const [key, value] of Object.entries(query)) {
		if (value === undefined || value === '') continue;
		out[key] = value;
	}
	return out;
}

/**
 * Assemble the beliq request from resolved node parameters. Pure and
 * side-effect free so it can be unit-tested without an n8n runtime.
 *
 * The four operations are heterogeneous:
 * - generate: JSON body in, document bytes out (XML or PDF).
 * - validate / parse: raw document bytes in, JSON out.
 * - convert: raw document bytes in, document bytes out.
 */
export interface GenerateTarget {
	standard: string;
	profile?: string;
	output?: 'xml' | 'pdf';
}

/**
 * Resolve a Standard-dropdown value to the generate standard it means. NLCIUS is
 * a Peppol BIS profile (UBL), not a standalone standard, so it resolves to
 * peppol-bis + the netherlands-nlcius profile and forces XML output.
 */
export function resolveGenerateTarget(standard: string): GenerateTarget {
	if (standard === 'nlcius') {
		return { standard: 'peppol-bis', profile: 'netherlands-nlcius', output: 'xml' };
	}
	return { standard };
}

/**
 * The Factur-X profiles each hybrid standard accepts. The engine pins `profile`
 * per standard and answers a pair outside its table with 422
 * PROFILE_STANDARD_MISMATCH: `extended-ctc-fr` is the AFNOR France CTC overlay
 * and has no ZUGFeRD counterpart. The table is the one in the API reference,
 * https://docs.beliq.eu/api-reference/generate/; test/buildRequest.test.mts
 * pins the two dropdowns to it and test/apiSurface.test.mts pins it to the
 * API's enum.
 */
export const FACTURX_PROFILES_BY_STANDARD: Readonly<Record<string, readonly string[]>> = {
	facturx: ['basic', 'basicwl', 'en16931', 'extended', 'extended-ctc-fr', 'minimum'],
	zugferd: ['basic', 'basicwl', 'en16931', 'extended', 'minimum'],
};

const DEFAULT_PROFILE = 'The API applies it when the request names no profile, so there is nothing to choose.';
const PARSE_READS_UBL_AND_CII =
	'POST /v1/parse ignores this hint and reads UBL and CII invoices only.';

/**
 * Values the API's enums accept that no dropdown offers, keyed by operation and
 * request field, each with its reason. test/apiSurface.test.mts fails when an
 * enum value is neither offered nor listed here, and when an entry here names
 * a value the enum has dropped or a dropdown has since taken up.
 */
export const NOT_OFFERED: Readonly<Record<string, Readonly<Record<string, string>>>> = {
	'generate.profile': {
		xrechnung: `The only profile of XRechnung. ${DEFAULT_PROFILE}`,
		peppol: `The default profile of Peppol BIS. ${DEFAULT_PROFILE}`,
		ordinaria: `The only profile of FatturaPA and of Facturae. ${DEFAULT_PROFILE}`,
		eracun: `The only profile of e-SLOG. ${DEFAULT_PROFILE}`,
		fa3: `The only profile of KSeF. ${DEFAULT_PROFILE}`,
		'romania-ro-cius':
			'GET /v1/rulesets lists no Romanian format, so there is no badge to show beside it.',
	},
	'validate.format': {
		sdi_messaggio:
			'An SdI file message (a receipt or a notification), not an invoice, and GET /v1/rulesets lists no entry for it. Auto-Detect still recognises one.',
	},
	'parse.format': {
		fatturapa: PARSE_READS_UBL_AND_CII,
		sdi_messaggio: PARSE_READS_UBL_AND_CII,
		facturae: PARSE_READS_UBL_AND_CII,
		eslog: PARSE_READS_UBL_AND_CII,
		poland_ksef_fa3: PARSE_READS_UBL_AND_CII,
	},
};

export function buildRequest(params: BeliqParams): BeliqRequest {
	switch (params.operation) {
		case 'generate': {
			const body: IDataObject = {
				standard: params.standard,
				output: params.output ?? 'xml',
				invoice: params.invoice ?? {},
			};
			// General profile (e.g. netherlands-nlcius for NLCIUS on Peppol BIS).
			if (params.profile) body.profile = params.profile;
			// Factur-X profile applies only to the Factur-X / ZUGFeRD family, and
			// only when that standard accepts it. The dropdown narrows per standard,
			// but a workflow saved before it did, or one whose Standard was switched
			// after the profile was picked, still carries the old value.
			if (
				params.facturxProfile &&
				FACTURX_PROFILES_BY_STANDARD[params.standard ?? '']?.includes(params.facturxProfile)
			) {
				body.facturxProfile = params.facturxProfile;
			}
			if (typeof params.verify === 'boolean') body.verify = params.verify;
			// XRechnung and Peppol BIS have no hybrid PDF, and the API refuses PDF
			// for them unless the request names a visual to render. Factur-X and
			// ZUGFeRD render theirs either way, so this is inert for them. A
			// pdfTemplateId in `advanced` still wins: the API renders a stored
			// template ahead of the built-in default.
			if (body.output === 'pdf') body.template = 'standard';

			const merged =
				params.advanced && Object.keys(params.advanced).length > 0
					? mergeDeep(body, params.advanced)
					: body;

			return {
				method: 'POST',
				endpoint: '/v1/generate',
				jsonBody: merged,
				contentType: 'application/json',
				outputKind: 'binary',
			};
		}

		case 'validate': {
			const query: IDataObject = { format: params.validateFormat };
			if (typeof params.franceCtc === 'boolean') query.franceCtc = params.franceCtc;
			return {
				method: 'POST',
				endpoint: '/v1/validate',
				query: mergeQueryWithAdvanced(query, params.advanced),
				rawBody: params.rawBody,
				contentType: params.rawContentType ?? 'application/xml',
				outputKind: 'json',
			};
		}

		case 'parse': {
			const query: IDataObject = { format: params.parseFormat };
			return {
				method: 'POST',
				endpoint: '/v1/parse',
				query: mergeQueryWithAdvanced(query, params.advanced),
				rawBody: params.rawBody,
				contentType: params.rawContentType ?? 'application/xml',
				outputKind: 'json',
			};
		}

		case 'convert': {
			const query: IDataObject = {
				sourceFormat: params.sourceFormat,
				targetFormat: params.targetFormat,
			};
			if (
				params.targetProfile &&
				(params.targetFormat === 'facturx' || params.targetFormat === 'zugferd')
			) {
				query.targetProfile = params.targetProfile;
			}
			if (typeof params.dropFranceCtcOverlay === 'boolean') {
				query.dropFranceCtcOverlay = params.dropFranceCtcOverlay;
			}
			return {
				method: 'POST',
				endpoint: '/v1/convert',
				query: mergeQueryWithAdvanced(query, params.advanced),
				rawBody: params.rawBody,
				contentType: params.rawContentType ?? 'application/xml',
				outputKind: 'binary',
			};
		}

		default: {
			// Exhaustiveness guard; unreachable for the typed union.
			throw new Error(`Unsupported beliq operation: ${String(params.operation)}`);
		}
	}
}

function mergeQueryWithAdvanced(query: IDataObject, advanced?: IDataObject): IDataObject {
	const base = compactQuery(query);
	if (advanced && Object.keys(advanced).length > 0) return mergeDeep(base, advanced);
	return base;
}

/** Default output filename for a document-producing op. */
export function defaultFilename(operation: BeliqOperation, output?: string, envelope?: string): string {
	const ext = (operation === 'convert' ? envelope : output) === 'pdf' ? 'pdf' : 'xml';
	return operation === 'convert' ? `converted.${ext}` : `invoice.${ext}`;
}

/** PDF magic bytes (`%PDF-`). Used to auto-detect raw input content type. */
const PDF_MAGIC = Buffer.from('%PDF-');

/** Sniff `application/pdf` vs `application/xml` from the leading bytes. */
export function sniffContentType(body: Buffer): string {
	return body.length >= PDF_MAGIC.length && body.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)
		? 'application/pdf'
		: 'application/xml';
}

/**
 * Perform an authenticated beliq API call. Returns the full response so the
 * node can read JSON bodies, binary document bytes, and the conversion metadata
 * response headers.
 */
export async function beliqApiRequest(
	this: IExecuteFunctions,
	request: BeliqRequest,
): Promise<{ body: unknown; headers: IDataObject; statusCode: number }> {
	const baseUrl = DEFAULT_BASE_URL;

	const options: IHttpRequestOptions = {
		method: request.method,
		url: `${baseUrl}${request.endpoint}`,
		headers: { 'Content-Type': request.contentType },
		qs: request.query,
		returnFullResponse: true,
		timeout: REQUEST_TIMEOUT_MS,
	};

	if (request.outputKind === 'binary') {
		// Document bytes (and the conversion metadata headers) come back raw.
		options.encoding = 'arraybuffer';
		options.json = false;
		// generate sends a JSON body but returns bytes, so it must be stringified.
		options.body = request.jsonBody !== undefined ? JSON.stringify(request.jsonBody) : request.rawBody;
	} else if (request.jsonBody !== undefined) {
		options.body = request.jsonBody;
		options.json = true;
	} else {
		// Raw document bytes in, JSON out: send the buffer untouched and parse the
		// text response in the node (json:false keeps n8n from re-encoding it).
		options.body = request.rawBody;
		options.json = false;
	}

	return this.helpers.httpRequestWithAuthentication.call(this, 'beliqApi', options) as Promise<{
		body: unknown;
		headers: IDataObject;
		statusCode: number;
	}>;
}

/** Coerce a response body (string | Buffer | ArrayBuffer) to a UTF-8 string. */
export function bodyToString(body: unknown): string {
	if (typeof body === 'string') return body;
	if (body instanceof ArrayBuffer) return Buffer.from(body).toString('utf8');
	if (Buffer.isBuffer(body)) return body.toString('utf8');
	return String(body ?? '');
}

/** Coerce a binary response body to a Buffer. */
export function bodyToBuffer(body: unknown): Buffer {
	if (Buffer.isBuffer(body)) return body;
	if (body instanceof ArrayBuffer) return Buffer.from(body);
	if (typeof body === 'string') return Buffer.from(body, 'utf8');
	return Buffer.from(String(body ?? ''));
}

/**
 * Best-effort extraction of beliq's `{ success: false, error: { code, message } }`
 * envelope from a thrown HTTP error, including the binary path where the error
 * body arrives as bytes.
 */
export function extractApiErrorMessage(error: unknown): string | undefined {
	const err = error as { response?: { body?: unknown } } | undefined;
	let payload: unknown = err?.response?.body;
	if (payload instanceof ArrayBuffer) payload = Buffer.from(payload).toString('utf8');
	if (Buffer.isBuffer(payload)) payload = payload.toString('utf8');
	if (typeof payload === 'string') {
		const text = payload;
		try {
			payload = JSON.parse(text);
		} catch {
			return text || undefined;
		}
	}
	if (isPlainObject(payload)) {
		const envelope = payload.error;
		if (isPlainObject(envelope)) {
			const code = typeof envelope.code === 'string' ? envelope.code : undefined;
			const message = typeof envelope.message === 'string' ? envelope.message : undefined;
			if (message) return code ? `${message} (${code})` : message;
		}
		if (typeof payload.message === 'string') return payload.message;
	}
	return undefined;
}
