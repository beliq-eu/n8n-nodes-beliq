import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Beliq } from '../nodes/Beliq/Beliq.node';

// The node's default invoice and the three shipped templates are what a user
// runs before they have written anything of their own, so each has to produce a
// document the API accepts. `verify` defaults to true, and an invoice that
// satisfies plain EN 16931 still fails the XRechnung CIUS on rules no generic
// example carries. These shapes were proven live (2026-09-06); the assertions
// name the rule each field answers, so a future edit that drops one fails here
// instead of in someone's first run.

interface Invoice {
	buyerReference?: string;
	seller: { name: string; contactName?: string; phone?: string; email?: string; vatId?: string; peppol?: unknown };
	buyer: { name: string; email?: string; vatId?: string; peppol?: unknown };
	lines: { lineTotal: number; vatRate: number; vatCategoryCode: string }[];
	taxSummary?: { vatCategoryCode: string; vatRate: number; taxAmount: number }[];
	paymentMeans?: { typeCode?: string };
	totalNetAmount: number;
	totalTaxAmount: number;
	totalGrossAmount: number;
}

function expectAcceptedByXrechnung(invoice: Invoice) {
	// BR-DE-2: the seller contact group BG-6.
	expect(invoice.seller.contactName).toBeTruthy();
	expect(invoice.seller.phone).toBeTruthy();
	// BR-DE-1: payment instructions BG-16.
	expect(invoice.paymentMeans?.typeCode).toBeTruthy();
	// BR-CO-18 / BR-S-01: a VAT breakdown BG-23 matching every line.
	expect(invoice.taxSummary?.length).toBeGreaterThan(0);
	for (const line of invoice.lines) {
		expect(
			invoice.taxSummary!.some(
				(t) => t.vatCategoryCode === line.vatCategoryCode && t.vatRate === line.vatRate,
			),
		).toBe(true);
	}
	// BR-DE-15.
	expect(invoice.buyerReference).toBeTruthy();
	// BT-34 / BT-49. Resolution order is `peppol`, then `email` as EAS `EM`, then
	// `vatId` plus country; any rung addresses a party on xrechnung.
	for (const party of [invoice.seller, invoice.buyer]) {
		expect(party.peppol ?? party.email ?? party.vatId).toBeTruthy();
	}
	// BR-CO-13 / BR-CO-15.
	const net = invoice.lines.reduce((sum, l) => sum + l.lineTotal, 0);
	const tax = invoice.taxSummary!.reduce((sum, t) => sum + t.taxAmount, 0);
	expect(invoice.totalNetAmount).toBeCloseTo(net, 2);
	expect(invoice.totalTaxAmount).toBeCloseTo(tax, 2);
	expect(invoice.totalGrossAmount).toBeCloseTo(net + tax, 2);
}

/** Run a template's Code node the way n8n would, and hand back its items. */
function runCodeNode(jsCode: string, json: unknown = {}): { json: Record<string, unknown> }[] {
	return new Function('$json', jsCode)(json) as { json: Record<string, unknown> }[];
}

function template(name: string): { name: string; parameters: Record<string, any> }[] {
	return JSON.parse(readFileSync(new URL(`../templates/${name}.json`, import.meta.url), 'utf8')).nodes;
}

function codeOf(nodes: { name: string; parameters: Record<string, any> }[], nodeName: string): string {
	const node = nodes.find((n) => n.name === nodeName);
	expect(node, `template has no node named ${nodeName}`).toBeDefined();
	return node!.parameters.jsCode as string;
}

describe("the Generate form's default invoice", () => {
	it('is a document the API accepts', () => {
		const property = new Beliq().description.properties.find(
			(p) => p.name === 'invoice' && p.displayOptions?.show?.operation?.includes('generate'),
		);
		expect(property).toBeDefined();
		expectAcceptedByXrechnung(JSON.parse(property!.default as string) as Invoice);
	});
});

describe('the shipped templates', () => {
	it('generate-then-convert-to-ubl builds an accepted invoice', () => {
		const [item] = runCodeNode(codeOf(template('generate-then-convert-to-ubl'), 'Sample invoice'));
		expectAcceptedByXrechnung(item.json.invoice as Invoice);
	});

	it('parse-invoice-to-fields builds an accepted invoice', () => {
		const [item] = runCodeNode(codeOf(template('parse-invoice-to-fields'), 'Sample invoice'));
		expectAcceptedByXrechnung(item.json.invoice as Invoice);
	});

	it('order-to-xrechnung-zugferd-validate maps its sample order to an accepted invoice', () => {
		// Two Code nodes in sequence: the sample order, then the EN 16931 mapper
		// that reads it. Running both is what proves the mapper carries the
		// seller contact across, not just that the order carries one.
		const nodes = template('order-to-xrechnung-zugferd-validate');
		const [order] = runCodeNode(codeOf(nodes, 'Sample order'));
		const [mapped] = runCodeNode(codeOf(nodes, 'Map to EN 16931'), order.json);
		expectAcceptedByXrechnung(mapped.json.invoice as Invoice);
	});
});
