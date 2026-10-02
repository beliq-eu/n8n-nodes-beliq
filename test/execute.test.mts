import { describe, expect, it } from 'vitest';
import {
	NodeApiError,
	NodeOperationError,
	type IExecuteFunctions,
	type INode,
	type JsonObject,
} from 'n8n-workflow';
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

// n8n's request helper hands a JSON answer over already parsed, even with
// `json: false`: validate and parse failed inside n8n 2.41.6 with
// `"[object Object]" is not valid JSON` while every test here passed a string.
describe('execute, the JSON answer of validate and parse', () => {
	const ANSWERS = {
		validate: { success: true, data: { valid: true, errors: [] } },
		parse: { success: true, data: { format: 'cii', invoice: { number: 'INV-1' } } },
	};

	function helpers(body: unknown) {
		return {
			httpRequestWithAuthentication: async () => ({
				statusCode: 200,
				headers: { 'content-type': 'application/json; charset=utf-8' },
				body,
			}),
		};
	}

	const shapes = {
		'already parsed, as n8n passes it': (answer: object) => answer,
		'as a string': (answer: object) => JSON.stringify(answer),
		'as bytes': (answer: object) => Buffer.from(JSON.stringify(answer)),
	};

	for (const [operation, answer] of Object.entries(ANSWERS)) {
		for (const [shape, encode] of Object.entries(shapes)) {
			it(`${operation} returns the data when the body arrives ${shape}`, async () => {
				const parameters = { operation, inputSource: 'text', inputText: '<Invoice/>' };
				const [output] = await new Beliq().execute.call(
					context(1, parameters, false, helpers(encode(answer))),
				);

				expect(output).toEqual([{ json: answer.data, pairedItem: { item: 0 } }]);
			});
		}
	}
});

// Inside n8n the request helper throws n8n's own NodeApiError around the axios
// error. Its message is n8n's generic one for the status ("Bad request - please
// check your parameters"), and re-wrapping it hands the same object back, so the
// API's message and the item index have to be set on that error.
describe('execute, the API refuses and n8n has wrapped the error', () => {
	class AxiosError extends Error {
		constructor(readonly response: { status: number; data: unknown }) {
			super(`Request failed with status code ${response.status}`);
		}
	}

	const ENVELOPE = {
		success: false,
		error: { code: 'INVALID_INVOICE', message: 'Generated invoice failed validation' },
	};

	const bodies = {
		'parsed JSON (validate, parse)': ENVELOPE,
		'bytes (generate, convert)': Buffer.from(JSON.stringify(ENVELOPE)),
	};

	function helpers(data: unknown) {
		return {
			httpRequestWithAuthentication: async () => {
				throw new NodeApiError(NODE, new AxiosError({ status: 422, data }) as unknown as JsonObject);
			},
		};
	}

	const DOCUMENT = { operation: 'validate', inputSource: 'text', inputText: '<Invoice/>' };

	for (const [shape, data] of Object.entries(bodies)) {
		it(`fails with the API message and code, and names the item, for ${shape}`, async () => {
			const run = new Beliq().execute.call(context(2, DOCUMENT, false, helpers(data)));
			const error = await run.then(
				() => undefined,
				(e: unknown) => e,
			);

			expect(error).toBeInstanceOf(NodeApiError);
			expect((error as NodeApiError).message).toBe(
				'Generated invoice failed validation (INVALID_INVOICE)',
			);
			expect((error as NodeApiError).context.itemIndex).toBe(0);
		});

		it(`returns the API message per item on continue on fail, for ${shape}`, async () => {
			const [output] = await new Beliq().execute.call(context(1, DOCUMENT, true, helpers(data)));

			expect(output).toEqual([
				{
					json: { error: 'Generated invoice failed validation (INVALID_INVOICE)' },
					pairedItem: { item: 0 },
				},
			]);
		});
	}
});
