import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
} from 'n8n-workflow';

export const DEFAULT_BASE_URL = 'https://api.beliq.eu';

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
export function buildRequest(params: BeliqParams): BeliqRequest {
	switch (params.operation) {
		case 'generate': {
			const body: IDataObject = {
				standard: params.standard,
				output: params.output ?? 'xml',
				invoice: params.invoice ?? {},
			};
			// Profile only applies to the Factur-X / ZUGFeRD family.
			if (
				params.facturxProfile &&
				(params.standard === 'facturx' || params.standard === 'zugferd')
			) {
				body.facturxProfile = params.facturxProfile;
			}
			if (typeof params.verify === 'boolean') body.verify = params.verify;

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
	const credentials = await this.getCredentials('beliqApi');
	const baseUrl = String(credentials.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');

	const options: IHttpRequestOptions = {
		method: request.method,
		url: `${baseUrl}${request.endpoint}`,
		headers: { 'Content-Type': request.contentType },
		qs: request.query,
		returnFullResponse: true,
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
