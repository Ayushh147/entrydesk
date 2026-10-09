# Verified entry mapping

Source snapshots fetched from NetCHB on 2026-10-09. Original XSDs are retained unchanged. Validation creates a temporary schema copy whose sole change is replacing the remote shared-types import with the local snapshot; `xmllint --nonet` prevents network fetches.

SOAP endpoint: `https://www.netchb.com:443/main/services/entry/EntryUploadService`. WSDL operation `uploadEntry` takes three strings: `username`, `password`, `entryXml`. Binding: SOAP 1.1 RPC/literal; empty SOAPAction. No live request has been sent.

| Extracted/reviewed value | Business XML path | Decision |
| --- | --- | --- |
| Entry numbering | `entry/entry-no/system-generated` | Let NetCHB allocate; never invent a filer number. |
| Original invoice reference | `entry/external-reference-number` | Preserve original punctuation. |
| Importer ID | `header/importer-tax-id` | Broker-supplied account trade partner. |
| Consignee ID | `header/ultimate-consignee/tax-id` | Confirm ultimate consignee; warehouse is not automatically importer. |
| Entry ports/date/type | `header/processing-port`, `entry-port`, `entry-date`, `entry-type` | Required by XSD; missing values stay omitted and invalid in draft. |
| Charges | `header/charges` | International freight + insurance, rounded to whole units to satisfy `xsd:long`; confirm evidence. |
| Gross weight | `header/gross-weight` | BOL/packing conflicts block completion; integer kg mapping. |
| Vessel/carrier/voyage | `header/vessel-name`, `carrier-code`, `voyage-no` | Preserve extracted facts; distinguish carrier SCAC and NVOCC SCAC. |
| Arrival date | `header/arrival-date` | Explicit confirmed actual date only, never source ETA automatically. |
| BOL/packaging | `manifest/bill-of-lading` | Master/house SCAC and bill are distinct. Quantity is packages, not pieces; unit defaults to CTN and is reviewable in overrides. Bill prefixes are preserved; broker must verify carrier-specific identifier format. |
| Invoice number | `invoices/invoice/invoice-no` | `/` becomes `-`; XSD allows only letters/digits/hyphens, maximum 17 characters. Original retained above. Longer/other punctuation fails validation until `invoiceNumberXml` override is supplied. |
| Per-line origin | `line-item/country-origin` | Sample BD origin survives blanket VN declaration. |
| Factory MID | `line-item/manufacturer-id` | No MID inference from seller address. |
| Export date/country | `line-item/export-date`, `country-export` | Shipping date from evidence; export country can be suggested from the loading-port country code, separately from origin. |
| Description/SKU | `line-item/commercial-description`, `part-number` | No invented `line-no` or `tariff-description` tags. |
| Invoice pieces | `line-item/invoice-quantity` | Preserve printed quantity until corrected. |
| Classification | `line-item/tariffs/tariff/tariff-no` | Strip dots. XSD accepts 5-10 digits; app requires reviewed ten digits for completion. Source six-digit HS remains visibly a draft. |
| Entered line value | `tariff/value` | USD stated line amount plus allocated assist. Samples retain positive customs-only amount. Non-USD value omitted pending explicit conversion. |
| Statistical quantities | `tariff/quantity1..3`, `unit-of-measure1..3` | Broker-supplied per classified HTS. Dozens/kg not inferred from pieces. |

Root order is `entry-no`, optional directives/references, `header`, `manifest`, optional containers/etc., `invoices`. Nested `xsd:all` groups permit any internal order. Required operational/business checks can be stricter than the XSD. Example: `importer-tax-id` is schema optional but its annotation requires it for non-Type-86 entries. This prototype focuses on a formal containerized-ocean workflow and deliberately requires its reviewed operational details.

No `transmit`, `transmit-3461`, `precalculated`, automatic-remedy or cargo-certification flags are exported. A broker can review the draft in NetCHB; there is no submission path in this app. Missing unknowns are not replaced with dummy values merely to make validation pass.

Document-backed suggestions for this fixture are export country VN, destination state WA, containerized-ocean mode 11, and Tacoma unlading code 3002. Sources are recorded on each suggestion. Broker processing/entry ports are never assumed equal to the discharge port. The port directory snapshot is from the US Census Schedule D listing; mode 11 is verified in CBP CATAIR Appendix B.
