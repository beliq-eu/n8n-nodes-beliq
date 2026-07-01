# n8n-nodes-beliq

An [n8n](https://n8n.io) community node for [beliq](https://beliq.eu), the EU e-invoicing compliance API. Generate and validate compliant e-invoice documents (XRechnung, ZUGFeRD, Factur-X, Peppol BIS) with authority-pinned, nightly-drift-checked rules.

beliq generates and validates the compliant document. Transmission (Peppol, PDP, KSeF, SDI), archiving, and tax-authority reporting are separate and remain your access point's job. This node never sends or files an invoice.

## Installation

In n8n, go to **Settings -> Community Nodes -> Install** and enter `n8n-nodes-beliq`. For a self-hosted instance you can also `npm install n8n-nodes-beliq` in your n8n custom-extensions directory.

## Operations

- **Generate**: build a compliant document from an EN 16931 invoice object. Returns the XML, or a hybrid PDF/A-3 with the XML embedded, as binary data plus the Schematron version used.
- **Validate**: check an XML or PDF invoice against the authority-pinned rules. Returns the validation result (valid flag, errors, warnings, rule and ruleset versions).
- **Parse**: extract a structured invoice object from an XML or PDF document.
- **Convert**: convert a document between formats (for example CII to UBL, or UBL to ZUGFeRD). Returns the converted document as binary data plus conversion metadata (source and target format, profile detected, lost elements, tools used).

Each operation reads input either from a binary field (for example the output of a previous node, or an HTTP download) or from pasted text, and writes document output to a binary field you name.

The **Advanced (JSON)** field is an escape hatch: its JSON is deep-merged into the request body (Generate) or query (Validate, Parse, Convert), so any API option not surfaced as a control is still reachable.

## Credentials

Create an API key in the beliq dashboard, then add a **beliq API** credential:

- **API Key**: your beliq key.
- **Base URL**: defaults to `https://api.beliq.eu`. Override only for a self-hosted or staging deployment.

The credential test calls `GET /v1/me`, a no-quota check that confirms the key works without consuming your monthly quota.

## Example templates

Import any of these from the n8n canvas (Templates, Import from file), set your **beliq API** credential, and run them:

- `templates/order-to-xrechnung-zugferd-validate.json`: a validate-led flow. A sample order is mapped to an EN 16931 invoice, beliq generates an XRechnung and a hybrid ZUGFeRD, validates the result, and a compliance gate guards delivery.
- `templates/generate-then-convert-to-ubl.json`: generates an invoice and converts it to UBL, surfacing any `lostElements` from a lossy conversion.
- `templates/parse-invoice-to-fields.json`: parses a document into a structured invoice and reads out the fields a downstream step needs.

## Compatibility

Requires n8n with `n8nNodesApiVersion: 1` and Node.js >= 20.15.

## Development

```bash
npm install
npm run build      # tsc + copy icons into dist
npm run lint
npm test           # unit tests (no network)
BELIQ_API_KEY=blq_xxx npm run test:integration   # hits the live API; draws quota
```

## Publishing

Released to npm as [`n8n-nodes-beliq`](https://www.npmjs.com/package/n8n-nodes-beliq). Releases run from `.github/workflows/release.yml` via npm Trusted Publishing (OIDC, with provenance). Push a `v*.*.*` tag to publish a new version. No npm token is stored in the repo.

## License

[MIT](LICENSE)
