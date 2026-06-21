import { beforeAll, describe, expect, it } from 'vitest';
import { buildRequest, type BeliqRequest } from '../nodes/Beliq/GenericFunctions';

// Live smoke test against the real beliq API. It DOES consume one quota unit
// per call, so it is opt-in: set BELIQ_API_KEY (and optionally BELIQ_BASE_URL)
// to run it, otherwise the whole block is skipped.
const apiKey = process.env.BELIQ_API_KEY;
const baseUrl = (process.env.BELIQ_BASE_URL ?? 'https://api.beliq.eu').replace(/\/+$/, '');
const run = apiKey ? describe : describe.skip;

async function send(req: BeliqRequest): Promise<{ status: number; headers: Headers; bytes: Buffer }> {
	const qs = req.query
		? '?' +
			new URLSearchParams(
				Object.entries(req.query)
					.filter(([, v]) => v !== undefined && v !== '')
					.map(([k, v]) => [k, String(v)]),
			).toString()
		: '';
	const body =
		req.jsonBody !== undefined ? JSON.stringify(req.jsonBody) : (req.rawBody as Buffer | undefined);
	const res = await fetch(`${baseUrl}${req.endpoint}${qs}`, {
		method: req.method,
		headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': req.contentType },
		body: body as BodyInit | undefined,
	});
	const bytes = Buffer.from(await res.arrayBuffer());
	return { status: res.status, headers: res.headers, bytes };
}

run('beliq live API', () => {
	let xrechnungXml: Buffer;

	beforeAll(async () => {
		const res = await send(
			buildRequest({
				operation: 'generate',
				standard: 'xrechnung',
				output: 'xml',
				verify: true,
				invoice: {
					number: 'IT-2026-001',
					issueDate: '2026-01-15',
					dueDate: '2026-02-14',
					currencyCode: 'EUR',
					buyerReference: 'LEITWEG-01',
					seller: {
						name: 'Seller GmbH',
						vatId: 'DE123456789',
						address: { street: 'Hauptstrasse 1', city: 'Berlin', postalCode: '10115', countryCode: 'DE' },
					},
					buyer: {
						name: 'Buyer GmbH',
						vatId: 'DE987654321',
						address: { street: 'Marktplatz 2', city: 'Munich', postalCode: '80331', countryCode: 'DE' },
					},
					lines: [
						{ description: 'Consulting', quantity: 10, unitCode: 'HUR', unitPrice: 100, lineTotal: 1000, vatRate: 19, vatCategoryCode: 'S' },
					],
					taxSummary: [{ vatCategoryCode: 'S', vatRate: 19, taxableAmount: 1000, taxAmount: 190 }],
					totalNetAmount: 1000,
					totalTaxAmount: 190,
					totalGrossAmount: 1190,
				},
			}),
		);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('application/xml');
		expect(res.headers.get('x-schematron-version')).toBeTruthy();
		xrechnungXml = res.bytes;
		expect(xrechnungXml.toString('utf8').trimStart().startsWith('<')).toBe(true);
	});

	it('validates the generated XRechnung', async () => {
		const res = await send(
			buildRequest({ operation: 'validate', rawBody: xrechnungXml, rawContentType: 'application/xml', validateFormat: 'auto' }),
		);
		expect(res.status).toBe(200);
		const json = JSON.parse(res.bytes.toString('utf8'));
		expect(typeof json.data.valid).toBe('boolean');
	});

	it('parses the generated XRechnung', async () => {
		const res = await send(
			buildRequest({ operation: 'parse', rawBody: xrechnungXml, rawContentType: 'application/xml', parseFormat: 'auto' }),
		);
		expect(res.status).toBe(200);
		const json = JSON.parse(res.bytes.toString('utf8'));
		expect(json.data.format).toBeDefined();
	});

	it('converts the generated XRechnung to UBL', async () => {
		const res = await send(
			buildRequest({ operation: 'convert', rawBody: xrechnungXml, rawContentType: 'application/xml', sourceFormat: 'auto', targetFormat: 'ubl' }),
		);
		expect(res.status).toBe(200);
		expect(res.headers.get('x-target-format')).toBe('ubl');
		expect(res.bytes.length).toBeGreaterThan(0);
	});
});
