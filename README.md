# n8n-nodes-beliq

An [n8n](https://n8n.io) community node for [beliq](https://beliq.eu), the EU e-invoicing compliance API. Generate, validate, parse and convert e-invoices in an n8n workflow, in the formats listed under [Formats](#formats).

beliq generates and validates the compliant document. Transmission (Peppol, PDP, KSeF, SDI), archiving, and tax-authority reporting are separate and remain your access point's job. This node never sends or files an invoice.

## Installation

In n8n, go to **Settings -> Community Nodes -> Install** and enter `n8n-nodes-beliq`. For a self-hosted instance you can also `npm install n8n-nodes-beliq` in your n8n custom-extensions directory.

## Formats

Each format carries a badge that says how deep beliq's check of it goes. The Standard dropdown of Generate Invoice and the Format dropdown of Validate Invoice show it beside the format.

- **Authority-checked** (validated against the authority's own rules): XRechnung, ZUGFeRD, Factur-X, Peppol BIS, NLCIUS.
- **Schema-checked** (structure only, no business rules): FatturaPA, Facturae, e-SLOG, KSeF FA(3).

`valid` means the document passed the rule packs and schemas beliq lists for its format, in the stated versions. It does not mean every recipient, validation tool or tax authority accepts it. [`GET /v1/rulesets`](https://docs.beliq.eu/api-reference/rulesets/) returns the rule pack, version and badge of each format and needs no API key.

KSeF FA(3) generation covers ordinary VAT invoices in PLN between Polish parties, at VAT rates 23, 22, 8, 7 and 5. The [Poland KSeF FA(3) reference](https://docs.beliq.eu/format-reference/poland/) states the full scope.

## Operations

- **Generate Invoice**: build a document from an EN 16931 invoice object. Returns the XML, or a PDF, as binary data. Factur-X and ZUGFeRD return a hybrid PDF/A-3 with the XML embedded, in the profiles MINIMUM, BASIC WL, BASIC, EN 16931 and EXTENDED, plus EXTENDED CTC FR on Factur-X. Every other standard has no hybrid form, so PDF returns a visualization with no XML inside it and the legal document stays the XML. NLCIUS always returns XML, whatever Output says. The sample invoice in the form is an XRechnung example in EUR with a German seller: replace it with your own data before you generate another standard.
- **Validate Invoice**: check an XML or PDF invoice against the rules beliq pins for its format. Returns the validation result (valid flag, errors, warnings, rule and ruleset versions).
- **Parse Invoice**: extract a structured invoice object from a UBL or CII invoice, or from the XML embedded in a ZUGFeRD or Factur-X PDF.
- **Convert Invoice**: convert a document between the EN 16931 formats (CII, UBL, XRechnung, Peppol BIS, ZUGFeRD, Factur-X). Returns the converted document as binary data plus conversion metadata (source and target format, profile detected, lost elements, tools used). A change of Factur-X or ZUGFeRD profile rewrites the profile identifier only and does not adapt the content. The national formats are not convertible.

Each operation reads input either from a binary field (for example the output of a previous node, or an HTTP download) or from pasted text, and writes document output to a binary field you name.

The **Advanced (JSON)** field is an escape hatch for options that have no control of their own. Its JSON is deep-merged into the request body for Generate and into the query string for Validate, Parse and Convert, so any body field of `POST /v1/generate` and any query parameter of the other three endpoints is reachable through it. Request headers are not. The node sets only `Content-Type` itself and the credential adds `Authorization`, with no way to add another header, so the `Beliq-Ruleset` header of `POST /v1/validate` (which pins the validation ruleset) cannot be set from this node. A `Beliq-Ruleset` key in Advanced (JSON) is sent as a query parameter, not as the header.

## Credentials

Create an API key in the beliq dashboard, then add a **Beliq API** credential:

- **API Key**: your beliq key.

The credential test calls `GET /v1/me`, a no-quota check that confirms the key works without consuming your monthly quota.

## Example templates

Import any of these from the n8n canvas (Templates, Import from file), set your **Beliq API** credential, and run them. They are in the GitHub repository, not in the npm package:

- [`templates/order-to-xrechnung-zugferd-validate.json`](https://github.com/beliq-eu/n8n-nodes-beliq/blob/main/templates/order-to-xrechnung-zugferd-validate.json): a validate-led flow. A sample order is mapped to an EN 16931 invoice, beliq generates an XRechnung and a hybrid ZUGFeRD, validates the result, and a compliance gate guards delivery.
- [`templates/generate-then-convert-to-ubl.json`](https://github.com/beliq-eu/n8n-nodes-beliq/blob/main/templates/generate-then-convert-to-ubl.json): generates an invoice and converts it to UBL, surfacing any `lostElements` from a lossy conversion.
- [`templates/parse-invoice-to-fields.json`](https://github.com/beliq-eu/n8n-nodes-beliq/blob/main/templates/parse-invoice-to-fields.json): parses a document into a structured invoice and reads out the fields a downstream step needs.

## Compatibility

Requires n8n with `n8nNodesApiVersion: 1` and Node.js >= 20.15.

## Development

```bash
npm install
npm run build      # tsc + copy icons into dist
npm run lint       # n8n-node lint: the rules n8n's verification scanner applies
npm run scrub:check   # no em-dash in any tracked file
npm run surface:sync  # rewrite test/fixtures/api-surface.json from the live API spec and GET /v1/rulesets
npm test           # unit tests (no network)
BELIQ_API_KEY=blq_xxx npm run test:integration   # hits the live API; draws quota
```

The dropdowns are copies of the API's enums. `test/apiSurface.test.mts` compares them with `test/fixtures/api-surface.json`, so after `npm run surface:sync` a value the API added or dropped fails the tests until a dropdown offers it, or `NOT_OFFERED` in `nodes/Beliq/GenericFunctions.ts` gives the reason it is left out.

Tests are `*.test.mts`, not `.ts`. `"n8n": { "strict": true }` in `package.json` requires the default `eslint.config.mjs`, and that config lints every `.ts` file with the rules for code that runs inside n8n (no `node:fs`, no `process`). Tests do not ship, so they sit outside it.

## Publishing

Released to npm as [`n8n-nodes-beliq`](https://www.npmjs.com/package/n8n-nodes-beliq). Releases run from `.github/workflows/release.yml` via npm Trusted Publishing (OIDC, with provenance). Push a `v*.*.*` tag to publish a new version. No npm token is stored in the repo.

## License

[MIT](LICENSE)
