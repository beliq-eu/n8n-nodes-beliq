import { describe, expect, it } from 'vitest';
import type { IExecuteFunctions, IHttpRequestOptions } from 'n8n-workflow';
import {
	REQUEST_TIMEOUT_MS,
	beliqApiRequest,
	buildRequest,
	type BeliqParams,
} from '../nodes/Beliq/GenericFunctions';

/**
 * Captures what the node hands n8n's authenticated-request helper. The helper is
 * the framework boundary, so it is the one thing doubled here; everything
 * asserted is the option object our own code builds.
 */
function capturing(): { calls: IHttpRequestOptions[]; ctx: IExecuteFunctions } {
	const calls: IHttpRequestOptions[] = [];
	const ctx = {
		helpers: {
			httpRequestWithAuthentication: async (
				_credentialsType: string,
				options: IHttpRequestOptions,
			) => {
				calls.push(options);
				return { body: {}, headers: {}, statusCode: 200 };
			},
		},
	} as unknown as IExecuteFunctions;

	return { calls, ctx };
}

const CASES: Array<{ label: string; params: BeliqParams }> = [
	{
		label: 'generate (JSON in, bytes out)',
		params: {
			operation: 'generate',
			standard: 'xrechnung',
			output: 'xml',
			invoice: { number: 'INV-1' },
		},
	},
	{
		label: 'validate (bytes in, JSON out)',
		params: {
			operation: 'validate',
			rawBody: Buffer.from('<Invoice/>'),
			rawContentType: 'application/xml',
		},
	},
	{
		label: 'convert (bytes in, bytes out)',
		params: {
			operation: 'convert',
			rawBody: Buffer.from('<Invoice/>'),
			rawContentType: 'application/xml',
			sourceFormat: 'ubl',
			targetFormat: 'cii',
		},
	},
];

describe('beliqApiRequest deadline', () => {
	it.each(CASES)('sends an explicit timeout on $label', async ({ params }) => {
		const { calls, ctx } = capturing();

		await beliqApiRequest.call(ctx, buildRequest(params));

		expect(calls).toHaveLength(1);
		expect(calls[0].timeout).toBe(REQUEST_TIMEOUT_MS);
	});

	it('sits above the API request timeout the engine budget is sized against', () => {
		// beliq-api caps a request at 120s and the engine call at 75s. A deadline
		// under 75s would abandon a generate the server is still working on.
		expect(REQUEST_TIMEOUT_MS).toBeGreaterThan(75_000);
	});
});
