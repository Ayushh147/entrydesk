# Entrydesk

A TypeScript shipment-document workspace: upload PDFs, extract facts locally, reconcile invoice/packing/BOL discrepancies, complete broker details, and export a NetCHB entry XML draft. React + Vite frontend; Express backend; PDF.js + Tesseract local extraction; Zod validation; actual vendor XSD validation through `xmllint`.

## Run

Requires **Node.js 22.16+** and `xmllint` (libxml2). No API key, Python, Poppler, or separate Tesseract installation is needed to run the app. English OCR data ships as an npm dependency.

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. Backend: http://127.0.0.1:3001. Select **Load sample** or upload your own invoice, packing list and BOL. Scans take longer than text PDFs. Ports can change if already occupied; use the URL printed by Vite.

`xmllint` is preinstalled on many macOS systems. Otherwise:

```sh
# macOS
brew install libxml2
export PATH="$(brew --prefix libxml2)/bin:$PATH"
# Debian/Ubuntu
sudo apt-get install libxml2-utils
```

Without `xmllint`, extraction and draft export work, but the app explicitly reports validation unavailable and never marks an entry ready.

Production, locally:

```sh
npm run build
npm start
```

Open http://127.0.0.1:3001. The server intentionally binds to loopback: this is a local prototype, not an authenticated public service.

## Workflow

1. Upload up to eight PDFs, 10 MB each / 30 MB combined / 30 pages per PDF. Duplicate content is deduplicated by SHA-256.
2. Review shipment overview, line values and valuation bridge. Printed values are preserved even when incorrect. Conflicts, missing information and verification checks have separate counts and views. Related invoice pricing/subtotal checks share one resolution when their differences match.
3. In **Evidence**, inspect OCR/text with page markers and recovered table cells. Use the normalized JSON editor for document-type corrections and layouts the parser cannot read. The review response also retains the original extraction.
4. In **Review & complete**, enter confirmed values, operational entry details, manufacturer IDs, full US HTS classifications and reporting quantities. Record resolutions for documentary/operational review issues. Notes do not substitute for required header fields or ten-digit HTS.
5. **Apply review & regenerate XML**. Download draft XML at any time; a completed draft must pass XSD validation and all review checks. Editing disables download until the XML is regenerated.

The review session lasts 30 minutes and lives in backend memory. PDFs are processed in memory; OCR language cache is local. Nothing is uploaded to NetCHB or CBP. This app does not claim that schema validity establishes customs acceptance.

## NetCHB contract research

The integration uses the vendor's documented entry schema rather than a fabricated XML format. Vendor sources downloaded on **2026-10-09**:

- [EntryUploadService WSDL](https://www.netchb.com/main/services/entry/EntryUploadService?wsdl)
- [Entry XSD](https://www.netchb.com/xml/entry/entry.xsd)
- [Shared data types](https://www.netchb.com/xml/data/data_type.xsd)
- [Vendor entry example](https://www.netchb.com/xml/entry/entry_sample.xml)
- [Upload response documentation](https://www.netchb.com/xml/entry/entryUploadResponse.html)

Snapshots are in `docs/netchb/`. See [mapping notes](docs/netchb/MAPPING.md). The service is SOAP 1.1 RPC/literal, with `uploadEntry(username, password, entryXml)`. Its business XML root is `entry` in `http://www.netchb.com/xml/entry`. Root children follow a strict sequence; many inner groups use `xsd:all`. The app exports the **business XML payload**, not a SOAP request with credentials.

The exported root includes system-generated entry numbering, header, manifest and invoices/line-items/tariffs. No `transmit`, `transmit-3461`, or `precalculated` directive is added. A vendor `<accepted>` response means uploaded into NetCHB; it does not mean accepted by CBP.

## Document-backed suggestions

The app fills export country from the loading-port country code, destination state from the ship-to address, containerized-ocean transportation mode from positive vessel/container evidence, and the unlading-port code from an exact match in the official [Schedule D directory](https://www.census.gov/foreign-trade/schedules/d/distname.html). The offline directory snapshot is in `docs/reference/ports.json`; transportation code 11 is verified against [CBP Appendix B](https://www.cbp.gov/sites/default/files/2024-11/ACE%20CATAIR%20Appendix%20B_15Oct2024_508_0.pdf). Each suggestion shows its basis and remains editable. Processing/entry ports, tax IDs, bond/payment settings and classifications remain broker decisions. Ambiguous ports and unsupported evidence stay unfilled.

For the sample, the review screen shows **4 conflict groups, 26 missing details and 7 verification checks**. The conflict groups retain five underlying discrepancy checks; the two $360 pricing/subtotal checks share one resolution. General OCR checks are advisory, while valuation/origin/compliance confirmations remain required. These counts are calculated from actual checks, not fixed UI numbers.

## Assignment shipment

```sh
npm run sample
```

This reads the three actual root-level PDFs using the same extraction and reconciliation functions as uploaded documents. Generates:

- [Sample entry XML draft](output/sample-entry-draft.xml)
- [Extraction, issues, valuation and schema results](output/sample-review.json)
- [One-page approach writeup](output/approach.pdf)
- [AI chat history](output/ai-chat-history.md), plus machine-readable `output/ai-chat-history.json`

The sample output is intentionally a **draft**, not an accepted/fileable entry. Relevant discrepancies include:

| Topic | Source facts / handling |
| --- | --- |
| T-shirt arithmetic | 2,400 × $2.85 = $6,840, printed amount $6,480; no silent correction. |
| Invoice subtotal | Printed goods subtotal $23,235; commercial line amounts sum to $22,875. |
| Hoodie quantity | Invoice 1,200; packing list 1,176. |
| Hoodie material | Invoice 60/40 cotton/polyester; packing list TC 65/35. Factory confirmation required. |
| Weight | BOL 1,930 kg gross; packing list 1,888 kg. |
| Assist | $4,180 buyer-supplied fabric excluded from blouse CMT invoice amount; allocated provisionally to that SKU. |
| Free samples | 24 pieces, $24 customs-only value, Bangladesh origin; preserved separately. |
| Container edit | Printed identifier is struck through and handwritten. OCR is unreliable; verify original before using. Container is not exported automatically. |
| Parties | Hong Kong seller, Vietnam factory, US buyer and fulfillment consignee are distinct. Tax IDs/MIDs require confirmation. |

Provisional bridge based on **printed line amounts**: $22,875 + $4,180 assist + $24 samples = **$27,079**. Using the printed subtotal would instead give $27,439; neither settles the disputed values. Actual freight/insurance exclusion evidence, assist allocation and sample valuation need broker review. Invoice ETA is displayed but never automatically used as actual arrival date. The numeric invoice date is interpreted day-first; verify it.

The local OCR now recovers all five sample packing rows, including quantities and net/gross weights, by detecting ruled tables and reading cells separately. It preserves the detected cell text and OCR scores in the evidence view. Handwritten identifiers and some description text remain unreliable and require verification. See the original PDFs and raw evidence. This prototype does **not** promise arbitrary-layout automatic extraction. Local label/table parsing supports similar English layouts; unfamiliar layouts can require normalized-data edits. Only one invoice per shipment is supported. A mixed shipment/multi-invoice upload stays blocked. Other languages, comprehensive arbitrary-layout table recovery, automatic HTS classification, tariff stacking, currency conversion and PGA determination are not implemented.

Valuation references: [CBP invoice value guidance](https://www.help.cbp.gov/s/article/Article-1162?language=en_US), [CBP CIF guidance](https://www.help.cbp.gov/s/article/Article1126), and [assist apportionment ruling](https://rulings.cbp.gov/ruling/548540). These guide the checklist; no tariff rate or legal outcome is assumed.

## Optional AI extraction

The app defaults to local extraction. If available, configure a server-side key:

```sh
cp .env.example .env
# Edit OPENAI_API_KEY locally; never commit it.
```

Restart, choose **OpenAI vision**, and upload PDFs. Uses the [Responses PDF-input API](https://developers.openai.com/api/docs/guides/file-inputs) and structured output validated with Zod. PDF contents are sent to OpenAI in this mode; the UI states this. Provider response storage is disabled with `store: false`. The key is never exposed to the browser. **This path is implemented but was not live-tested because no key was available.** Extraction still requires review; AI cannot override the contract or broker checks.

## Checks and development

```sh
npm test
npm run build
npm audit --omit=dev
# With npm run dev running:
npm run integration
```

Unit/regression tests cover an unseen invoice, actual two-page invoice, arithmetic/subtotal/material/quantity conflicts, assist/sample value handling, per-line origins, XML escaping, ETA handling and valid/invalid entries against the actual vendor XSD. Integration generates both a different text-PDF shipment and an unseen scanned packing table, verifies all five real sample rows, and tests multipart upload, completion, schema-valid export, invalid PDF rejection and negative amount rejection. It also checks all central assignment discrepancies through real PDF extraction.

Native browser preview was unavailable due to computer-use permissions. Type checking, production build and HTTP integration passed; browser visual testing remains outstanding. No live NetCHB upload or AI API test was performed.

Layout:

```text
src/                 React interface and styling
server/pdf.ts        local PDF text/rendering/OCR
server/parser.ts     general label and cell-table parsing
server/table-ocr.ts  geometry-based ruled-table detection and cell OCR
server/suggestions.ts  evidence-backed operational field suggestions
server/extract.ts    local extraction / optional structured vision extraction
server/reconcile.ts  source disagreements, checks and review state
server/xml.ts        documented NetCHB mapping / escaped XML serialization
server/validate.ts   offline vendor XSD validation
shared/model.ts      TypeScript types and Zod contracts
shared/review.ts     review categories and conflict grouping
tests/               reconciliation/extraction/schema regression tests
scripts/             sample, integration, chat export and writeup tooling
docs/netchb/         vendor contract snapshots
output/              submission artifacts
```

## AI history and submission

[output/ai-chat-history.md](output/ai-chat-history.md) is a reviewer-focused selection of actual prompts and responses. It is explicitly labeled **selected excerpts, not complete history**. It retains relevant constraints, research, corrections, testing limits and user-driven improvements, while omitting routine tool logs and packaging discussion.

The assignment requests complete AI chat history. A selected transcript does not fulfill that requirement by itself. The full user-visible history has been retained locally outside this clean submission folder and can be provided separately. The `export-chat` utility writes a separate `ai-chat-history-full` archive without replacing the selected transcript.

No GitHub URL or deployed link is claimed yet. See `GITHUB_PUSH.md` in the submission folder for publishing commands. Remaining filing information is listed in the review report; unknown broker IDs and customs determinations are not invented.
