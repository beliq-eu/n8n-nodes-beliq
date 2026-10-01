import { describe, expect, it } from 'vitest';
import { NodeOperationError, type IExecuteFunctions, type INode } from 'n8n-workflow';
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
function context(items: number, parameters: Record<string, unknown>, continueOnFail = false) {
	return {
		getInputData: () => Array.from({ length: items }, () => ({ json: {} })),
		getNodeParameter: (name: string, _index: number, fallback?: unknown) =>
			name in parameters ? parameters[name] : fallback,
		getNode: () => NODE,
		continueOnFail: () => continueOnFail,
		helpers: {},
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
