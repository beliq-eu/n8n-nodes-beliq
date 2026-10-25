# n8n-nodes-beliq

An [n8n](https://n8n.io) community node: validate, generate, convert and parse EU e-invoices with the [beliq](https://beliq.eu) API from n8n, in the formats listed under [Formats](#formats).

beliq produces and checks the document. Transmission (Peppol, plateforme agréée, KSeF, SDI), archiving, and tax-authority reporting stay with your access point. This node never sends or files an invoice.

## Installation

In n8n, go to **Settings -> Community Nodes -> Install** and enter `n8n-nodes-beliq`. For a self-hosted instance you can also `npm install n8n-nodes-beliq` in your n8n custom-extensions directory.

## Formats

Generate Invoice offers XRechnung, ZUGFeRD, Factur-X, Peppol BIS, NLCIUS, FatturaPA, Facturae, e-SLOG and KSeF FA(3).

How deep beliq's check goes differs by format. A validation result names the depth of its own check in `verificationBadgeLabel`, as the API states it, and a result without that field states no depth. [How verification works](https://docs.beliq.eu/compliance/how-verification-works/) explains each depth, and [`GET /v1/rulesets`](https://docs.beliq.eu/api-reference/rulesets/) lists each format beliq offers, with its rule pack, version and badge, and needs no API key.

`valid` means the document passed the rule packs and schemas beliq lists for its format, in the stated versions. It does not mean every recipient, validation tool or tax authority accepts it.

KSeF FA(3) generation covers ordinary VAT invoices in PLN between Polish parties, at VAT rates 23, 22, 8, 7 and 5. The [Poland KSeF FA(3) reference](https://docs.beliq.eu/format-reference/poland/) states the full scope.

## Operations

- **Generate Invoice**: build a document from an EN 16931 invoice object. Returns the XML, or a PDF, as binary data, and on the item JSON the verdict validation reached on the generated invoice XML as `validationResult`, the same result Validate Invoice returns. For a hybrid PDF that XML is the one embedded in it; for a visualization PDF it is the XML the PDF was rendered from, which Generate does not return. `validationResult.verificationBadgeLabel` names how deep the check went, as the API states it, and a result without it states no depth. The item JSON also carries `sha256` of the returned document, `pdfKind` for a PDF, and `schematronVersion` when the API sends the `x-schematron-version` header. With **Validate Result** off, no rule set runs: `validationResult.verified` is `false`, its `valid: false` then means nothing was checked, and no depth is named, so read `verified` before `valid`. Factur-X and ZUGFeRD return a hybrid PDF/A-3 with the XML embedded, in the profiles MINIMUM, BASIC WL, BASIC, EN 16931 and EXTENDED, plus EXTENDED CTC FR on Factur-X. Every other standard has no hybrid form, so PDF returns a visualization with no XML inside it and the legal document stays the XML. NLCIUS always returns XML, whatever Output says. The sample invoice in the form is an XRechnung example in EUR with a German seller: replace it with your own data before you generate another standard.
- **Validate Invoice**: check an XML or PDF invoice against the rule packs and schemas of its format. Returns the validation result as the API sends it: `valid`, `errors`, `warnings`, the rule and ruleset versions that judged it, and `verificationBadgeLabel` when the API states a depth (a result without it states none). When the French CTC (Flux 2) rules ran and one of them fired, `franceCtcBlockingRuleIds` lists them. It is a separate answer from `valid`: a document can be `valid` and still trip them ([validate reference](https://docs.beliq.eu/api-reference/validate/)).
- **Parse Invoice**: extract a structured invoice object from a UBL or CII invoice, or from the XML embedded in a ZUGFeRD or Factur-X PDF. The result is a subset of the document, and its `warnings` list what the document holds beyond it ([parse reference](https://docs.beliq.eu/api-reference/parse/)).
- **Convert Invoice**: convert a document between the EN 16931 formats (CII, UBL, XRechnung, Peppol BIS, ZUGFeRD, Factur-X). Returns the converted document as binary data plus conversion metadata (source and target format, profile detected, the lost elements the API detected, tools used). A change of Factur-X or ZUGFeRD profile rewrites the profile identifier only and does not adapt the content. The national formats are not convertible. An XML source sent to Factur-X or ZUGFeRD comes back as CII XML; a PDF comes back only from a hybrid PDF source. The PDF is the one sent, with only its annotation flags normalised for PDF/A, when its embedded XML already is the target: that XML was checked and the PDF container was not. Otherwise it is that PDF re-wrapped around the converted XML, returned only after veraPDF passed it against PDF/A-3b. With a test key the PDF is watermarked last, after any veraPDF check. Detail: https://docs.beliq.eu/api-reference/convert/#a-pdf-sent-for-a-zugferd-or-factur-x-target

Each operation reads input either from a binary field (for example the output of a previous node, or an HTTP download) or from pasted text, and writes document output to a binary field you name.

The **Advanced (JSON)** field is an escape hatch for options that have no control of their own. Its JSON is deep-merged into the request body for Generate and into the query string for Validate, Parse and Convert, so any body field of `POST /v1/generate` and any query parameter of the other three endpoints is reachable through it. Request headers are not. The node sets only `Content-Type` itself, plus `Accept: application/json` on Generate, and the credential adds `Authorization`, with no way to add another header, so the `Beliq-Ruleset` header of `POST /v1/validate` (which pins the validation ruleset) cannot be set from this node. A `Beliq-Ruleset` key in Advanced (JSON) is sent as a query parameter, not as the header.

## Credentials

Create an API key in the beliq dashboard, then add a **Beliq API** credential:

- **API Key**: your beliq key.

The credential test calls `GET /v1/me`, a no-quota check that confirms the key works without consuming your monthly quota.

## Example templates

Import any of these from the n8n canvas (Templates, Import from file), set your **Beliq API** credential, and run them. They are in the GitHub repository, not in the npm package:

- [`templates/order-to-xrechnung-zugferd-validate.json`](https://github.com/beliq-eu/n8n-nodes-beliq/blob/main/templates/order-to-xrechnung-zugferd-validate.json): a validate-led flow. A sample order is mapped to an EN 16931 invoice, and beliq generates an XRechnung and a hybrid ZUGFeRD. Validate checks the XRechnung, and the **Valid?** gate passes Validate's JSON result, not the document, on to a placeholder delivery step only when the API calls the document `valid`. The ZUGFeRD branch ends at its generate node, whose item carries its own `validationResult`.
- [`templates/generate-then-convert-to-ubl.json`](https://github.com/beliq-eu/n8n-nodes-beliq/blob/main/templates/generate-then-convert-to-ubl.json): generates an invoice and converts it to UBL, and shows the `lostElements` the API detected.
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

The dropdowns are copies of the API's enums, and no dropdown names a format's badge: the check depth comes with each result. `test/apiSurface.test.mts` compares them with `test/fixtures/api-surface.json`, so after `npm run surface:sync` a value the API added or dropped fails the tests until a dropdown offers it, or `NOT_OFFERED` in `nodes/Beliq/GenericFunctions.ts` gives the reason it is left out.

Tests are `*.test.mts`, not `.ts`. `"n8n": { "strict": true }` in `package.json` requires the default `eslint.config.mjs`, and that config lints every `.ts` file with the rules for code that runs inside n8n (no `node:fs`, no `process`). Tests do not ship, so they sit outside it.

## Publishing

Released to npm as [`n8n-nodes-beliq`](https://www.npmjs.com/package/n8n-nodes-beliq). Releases run from `.github/workflows/release.yml` via npm Trusted Publishing (OIDC, with provenance). Push a `v*.*.*` tag to publish a new version. No npm token is stored in the repo.

## License

[MIT](LICENSE)
