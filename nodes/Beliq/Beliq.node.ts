import {
	NodeApiError,
	NodeConnectionTypes,
	NodeOperationError,
	type IDataObject,
	type IExecuteFunctions,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
	type JsonObject,
} from 'n8n-workflow';

import {
	beliqApiRequest,
	bodyToBuffer,
	bodyToString,
	buildRequest,
	defaultFilename,
	extractApiErrorMessage,
	resolveGenerateTarget,
	sniffContentType,
	type BeliqOperation,
	type BeliqParams,
} from './GenericFunctions';

// The option lists below are copies of the enums in the API's openapi.json,
// and each badge is the one GET /v1/rulesets reports for that format.
// test/apiSurface.test.mts compares both with test/fixtures/api-surface.json,
// which `npm run surface:sync` rewrites from those two endpoints. A value the
// API accepts and no list offers is in NOT_OFFERED (GenericFunctions.ts) with
// its reason.

const DEFAULT_INVOICE = JSON.stringify(
	{
		number: 'INV-2026-001',
		issueDate: '2026-01-15',
		dueDate: '2026-02-14',
		currencyCode: 'EUR',
		buyerReference: 'BUYER-REF-01',
		seller: {
			name: 'Seller GmbH',
			vatId: 'DE123456789',
			contactName: 'Anna Muster',
			email: 'billing@seller.example',
			phone: '+49 30 1234567',
			address: { street: 'Hauptstrasse 1', city: 'Berlin', postalCode: '10115', countryCode: 'DE' },
		},
		buyer: {
			name: 'Buyer SARL',
			vatId: 'FR12345678901',
			address: { street: 'Rue de la Paix 2', city: 'Paris', postalCode: '75002', countryCode: 'FR' },
		},
		lines: [
			{
				description: 'Consulting services',
				quantity: 10,
				unitCode: 'HUR',
				unitPrice: 100,
				lineTotal: 1000,
				vatRate: 19,
				vatCategoryCode: 'S',
			},
		],
		taxSummary: [{ vatCategoryCode: 'S', vatRate: 19, taxableAmount: 1000, taxAmount: 190 }],
		paymentMeans: { typeCode: '58', iban: 'DE89370400440532013000' },
		totalNetAmount: 1000,
		totalTaxAmount: 190,
		totalGrossAmount: 1190,
	},
	null,
	2,
);

function parseJson(value: unknown): IDataObject | undefined {
	if (value === undefined || value === null || value === '') return undefined;
	if (typeof value === 'object') return value as IDataObject;
	if (typeof value === 'string') {
		const parsed = JSON.parse(value) as unknown;
		return typeof parsed === 'object' && parsed !== null ? (parsed as IDataObject) : undefined;
	}
	return undefined;
}

export class Beliq implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'beliq',
		name: 'beliq',
		icon: { light: 'file:beliq.svg', dark: 'file:beliq.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description:
			'Generate, validate, parse and convert e-invoices (XRechnung, ZUGFeRD, Factur-X, Peppol BIS, NLCIUS, FatturaPA, Facturae, e-SLOG, KSeF FA(3))',
		defaults: {
			name: 'beliq',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'beliqApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Generate Invoice',
						value: 'generate',
						description: 'Build a compliant e-invoice document from invoice data',
						action: 'Generate a compliant invoice document',
					},
					{
						name: 'Validate Invoice',
						value: 'validate',
						description: 'Check an XML or PDF invoice against the authority-pinned rules',
						action: 'Validate an invoice document',
					},
					{
						name: 'Parse Invoice',
						value: 'parse',
						description: 'Extract a structured invoice object from an XML or PDF document',
						action: 'Parse an invoice document',
					},
					{
						name: 'Convert Invoice',
						value: 'convert',
						description: 'Convert an invoice document from one format to another',
						action: 'Convert an invoice document',
					},
				],
				default: 'generate',
			},

			// ----- Generate -----
			{
				displayName: 'Standard',
				name: 'standard',
				type: 'options',
				options: [
					{
						// The title-case rule would make this "E-SLOG". The format is spelled
						// "e-SLOG", which is also the label GET /v1/rulesets returns for it.
						// eslint-disable-next-line n8n-nodes-base/node-param-display-name-miscased
						name: 'e-SLOG (Slovenia)',
						value: 'eslog',
						description: 'Schema-checked: structure only, no business rules',
					},
					{
						name: 'Factur-X',
						value: 'facturx',
						description: "Authority-checked: validated against the authority's own rules",
					},
					{
						name: 'Facturae (Spain)',
						value: 'facturae',
						description: 'Schema-checked: structure only, no business rules',
					},
					{
						name: 'FatturaPA (Italy)',
						value: 'fatturapa',
						description: 'Schema-checked: structure only, no business rules. Ordinaria, format FPR12.',
					},
					{
						name: 'KSeF FA(3) (Poland)',
						value: 'ksef',
						description:
							'Schema-checked: structure only, no business rules. Ordinary VAT invoices in PLN between Polish parties, at VAT rates 23, 22, 8, 7 and 5 only. beliq does not submit to KSeF.',
					},
					{
						name: 'NLCIUS (Netherlands)',
						value: 'nlcius',
						description: "Authority-checked: validated against the authority's own rules",
					},
					{
						name: 'Peppol BIS',
						value: 'peppol-bis',
						description: "Authority-checked: validated against the authority's own rules",
					},
					{
						name: 'XRechnung',
						value: 'xrechnung',
						description: "Authority-checked: validated against the authority's own rules",
					},
					{
						name: 'ZUGFeRD',
						value: 'zugferd',
						description: "Authority-checked: validated against the authority's own rules",
					},
				],
				default: 'xrechnung',
				description: 'The e-invoice standard to generate',
				displayOptions: { show: { operation: ['generate'] } },
			},
			{
				displayName:
					'The sample in Invoice (JSON) is an XRechnung example in EUR with a German seller. Replace it with your own invoice data before you generate this standard. KSeF FA(3) takes PLN and Polish parties only.',
				name: 'nationalSampleNotice',
				type: 'notice',
				default: '',
				displayOptions: {
					show: { operation: ['generate'], standard: ['eslog', 'facturae', 'fatturapa', 'ksef'] },
				},
			},
			{
				displayName: 'Output',
				name: 'output',
				type: 'options',
				// "PDF" without a qualifier: whether it is a hybrid PDF/A-3 or a
				// visualization with no embedded XML depends on the chosen standard,
				// which a static label cannot say. The description carries that.
				options: [
					{ name: 'PDF', value: 'pdf' },
					{ name: 'XML', value: 'xml' },
				],
				default: 'xml',
				description:
					'XML returns the invoice as text. PDF returns a hybrid PDF/A-3 with the XML embedded for Factur-X and ZUGFeRD. Every other standard has no hybrid form, so PDF returns a visualization with no XML inside it, and the legal document stays the XML. NLCIUS always returns XML, whatever this field says.',
				displayOptions: { show: { operation: ['generate'] } },
			},
			// One field per standard, so each lists only the profiles it accepts.
			// EXTENDED CTC FR is Factur-X only; the engine answers it on ZUGFeRD
			// with 422 PROFILE_STANDARD_MISMATCH.
			{
				displayName: 'Factur-X Profile',
				name: 'facturxProfile',
				type: 'options',
				options: [
					{ name: 'BASIC', value: 'basic' },
					{ name: 'BASIC WL', value: 'basicwl' },
					{ name: 'EN 16931', value: 'en16931' },
					{ name: 'EXTENDED', value: 'extended' },
					{ name: 'EXTENDED CTC FR', value: 'extended-ctc-fr' },
					{ name: 'MINIMUM', value: 'minimum' },
				],
				default: 'en16931',
				description: 'The Factur-X profile to apply. MINIMUM and BASIC WL carry no invoice lines.',
				displayOptions: { show: { operation: ['generate'], standard: ['facturx'] } },
			},
			{
				displayName: 'ZUGFeRD Profile',
				name: 'facturxProfile',
				type: 'options',
				options: [
					{ name: 'BASIC', value: 'basic' },
					{ name: 'BASIC WL', value: 'basicwl' },
					{ name: 'EN 16931', value: 'en16931' },
					{ name: 'EXTENDED', value: 'extended' },
					{ name: 'MINIMUM', value: 'minimum' },
				],
				default: 'en16931',
				description: 'The ZUGFeRD profile to apply. MINIMUM and BASIC WL carry no invoice lines.',
				displayOptions: { show: { operation: ['generate'], standard: ['zugferd'] } },
			},
			{
				displayName: 'Invoice (JSON)',
				name: 'invoice',
				type: 'json',
				default: DEFAULT_INVOICE,
				required: true,
				description:
					'The invoice object in beliq EN 16931 shape. Use only values the user or the source system supplied. When a required field is missing, ask for it instead of filling it in.',
				displayOptions: { show: { operation: ['generate'] } },
			},
			{
				displayName: 'Validate Result',
				name: 'verify',
				type: 'boolean',
				default: true,
				description: 'Whether to validate the generated document and return the result',
				displayOptions: { show: { operation: ['generate'] } },
			},

			// ----- Raw document input (validate / parse / convert) -----
			{
				displayName: 'Input',
				name: 'inputSource',
				type: 'options',
				options: [
					{ name: 'Binary', value: 'binary' },
					{ name: 'Text', value: 'text' },
				],
				default: 'binary',
				description: 'Where to read the document from',
				displayOptions: { show: { operation: ['validate', 'parse', 'convert'] } },
			},
			{
				displayName: 'Input Binary Field',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				required: true,
				description: 'Name of the binary field that contains the XML or PDF document',
				displayOptions: {
					show: { operation: ['validate', 'parse', 'convert'], inputSource: ['binary'] },
				},
			},
			{
				displayName: 'Input Text',
				name: 'inputText',
				type: 'string',
				typeOptions: { rows: 6 },
				default: '',
				required: true,
				description: 'The XML invoice as text',
				displayOptions: {
					show: { operation: ['validate', 'parse', 'convert'], inputSource: ['text'] },
				},
			},
			{
				displayName: 'Input Content Type',
				name: 'inputContentType',
				type: 'options',
				options: [
					{ name: 'Auto-Detect', value: 'auto' },
					{ name: 'XML', value: 'application/xml' },
					{ name: 'PDF', value: 'application/pdf' },
				],
				default: 'auto',
				description: 'Content type of the input document',
				displayOptions: { show: { operation: ['validate', 'parse', 'convert'] } },
			},

			// ----- Validate -----
			{
				displayName: 'Format',
				name: 'validateFormat',
				type: 'options',
				options: [
					{ name: 'Auto-Detect', value: 'auto' },
					{ name: 'CII', value: 'cii' },
					{
						// The title-case rule would make this "E-SLOG". The format is spelled
						// "e-SLOG", which is also the label GET /v1/rulesets returns for it.
						// eslint-disable-next-line n8n-nodes-base/node-param-display-name-miscased
						name: 'e-SLOG',
						value: 'eslog',
						description: 'Schema-checked: structure only, no business rules',
					},
					{
						name: 'Facturae',
						value: 'facturae',
						description: 'Schema-checked: structure only, no business rules',
					},
					{
						name: 'FatturaPA',
						value: 'fatturapa',
						description: 'Schema-checked: structure only, no business rules',
					},
					{
						name: 'KSeF FA(3)',
						value: 'poland_ksef_fa3',
						description: 'Schema-checked: structure only, no business rules',
					},
					{ name: 'UBL', value: 'ubl' },
				],
				default: 'auto',
				description: 'Hint the expected format, or auto-detect from the document',
				displayOptions: { show: { operation: ['validate'] } },
			},
			{
				displayName: 'Apply France CTC Overlay',
				name: 'franceCtc',
				type: 'boolean',
				default: false,
				description: 'Whether to also apply the French CTC (Flux 2) Schematron overlay',
				displayOptions: { show: { operation: ['validate'] } },
			},

			// ----- Parse -----
			{
				displayName: 'Format',
				name: 'parseFormat',
				type: 'options',
				options: [
					{ name: 'Auto-Detect', value: 'auto' },
					{ name: 'CII', value: 'cii' },
					{ name: 'UBL', value: 'ubl' },
				],
				default: 'auto',
				description:
					'Has no effect on the result: beliq always detects the syntax from the document itself. Parse reads UBL and CII invoices, including the XML embedded in a ZUGFeRD or Factur-X PDF.',
				displayOptions: { show: { operation: ['parse'] } },
			},

			// ----- Convert -----
			// The API converts within the EN 16931 family only, so its source and
			// target enums hold no national format.
			{
				displayName: 'Source Format',
				name: 'sourceFormat',
				type: 'options',
				options: [
					{ name: 'Auto-Detect', value: 'auto' },
					{ name: 'CII', value: 'cii' },
					{ name: 'Factur-X', value: 'facturx' },
					{ name: 'Peppol BIS', value: 'peppol-bis' },
					{ name: 'UBL', value: 'ubl' },
					{ name: 'XRechnung', value: 'xrechnung' },
					{ name: 'ZUGFeRD', value: 'zugferd' },
				],
				default: 'auto',
				description: 'The source format, or auto-detect from the document',
				displayOptions: { show: { operation: ['convert'] } },
			},
			{
				displayName: 'Target Format',
				name: 'targetFormat',
				type: 'options',
				options: [
					{ name: 'CII', value: 'cii' },
					{ name: 'Factur-X', value: 'facturx' },
					{ name: 'Peppol BIS', value: 'peppol-bis' },
					{ name: 'UBL', value: 'ubl' },
					{ name: 'XRechnung', value: 'xrechnung' },
					{ name: 'ZUGFeRD', value: 'zugferd' },
				],
				default: 'ubl',
				required: true,
				description: 'The format to convert the document to',
				displayOptions: { show: { operation: ['convert'] } },
			},
			{
				displayName: 'Target Profile',
				name: 'targetProfile',
				type: 'options',
				options: [
					{ name: 'BASIC', value: 'basic' },
					{ name: 'BASIC WL', value: 'basicwl' },
					{ name: 'EN 16931', value: 'en16931' },
					{ name: 'EXTENDED', value: 'extended' },
					{ name: 'EXTENDED CTC FR', value: 'extended-ctc-fr' },
					{ name: 'MINIMUM', value: 'minimum' },
				],
				default: 'en16931',
				description:
					'The Factur-X or ZUGFeRD profile to label the target document with. Only the profile identifier is rewritten and the content is not adapted, so an invoice with lines converted to MINIMUM or BASIC WL fails that profile schema.',
				displayOptions: { show: { operation: ['convert'], targetFormat: ['facturx', 'zugferd'] } },
			},
			{
				displayName: 'Drop France CTC Overlay',
				name: 'dropFranceCtcOverlay',
				type: 'boolean',
				default: false,
				description: 'Whether to drop the French CTC overlay when the target cannot carry it (lossy)',
				displayOptions: { show: { operation: ['convert'] } },
			},

			// ----- Output field (document-producing ops) -----
			{
				displayName: 'Put Output In Field',
				name: 'outputField',
				type: 'string',
				default: 'data',
				required: true,
				description: 'Name of the binary field to write the generated or converted document to',
				displayOptions: { show: { operation: ['generate', 'convert'] } },
			},

			// ----- Escape hatch -----
			{
				displayName: 'Advanced (JSON)',
				name: 'advanced',
				type: 'json',
				default: '{}',
				description:
					'Raw JSON deep-merged into the request body (Generate) or query string (Validate, Parse, Convert), for body fields and query parameters that have no control above. Request headers such as Beliq-Ruleset cannot be set here.',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const operation = this.getNodeParameter('operation', i) as BeliqOperation;
				const params: BeliqParams = { operation };

				if (operation === 'generate') {
					const target = resolveGenerateTarget(this.getNodeParameter('standard', i) as string);
					params.standard = target.standard;
					params.output = target.output ?? (this.getNodeParameter('output', i) as 'xml' | 'pdf');
					params.invoice = parseJson(this.getNodeParameter('invoice', i)) ?? {};
					params.verify = this.getNodeParameter('verify', i) as boolean;
					if (target.profile) {
						params.profile = target.profile;
					} else if (target.standard === 'facturx' || target.standard === 'zugferd') {
						params.facturxProfile = this.getNodeParameter('facturxProfile', i, 'en16931') as string;
					}
				} else {
					// validate / parse / convert: resolve the raw document bytes.
					const inputSource = this.getNodeParameter('inputSource', i) as 'binary' | 'text';
					let buffer: Buffer;
					if (inputSource === 'binary') {
						const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i) as string;
						this.helpers.assertBinaryData(i, binaryPropertyName);
						buffer = await this.helpers.getBinaryDataBuffer(i, binaryPropertyName);
					} else {
						buffer = Buffer.from(this.getNodeParameter('inputText', i) as string, 'utf8');
					}

					if (buffer.length === 0) {
						throw new NodeOperationError(this.getNode(), 'The input document is empty', {
							itemIndex: i,
						});
					}

					const selectedType = this.getNodeParameter('inputContentType', i, 'auto') as string;
					params.rawBody = buffer;
					params.rawContentType = selectedType === 'auto' ? sniffContentType(buffer) : selectedType;

					if (operation === 'validate') {
						params.validateFormat = this.getNodeParameter('validateFormat', i, 'auto') as string;
						params.franceCtc = this.getNodeParameter('franceCtc', i, false) as boolean;
					} else if (operation === 'parse') {
						params.parseFormat = this.getNodeParameter('parseFormat', i, 'auto') as string;
					} else {
						params.sourceFormat = this.getNodeParameter('sourceFormat', i, 'auto') as string;
						params.targetFormat = this.getNodeParameter('targetFormat', i) as string;
						params.dropFranceCtcOverlay = this.getNodeParameter(
							'dropFranceCtcOverlay',
							i,
							false,
						) as boolean;
						if (params.targetFormat === 'facturx' || params.targetFormat === 'zugferd') {
							params.targetProfile = this.getNodeParameter('targetProfile', i, 'en16931') as string;
						}
					}
				}

				params.advanced = parseJson(this.getNodeParameter('advanced', i, '{}'));

				const request = buildRequest(params);
				const response = await beliqApiRequest.call(this, request);
				const contentTypeHeader = String(response.headers['content-type'] ?? '').toLowerCase();

				if (request.outputKind === 'json' || contentTypeHeader.includes('application/json')) {
					// JSON result (validate/parse) or the generate JSON fallback.
					const parsed = JSON.parse(bodyToString(response.body)) as IDataObject;
					const data = (parsed.data as IDataObject) ?? parsed;
					returnData.push({ json: data, pairedItem: { item: i } });
					continue;
				}

				// Binary document (generate XML/PDF, or convert output).
				const buffer = bodyToBuffer(response.body);
				const outputField = this.getNodeParameter('outputField', i, 'data') as string;
				const envelope =
					operation === 'convert'
						? String(response.headers['x-output-envelope'] ?? '')
						: (params.output ?? 'xml');
				const fileName = defaultFilename(operation, params.output, envelope);
				const mimeType =
					contentTypeHeader || (envelope === 'pdf' ? 'application/pdf' : 'application/xml');
				const binaryData = await this.helpers.prepareBinaryData(buffer, fileName, mimeType);

				const json: IDataObject = {
					success: true,
					contentType: mimeType,
					sizeBytes: buffer.length,
				};
				if (operation === 'generate') {
					json.schematronVersion = response.headers['x-schematron-version'] ?? undefined;
					if (response.headers['x-pdf-kind']) json.pdfKind = response.headers['x-pdf-kind'];
				} else {
					json.sourceFormat = response.headers['x-source-format'];
					json.targetFormat = response.headers['x-target-format'];
					json.profileDetected = response.headers['x-profile-detected'] || undefined;
					json.lostElementsCount = Number(response.headers['x-lost-elements-count'] ?? 0);
					json.lostElements = parseLostElements(response.headers['x-lost-elements']);
					json.conversionTools = String(response.headers['x-conversion-tools'] ?? '')
						.split(',')
						.filter((t) => t.length > 0);
					json.outputEnvelope = envelope;
				}

				returnData.push({
					json,
					binary: { [outputField]: binaryData },
					pairedItem: { item: i },
				});
			} catch (error) {
				const apiMessage = extractApiErrorMessage(error);
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: apiMessage ?? (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				// The constructor hands an existing NodeOperationError back unchanged,
				// so its message and item index survive.
				if (error instanceof NodeOperationError) {
					throw new NodeOperationError(this.getNode(), error);
				}
				throw new NodeApiError(
					this.getNode(),
					error as JsonObject,
					apiMessage ? { message: apiMessage, itemIndex: i } : { itemIndex: i },
				);
			}
		}

		return [returnData];
	}
}

/** Parse the `x-lost-elements` header (a JSON array) defensively; never throw. */
function parseLostElements(header: unknown): unknown[] {
	if (typeof header !== 'string' || header.length === 0) return [];
	try {
		const parsed = JSON.parse(header) as unknown;
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}
