import { describe, expect, it } from 'vitest';
import { NodeApiError, NodeOperationError, type IExecuteFunctions, type INode } from 'n8n-workflow';
import { Beliq } from '../nodes/Beliq/Beliq.node';

const NODE: INode = {
	id: 'test-node',
	name: 'beliq',
	type: 'n8n-nodes-beliq.beliq',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};

/**
 * Stands in for n8n's execution context. No request helper is defined, so a
 * run that got as far as calling the API would fail on that, not on what is
 * asserted here.
 */
function context(
	items: number,
	parameters: Record<string, unknown>,
	continueOnFail = false,
	helpers: Record<string, unknown> = {},
) {
	return {
		getInputData: () => Array.from({ length: items }, () => ({ json: {} })),
		getNodeParameter: (name: string, _index: number, fallback?: unknown) =>
			name in parameters ? parameters[name] : fallback,
		getNode: () => NODE,
		continueOnFail: () => continueOnFail,
		helpers,
	} as unknown as IExecuteFunctions;
}

const EMPTY_DOCUMENT = { operation: 'validate', inputSource: 'text', inputText: '' };

describe('execute, empty input document', () => {
	it('fails with the node-level error, not an API error, and names the item', async () => {
		const run = new Beliq().execute.call(context(1, EMPTY_DOCUMENT));
		const error = await run.then(
			() => undefined,
			(e: unknown) => e,
		);

		expect(error).toBeInstanceOf(NodeOperationError);
		expect((error as NodeOperationError).message).toBe('The input document is empty');
		expect((error as NodeOperationError).context.itemIndex).toBe(0);
	});

	it('returns the error per item when the node continues on fail', async () => {
		const [output] = await new Beliq().execute.call(context(2, EMPTY_DOCUMENT, true));

		expect(output).toEqual([
			{ json: { error: 'The input document is empty' }, pairedItem: { item: 0 } },
			{ json: { error: 'The input document is empty' }, pairedItem: { item: 1 } },
		]);
	});
});

// The API names the cause of a refusal in its error envelope, and n8n shows a
// failed run by its message and item. Losing either leaves the user with
// "Request failed with status code 429" on an unnamed item.
describe('execute, the API refuses the second item', () => {
	const REFUSAL = {
		response: {
			body: JSON.stringify({
				success: false,
				error: { code: 'RATE_LIMITED', message: 'Rate limit exceeded' },
			}),
		},
	};

	/** Answers the first call like POST /v1/validate does, and refuses every later one. */
	function helpers() {
		let calls = 0;
		return {
			httpRequestWithAuthentication: async () => {
				if (calls++ > 0) throw REFUSAL;
				return {
					statusCode: 200,
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ success: true, data: { valid: true } }),
				};
			},
		};
	}

	const DOCUMENT = { operation: 'validate', inputSource: 'text', inputText: '<Invoice/>' };

	it('fails with the API message and code, and names the item', async () => {
		const run = new Beliq().execute.call(context(2, DOCUMENT, false, helpers()));
		const error = await run.then(
			() => undefined,
			(e: unknown) => e,
		);

		expect(error).toBeInstanceOf(NodeApiError);
		expect((error as NodeApiError).message).toBe('Rate limit exceeded (RATE_LIMITED)');
		expect((error as NodeApiError).context.itemIndex).toBe(1);
	});

	it('keeps the first result and returns the message when the node continues on fail', async () => {
		const [output] = await new Beliq().execute.call(context(2, DOCUMENT, true, helpers()));

		expect(output).toEqual([
			{ json: { valid: true }, pairedItem: { item: 0 } },
			{
				json: { error: 'Rate limit exceeded (RATE_LIMITED)' },
				pairedItem: { item: 1 },
			},
		]);
	});
});
