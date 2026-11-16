# Changelog

This file starts at 0.4.0. An earlier version has a heading here only for a
breaking change; the rest of its changes are in the git history between the
version tags (https://github.com/beliq-eu/n8n-nodes-beliq/tags). 0.1.0 is on
npm without a tag. Dates are the npm publish date, in UTC.

## 0.4.1 - 2026-11-16

- The README says that beliq covers three steps of an e-invoice: generate,
  validate, and deliver (in development). The node runs the first two, parses
  and converts, and never sends or files an invoice. Until delivery through
  beliq is available, transmission (Peppol, plateforme agréée, SDI) and
  tax-authority reporting stay with your access point. Archiving stays with
  you, and beliq does not operate KSeF submission. The sticky notes of the two
  workflow templates say the same.
- The README says what each `lostElements` entry of Convert Invoice holds
  (`path`, `value`, `reason`, `severity`, `acceptableLoss`), and that the list
  is one `{ truncated: true }` entry when it would pass the API's 6 KB header
  cap, with `lostElementsCount` still the exact count. Convert already
  returned the entries this way; tests now cover both shapes.
- Built with `n8n-workflow` 3 and `@n8n/node-cli` 0.56. The node's source and
  its `n8n-workflow` peer range (`*`) are unchanged.

## 0.4.0 - 2026-10-25

- Generate Invoice returns the validation result. The item JSON carries
  `validationResult` beside the document's other details (`invoiceId`,
  `format`, `standard`, `profile`, `outputFormat`, `contentType`, `sha256`, and
  `pdfKind` for a PDF). The document is still binary data in the output field.
- The check depth of a result is in `validationResult.verificationBadgeLabel`,
  as the API sends it. A result without that field states no depth. The
  Standard and Format dropdowns no longer show a badge text.
- With Validate Result off, no rule set runs: `validationResult.verified` is
  `false`, and `valid: false` then means nothing was checked. Read `verified`
  before `valid`.
- When the API sends a verdict but no document, Generate passes the verdict on
  as item JSON with no binary data, and the item does not fail.

## 0.2.0 - 2026-07-24

- Breaking: the `Base URL` field of the beliq API credential is removed. The
  node always calls https://api.beliq.eu, so a credential that named another
  URL now reaches that one.
