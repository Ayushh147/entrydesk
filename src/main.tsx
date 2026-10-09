import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Data, Overrides, Result } from "../shared/model";
import { conflictGroups, issueCategory } from "../shared/review";
import "./styles.css";
type Response = Result & { jobId: string };
type Tab = "overview" | "review" | "evidence" | "xml";
const label = (s: string) =>
  s.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
const fmt = (n: number | null, currency?: string | null) => {
  if (n === null) return "—";
  try {
    return currency
      ? new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
          n,
        )
      : n.toLocaleString("en-US");
  } catch {
    return `${currency ?? ""} ${n.toFixed(2)}`;
  }
};
function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function App() {
  const [files, setFiles] = useState<File[]>([]),
    [result, setResult] = useState<Response | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [tab, setTab] = useState<Tab>("overview"),
    [overrides, setOverrides] = useState<Overrides>({}),
    [dirty, setDirty] = useState(false),
    [editor, setEditor] = useState(""),
    [source, setSource] = useState(0),
    [ai, setAi] = useState(false),
    [mode, setMode] = useState("local");
  const fileInput = useRef<HTMLInputElement>(null);
  const [isSample, setIsSample] = useState(false);
  const sourceUrls = React.useMemo(
    () => new Map(files.map((f) => [f.name, URL.createObjectURL(f)])),
    [files],
  );
  React.useEffect(
    () => () => {
      sourceUrls.forEach((url) => URL.revokeObjectURL(url));
    },
    [sourceUrls],
  );
  React.useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => setAi(d.aiConfigured))
      .catch(() => setError("Cannot reach the backend. Run npm run dev."));
  }, []);
  const set = (key: string, value: string) => {
    setOverrides((o) => ({ ...o, [key]: value }));
    setDirty(true);
  };
  async function request(endpoint: string, body?: BodyInit) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(endpoint, { method: "POST", body });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Request failed");
      setResult(data);
      setIsSample(endpoint === "/api/sample");
      setSource(0);
      setOverrides(data.overrides);
      setEditor(
        JSON.stringify(
          data.documents.map((d: Response["documents"][number]) => ({
            id: d.id,
            kind: d.kind,
            data: d.data,
          })),
          null,
          2,
        ),
      );
      setDirty(false);
      setTab("overview");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function upload() {
    const f = new FormData();
    files.forEach((file) => f.append("documents", file));
    f.append("mode", mode);
    await request("/api/shipments", f);
  }
  async function review() {
    if (!result) return;
    setBusy(true);
    setError("");
    try {
      const corrections = JSON.parse(editor);
      const r = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: result.jobId, overrides, corrections }),
      });
      const d = await r.json();
      if (!r.ok)
        throw new Error(
          d.error + (d.details ? " " + JSON.stringify(d.details) : ""),
        );
      setResult(d);
      setDirty(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const blockers = result?.issues.filter((i) => i.severity === "blocker") ?? [];
  const conflicts = conflictGroups(result?.issues ?? []);
  const missing = (result?.issues ?? []).filter(
    (i) => issueCategory(i) === "missing",
  );
  const checks = (result?.issues ?? []).filter(
    (i) => issueCategory(i) === "review",
  );
  const [reviewSection, setReviewSection] = useState<
    "conflict" | "missing" | "review"
  >("conflict");
  const field = (key: string, title?: string, value?: string | null) => (
    <label className="field" key={key}>
      <span>{title ?? label(key)}</span>
      <input
        value={overrides[key] ?? value ?? ""}
        placeholder="Needs confirmation"
        onChange={(e) => set(key, e.target.value)}
      />
      {result?.suggestions?.find(
        (s) => s.key === key && s.value === overrides[key],
      ) && (
        <small
          className="field-source"
          title={result.suggestions.find((s) => s.key === key)!.explanation}
        >
          ✓ From documents
        </small>
      )}
    </label>
  );
  function addFiles(incoming: File[]) {
    if (incoming.some((f) => !f.name.toLowerCase().endsWith(".pdf"))) {
      setError("Choose PDF files.");
      return;
    }
    setFiles((f) =>
      [...f, ...incoming].filter(
        (file, i, a) =>
          a.findIndex((x) => x.name === file.name && x.size === file.size) ===
          i,
      ),
    );
    setError("");
  }
  return (
    <>
      <header className="topbar">
        <a className="brand" href="/">
          <span className="brand-icon">▦</span>entrydesk
          <span className="brand-divider" /> <small>Shipment workspace</small>
        </a>
        <span className="environment">
          <i />
          Local workspace
        </span>
      </header>
      <div className="app-layout">
        <aside>
          <div className="sidebar-label">WORKSPACE</div>
          <div className="sidebar-active">
            <span>▧</span> Shipment entry <span className="tiny">01</span>
          </div>
          <div className="sidebar-label stages-label">WORKFLOW</div>
          {[
            "Upload documents",
            "Extract shipment data",
            "Review & complete",
            "Export entry XML",
          ].map((s, i) => (
            <div className={"stage " + (result && i < 2 ? "done" : "")} key={s}>
              <span>
                {result && i < 2 ? "✓" : String(i + 1).padStart(2, "0")}
              </span>
              {s}
            </div>
          ))}
          <div className="sidebar-bottom">
            <div className="mini-logo">N</div>
            <strong>NetCHB format</strong>
            <p>Built against the vendor’s entry XML schema.</p>
            <a
              href="https://www.netchb.com/xml/entry/entry.xsd"
              target="_blank"
              rel="noreferrer"
            >
              View source schema ↗
            </a>
          </div>
        </aside>
        <main>
          <div className="breadcrumb">
            Workspace <span>/</span> Shipments <span>/</span>{" "}
            {result
              ? (result.shipment.invoiceNumber ?? "Untitled shipment")
              : "New shipment"}
          </div>
          <div className="page-heading">
            <div>
              <div className="eyebrow">DOCUMENTS → ENTRY</div>
              <h1>
                {result ? "Review your shipment" : "A clearer path to customs."}
              </h1>
              <p>
                {result
                  ? "Every field has a source. Every open question has a next step."
                  : "Upload your shipment documents. Get a structured entry and a clear review checklist."}
              </p>
            </div>
            {result && (
              <button
                className="secondary"
                onClick={() => {
                  setResult(null);
                  setFiles([]);
                  setOverrides({});
                  setDirty(false);
                }}
              >
                + New shipment
              </button>
            )}
          </div>
          {error && (
            <div role="alert" className="error">
              {error}
            </div>
          )}
          {busy && (
            <div className="processing" role="status">
              <span className="spinner" />
              {result
                ? "Validating your review against NetCHB’s schema…"
                : "Reading PDF pages and running local OCR. Scanned documents can take a minute…"}
            </div>
          )}
          {!result ? (
            <>
              <section className="upload-card">
                <div className="section-head">
                  <div>
                    <h2>Shipment documents</h2>
                    <p>Commercial invoice, packing list, and bill of lading</p>
                  </div>
                  <span className="pill neutral">PDF · up to 8 files</span>
                </div>
                <div
                  className="dropzone"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    addFiles(Array.from(e.dataTransfer.files));
                  }}
                >
                  <div className="upload-icon">↑</div>
                  <h3>Drop your documents here</h3>
                  <p>or choose files from your computer</p>
                  <button
                    className="secondary"
                    onClick={() => fileInput.current?.click()}
                    disabled={busy}
                  >
                    Browse files
                  </button>
                  <small>
                    10 MB per file · 30 MB per shipment · 30 pages per PDF
                  </small>
                  <input
                    ref={fileInput}
                    type="file"
                    accept="application/pdf,.pdf"
                    multiple
                    hidden
                    onChange={(e) => addFiles(Array.from(e.target.files ?? []))}
                  />
                </div>
                {files.length > 0 && (
                  <div className="file-list">
                    {files.map((f, i) => (
                      <div key={f.name}>
                        <span className="pdf-icon">PDF</span>
                        <span>
                          {f.name}
                          <small>{(f.size / 1024).toFixed(0)} KB</small>
                        </span>
                        <button
                          aria-label={"Remove " + f.name}
                          onClick={() =>
                            setFiles((a) => a.filter((_, n) => n !== i))
                          }
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="upload-footer">
                  <div>
                    <strong>
                      {mode === "local"
                        ? "Local extraction"
                        : "AI-assisted extraction"}
                    </strong>
                    <small>
                      {mode === "local"
                        ? "No API key needed. Documents stay on this machine."
                        : "PDFs are sent to OpenAI using your server’s API key."}
                    </small>
                    {ai && (
                      <select
                        aria-label="Extraction mode"
                        value={mode}
                        onChange={(e) => setMode(e.target.value)}
                      >
                        <option value="local">Local OCR</option>
                        <option value="ai">OpenAI vision</option>
                      </select>
                    )}
                  </div>
                  <button
                    className="primary"
                    disabled={!files.length || busy}
                    onClick={upload}
                  >
                    Create entry draft <span>→</span>
                  </button>
                </div>
              </section>
              <div className="below-upload">
                <div className="sample-card">
                  <div className="sample-icon">▤</div>
                  <div>
                    <strong>Start with the assignment shipment</strong>
                    <p>Apparel · Vietnam & Bangladesh · 3 documents</p>
                  </div>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => request("/api/sample")}
                  >
                    Load sample →
                  </button>
                </div>
                <div className="hint">
                  <span>◈</span>
                  <p>
                    Missing information stays visible. Conflicting quantities,
                    valuation adjustments, and incomplete classifications go
                    into your review checklist.
                  </p>
                </div>
              </div>
            </>
          ) : (
            <>
              <div
                className={"status-banner " + (result.ready ? "success" : "")}
              >
                <span className="status-icon">{result.ready ? "✓" : "!"}</span>
                <div>
                  <strong>
                    {dirty
                      ? "Changes need validation"
                      : result.ready
                        ? "Draft passes schema and review checks"
                        : conflicts.length
                          ? `${conflicts.length} document conflicts to resolve`
                          : missing.length
                            ? `${missing.length} details need completion`
                            : blockers.length
                              ? "Broker verification is still needed"
                              : "Schema validation needs attention"}
                  </strong>
                  <p>
                    {dirty
                      ? "Apply your changes to regenerate the XML and refresh the checklist."
                      : `${missing.length} missing details · ${checks.length} verification checks. Draft uses NetCHB’s entry structure.`}
                  </p>
                </div>
                <button className="secondary" onClick={() => setTab("review")}>
                  Review checklist →
                </button>
              </div>
              <div className="review-summary" aria-label="Review breakdown">
                <button
                  onClick={() => {
                    setReviewSection("conflict");
                    setTab("review");
                  }}
                >
                  <span className="summary-count conflict-count">
                    {conflicts.length}
                  </span>
                  <strong>Document conflicts</strong>
                  <small>Disagreements and incorrect totals</small>
                </button>
                <button
                  onClick={() => {
                    setReviewSection("missing");
                    setTab("review");
                  }}
                >
                  <span className="summary-count missing-count">
                    {missing.length}
                  </span>
                  <strong>Missing information</strong>
                  <small>Broker setup and line classifications</small>
                </button>
                <button
                  onClick={() => {
                    setReviewSection("review");
                    setTab("review");
                  }}
                >
                  <span className="summary-count check-count">
                    {checks.length}
                  </span>
                  <strong>Verification checks</strong>
                  <small>Valuation, origin, and source checks</small>
                </button>
              </div>
              <div className="stats">
                <div>
                  <span>PROPOSED CUSTOMS VALUE</span>
                  <strong>
                    {fmt(result.valuation.proposed, result.shipment.currency)}
                  </strong>
                  <small>Provisional · includes assists & samples</small>
                </div>
                <div>
                  <span>INVOICE TOTAL</span>
                  <strong>
                    {fmt(
                      result.shipment.invoiceTotal,
                      result.shipment.currency,
                    )}
                  </strong>
                  <small>
                    {result.shipment.incoterms ?? "Terms not extracted"}
                  </small>
                </div>
                <div>
                  <span>INVOICE LINES</span>
                  <strong>
                    {result.shipment.lines.length.toString().padStart(2, "0")}
                  </strong>
                  <small>{fmt(result.shipment.quantity)} declared pieces</small>
                </div>
                <div>
                  <span>SHIPMENT DOCUMENTS</span>
                  <strong>
                    {result.documents.length.toString().padStart(2, "0")}
                  </strong>
                  <small>
                    {result.documents.filter((d) => d.method === "ocr").length}{" "}
                    processed with local OCR
                  </small>
                </div>
              </div>
              <div className="tabs" role="tablist">
                {(["overview", "review", "evidence", "xml"] as Tab[]).map(
                  (t) => (
                    <button
                      role="tab"
                      aria-selected={tab === t}
                      className={tab === t ? "active" : ""}
                      key={t}
                      onClick={() => setTab(t)}
                    >
                      {t === "xml"
                        ? "Entry XML"
                        : t === "review"
                          ? "Review & complete"
                          : label(t)}
                      {t === "review" && conflicts.length > 0 && (
                        <span>{conflicts.length} conflicts</span>
                      )}
                    </button>
                  ),
                )}
                <div className="tabs-spacer" />
                <span className="schema-status">
                  <i />
                  Vendor schema located
                </span>
              </div>
              {tab === "overview" && (
                <>
                  <div className="overview-grid">
                    <section className="panel">
                      <div className="section-head">
                        <h2>Shipment at a glance</h2>
                        <span className="pill neutral">Extracted</span>
                      </div>
                      <dl>
                        {(
                          [
                            "invoiceNumber",
                            "invoiceDate",
                            "seller",
                            "manufacturer",
                            "buyer",
                            "consignee",
                            "houseBill",
                            "masterBill",
                            "portOfLoading",
                            "portOfDischarge",
                            "vessel",
                            "departureDate",
                            "arrivalDate",
                            "packages",
                            "netWeight",
                            "grossWeight",
                            "container",
                          ] as (keyof Data)[]
                        ).map((k) => (
                          <div key={k}>
                            <dt>{label(k)}</dt>
                            <dd>
                              {String(result.shipment[k] ?? "Not extracted")}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </section>
                    <section className="panel valuation">
                      <div className="section-head">
                        <h2>Valuation bridge</h2>
                        <span className="pill amber">Provisional</span>
                      </div>
                      <p>
                        Based on stated line values. Open disputes can change
                        these amounts.
                      </p>
                      <div>
                        <span>Commercial goods</span>
                        <strong>
                          {fmt(
                            result.valuation.goods,
                            result.shipment.currency,
                          )}
                        </strong>
                      </div>
                      <div>
                        <span>Buyer-supplied assists</span>
                        <strong>
                          +{" "}
                          {fmt(
                            result.valuation.assists,
                            result.shipment.currency,
                          )}
                        </strong>
                      </div>
                      <div>
                        <span>Customs-only sample value</span>
                        <strong>
                          +{" "}
                          {fmt(
                            result.valuation.samples,
                            result.shipment.currency,
                          )}
                        </strong>
                      </div>
                      <div className="valuation-total">
                        <span>Proposed value</span>
                        <strong>
                          {fmt(
                            result.valuation.proposed,
                            result.shipment.currency,
                          )}
                        </strong>
                      </div>
                      <p className="valuation-note">
                        International freight ({fmt(result.shipment.freight)})
                        and insurance ({fmt(result.shipment.insurance)}) are
                        excluded. Verify actual cost evidence and assist
                        allocation.
                      </p>
                      <h3>Source documents</h3>
                      {result.documents.map((d, i) => (
                        <button
                          className="source-link"
                          key={d.id}
                          onClick={() => {
                            setSource(i);
                            setTab("evidence");
                          }}
                        >
                          <span className="pdf-icon">PDF</span>
                          <span>
                            {d.kind.replaceAll("_", " ")}
                            <small>
                              {d.pages} page{d.pages > 1 ? "s" : ""} ·{" "}
                              {d.method === "ocr" ? "Local OCR" : "PDF text"}
                            </small>
                          </span>
                          <span>↗</span>
                        </button>
                      ))}
                    </section>
                  </div>
                  <section className="panel lines-panel">
                    <div className="section-head">
                      <h2>Invoice line items</h2>
                      <span className="pill neutral">
                        Source values preserved
                      </span>
                    </div>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>STYLE / DESCRIPTION</th>
                            <th>ORIGIN</th>
                            <th>QTY</th>
                            <th>HS FROM DOCUMENT</th>
                            <th>LINE AMOUNT</th>
                            <th>ASSIST</th>
                          </tr>
                        </thead>
                        <tbody>
                          {result.shipment.lines.map((l) => (
                            <tr key={l.sku}>
                              <td>
                                <strong>{l.sku}</strong>
                                <span>{l.description}</span>
                                <small>{l.material}</small>
                                {l.sample && (
                                  <b className="pill amber">Free sample</b>
                                )}
                              </td>
                              <td>{l.origin ?? "—"}</td>
                              <td>
                                {fmt(l.quantity)}
                                <small>{l.unit}</small>
                              </td>
                              <td>
                                <code>{l.hsCode ?? "—"}</code>
                                <small>Verify full US HTS</small>
                              </td>
                              <td>{fmt(l.amount, result.shipment.currency)}</td>
                              <td>
                                {l.assist
                                  ? fmt(l.assist, result.shipment.currency)
                                  : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </>
              )}
              {tab === "review" && (
                <>
                  <nav
                    className="review-filters"
                    aria-label="Review categories"
                  >
                    {(
                      [
                        {
                          key: "conflict",
                          title: "Document conflicts",
                          count: conflicts.length,
                        },
                        {
                          key: "missing",
                          title: "Missing information",
                          count: missing.length,
                        },
                        {
                          key: "review",
                          title: "Verification checks",
                          count: checks.length,
                        },
                      ] as const
                    ).map((s) => (
                      <button
                        key={s.key}
                        className={reviewSection === s.key ? "selected" : ""}
                        onClick={() => setReviewSection(s.key)}
                      >
                        {s.title}
                        <span>{s.count}</span>
                      </button>
                    ))}
                  </nav>
                  {reviewSection === "conflict" && (
                    <section className="panel">
                      <div className="section-head">
                        <div>
                          <h2>Resolve document conflicts</h2>
                          <p>
                            Related checks share one resolution. Printed
                            evidence remains visible.
                          </p>
                        </div>
                      </div>
                      <div className="issues">
                        {conflicts.length === 0 && (
                          <p className="empty-state">
                            No unresolved document conflicts.
                          </p>
                        )}
                        {conflicts.map((group) => (
                          <article className="issue" key={group.id}>
                            <span className="issue-dot blocker">!</span>
                            <div>
                              <h3>{group.title}</h3>
                              {group.issues.map((i) => (
                                <p className="conflict-evidence" key={i.id}>
                                  {i.detail}
                                </p>
                              ))}
                              <div className="conflict-fields">
                                {group.id.startsWith("field-") &&
                                  field(
                                    group.id.slice(6),
                                    "Confirmed " + label(group.id.slice(6)),
                                    String(
                                      result.shipment[
                                        group.id.slice(6) as keyof Data
                                      ] ?? "",
                                    ),
                                  )}
                                {group.issues
                                  .filter((i) =>
                                    /^(math-|qty-|material-)/.test(i.id),
                                  )
                                  .map((i) => {
                                    const sku = i.id.replace(
                                      /^(math-|qty-|material-)/,
                                      "",
                                    );
                                    const l = result.shipment.lines.find(
                                      (l) => l.sku === sku,
                                    );
                                    if (!l) return null;
                                    return (
                                      <React.Fragment key={i.id}>
                                        {i.id.startsWith("material-") ? (
                                          field(
                                            `line.${sku}.material`,
                                            "Confirmed fabric",
                                            l.material,
                                          )
                                        ) : (
                                          <>
                                            {field(
                                              `line.${sku}.quantity`,
                                              `${sku} confirmed pieces`,
                                              String(l.quantity ?? ""),
                                            )}
                                            {field(
                                              `line.${sku}.unitPrice`,
                                              "Confirmed unit price",
                                              String(l.unitPrice ?? ""),
                                            )}
                                            {field(
                                              `line.${sku}.amount`,
                                              "Confirmed line amount",
                                              String(l.amount ?? ""),
                                            )}
                                          </>
                                        )}
                                      </React.Fragment>
                                    );
                                  })}
                                {group.id === "invoice-pricing" &&
                                  field(
                                    "goodsTotal",
                                    "Corrected goods subtotal",
                                    String(result.shipment.goodsTotal ?? ""),
                                  )}
                              </div>
                              <p className="action">
                                <strong>Next step:</strong>{" "}
                                {group.issues[0].action}
                              </p>
                              {group.issues[0].sources.length > 0 && (
                                <small className="source-names">
                                  {[
                                    ...new Set(
                                      group.issues.flatMap((i) => i.sources),
                                    ),
                                  ].join(" · ")}
                                </small>
                              )}
                              <label className="resolution">
                                <span>Resolution note</span>
                                <input
                                  value={
                                    overrides[`resolution.${group.id}`] ?? ""
                                  }
                                  onChange={(e) =>
                                    set(
                                      `resolution.${group.id}`,
                                      e.target.value,
                                    )
                                  }
                                  placeholder="What was confirmed, by whom, and what changed?"
                                />
                              </label>
                            </div>
                          </article>
                        ))}
                      </div>
                    </section>
                  )}
                  {reviewSection === "review" && (
                    <section className="panel">
                      <div className="section-head">
                        <div>
                          <h2>Verification checks</h2>
                          <p>
                            These are confirmation steps, not document
                            disagreements. General OCR checks are advisory.
                          </p>
                        </div>
                      </div>
                      <div className="issues">
                        {checks.map((i) => (
                          <article className="issue" key={i.id}>
                            <span className={"issue-dot " + i.severity}>
                              {i.severity === "warning" ? "i" : "✓"}
                            </span>
                            <div>
                              <h3>
                                {i.title}{" "}
                                {i.severity === "warning" && (
                                  <span className="pill neutral">Advisory</span>
                                )}
                              </h3>
                              <p>{i.detail}</p>
                              <p className="action">{i.action}</p>
                              <small className="source-names">
                                {i.sources.join(" · ")}
                              </small>
                              <label className="resolution">
                                <span>
                                  {i.severity === "warning"
                                    ? "Optional review note"
                                    : "Confirmation note"}
                                </span>
                                <input
                                  value={overrides[`resolution.${i.id}`] ?? ""}
                                  onChange={(e) =>
                                    set(`resolution.${i.id}`, e.target.value)
                                  }
                                  placeholder="Record what you verified and any corrections"
                                />
                              </label>
                            </div>
                          </article>
                        ))}
                      </div>
                    </section>
                  )}
                  {reviewSection === "missing" && (
                    <section className="panel">
                      <div className="section-head">
                        <div>
                          <h2>Information needed to complete this entry</h2>
                          <p>
                            {missing.length} details remain. Values absent from
                            the documents are kept separate from conflicts.
                          </p>
                        </div>
                      </div>
                      <div className="missing-groups">
                        <div>
                          <h3>Broker & entry setup</h3>
                          <p>
                            {missing
                              .filter((i) => i.id.startsWith("required-"))
                              .map((i) => i.title.replace(/ needed$/, ""))
                              .join(" · ") ||
                              "Required setup fields are complete."}
                          </p>
                        </div>
                        {result.shipment.lines.map((l) => {
                          const needed = missing.filter((i) =>
                            i.id.endsWith(l.sku),
                          );
                          return needed.length > 0 ? (
                            <div key={l.sku}>
                              <h3>
                                {l.sku}
                                <span className="pill neutral">
                                  {needed.length} requirements
                                </span>
                              </h3>
                              <p>
                                {needed
                                  .map((i) => i.title.replace(l.sku + ": ", ""))
                                  .join(" · ")}
                              </p>
                            </div>
                          ) : null;
                        })}
                      </div>
                    </section>
                  )}
                  {!!result.suggestions?.length && (
                    <section className="panel">
                      <div className="section-head">
                        <div>
                          <h2>Filled from document evidence</h2>
                          <p>
                            These {result.suggestions.length} fields are
                            editable and show their basis. Entry and processing
                            ports are still broker decisions.
                          </p>
                        </div>
                      </div>
                      <div className="suggestion-list">
                        {result.suggestions.map((s) => (
                          <div key={s.key}>
                            <strong>
                              {label(s.key)} <code>{s.value}</code>
                            </strong>
                            <p>{s.explanation}</p>
                            <small>
                              {s.sources.join(" · ")}{" "}
                              {s.reference && (
                                <a
                                  href={s.reference}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Official reference ↗
                                </a>
                              )}
                            </small>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}
                  {reviewSection === "missing" && (
                    <>
                      <section className="panel">
                        <div className="section-head">
                          <h2>Broker & entry details</h2>
                          <span className="pill amber">
                            Confirm with broker
                          </span>
                        </div>
                        <div className="fields-grid">
                          {[
                            "importerTaxId",
                            "consigneeTaxId",
                            "processingPort",
                            "entryPort",
                            "entryDate",
                            "entryType",
                            "bondType",
                            "bondProducerAccountNo",
                            "bondAmount",
                            "suretyCode",
                            "paymentType",
                            "statementDate",
                            "modeTransportation",
                            "unladingPort",
                            "locationOfGoods",
                            "stateDestination",
                            "countryOfExport",
                            "relatedParty",
                            "invoiceNumberXml",
                            "manifestUnit",
                            "masterScac",
                            "houseScac",
                            "confirmedArrivalDate",
                          ].map((k) => field(k))}
                        </div>
                        <p className="muted">
                          Dates: YYYY-MM-DD · Ports: CBP four-digit codes · Use
                          actual trade-partner tax IDs and broker operational
                          settings.
                        </p>
                      </section>
                      <section className="panel">
                        <div className="section-head">
                          <h2>Confirm extracted header fields</h2>
                        </div>
                        <div className="fields-grid">
                          {(
                            [
                              "currency",
                              "invoiceNumber",
                              "buyer",
                              "consignee",
                              "seller",
                              "manufacturer",
                              "houseBill",
                              "masterBill",
                              "carrierScac",
                              "container",
                              "grossWeight",
                              "netWeight",
                              "packages",
                              "departureDate",
                            ] as const
                          ).map((k) =>
                            field(
                              k,
                              label(k),
                              result.shipment[k] === null
                                ? null
                                : String(result.shipment[k]),
                            ),
                          )}
                        </div>
                      </section>
                      {result.shipment.lines.map((l) => (
                        <section className="panel line-review" key={l.sku}>
                          <div className="section-head">
                            <div>
                              <h2>{l.sku}</h2>
                              <p>{l.description}</p>
                            </div>
                            <span className="pill neutral">
                              Line-specific data
                            </span>
                          </div>
                          <div className="fields-grid">
                            {field(
                              `line.${l.sku}.quantity`,
                              "Confirmed pieces",
                              l.quantity === null ? null : String(l.quantity),
                            )}
                            {field(
                              `line.${l.sku}.amount`,
                              "Confirmed goods amount",
                              l.amount === null ? null : String(l.amount),
                            )}
                            {field(
                              `line.${l.sku}.assist`,
                              "Allocated assist",
                              String(l.assist ?? 0),
                            )}
                            {field(
                              `line.${l.sku}.origin`,
                              "Country of origin",
                              l.origin,
                            )}
                            {field(
                              `line.${l.sku}.material`,
                              "Confirmed material",
                              l.material,
                            )}
                            {field(`line.${l.sku}.hts`, "Full 10-digit US HTS")}
                            {field(
                              `line.${l.sku}.manufacturerId`,
                              "CBP manufacturer ID",
                            )}
                            {[1, 2, 3].map((n) => (
                              <React.Fragment key={n}>
                                {field(
                                  `line.${l.sku}.quantity${n}`,
                                  `HTS reporting quantity ${n}`,
                                )}
                                {field(
                                  `line.${l.sku}.unit${n}`,
                                  `HTS reporting unit ${n}`,
                                )}
                              </React.Fragment>
                            ))}
                          </div>
                          <p className="muted">
                            Reporting units depend on the classified HTS; pieces
                            may need conversion to dozens and net kg. No
                            conversion or duty rate is assumed.
                          </p>
                        </section>
                      ))}
                    </>
                  )}
                  <section className="panel">
                    <h2>Recorded review decisions</h2>
                    {Object.entries(overrides)
                      .filter(([k, v]) => k.startsWith("resolution.") && v)
                      .map(([k, v]) => (
                        <label className="resolution" key={k}>
                          <span>{k.slice(11)}</span>
                          <input
                            value={v}
                            onChange={(e) => set(k, e.target.value)}
                          />
                        </label>
                      ))}
                    <p className="muted">
                      Clearing a recorded note reopens that review issue.
                    </p>
                  </section>
                </>
              )}
              {tab === "evidence" && (
                <>
                  <section className="panel">
                    <div className="section-head">
                      <div>
                        <h2>Document evidence</h2>
                        <p>
                          Original extraction is retained. Review the PDFs
                          alongside this text.
                        </p>
                      </div>
                      <select
                        aria-label="Source document"
                        value={source}
                        onChange={(e) => setSource(Number(e.target.value))}
                      >
                        {result.documents.map((d, i) => (
                          <option key={d.id} value={i}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <details className="original-pdf">
                      <summary>Preview original PDF</summary>
                      <iframe
                        title="Original shipment document"
                        src={
                          isSample
                            ? `/api/sample-files/${encodeURIComponent(result.documents[source]?.name ?? "")}`
                            : sourceUrls.get(
                                result.documents[source]?.name ?? "",
                              )
                        }
                      />
                    </details>
                    <small className="hash">
                      SHA-256: {result.documents[source]?.sha256}
                    </small>
                    {(result.documents[source]?.tables ?? []).map(
                      (table, index) => (
                        <details className="table-evidence" key={index}>
                          <summary>
                            Recovered table · page {table.page} ·{" "}
                            {table.cells.length} detected rows
                          </summary>
                          <div className="table-scroll">
                            <table>
                              <tbody>
                                {table.cells.map((row, r) => (
                                  <tr key={r}>
                                    {row.map((cell, c) => (
                                      <td
                                        key={c}
                                        title={`OCR engine score: ${Math.round(table.confidence[r]?.[c] ?? 0)} / 100. Verify against the PDF.`}
                                      >
                                        {cell || "—"}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </details>
                      ),
                    )}
                    <pre className="evidence-text">
                      {result.documents[source]?.rawText}
                    </pre>
                  </section>
                  <section className="panel">
                    <div className="section-head">
                      <div>
                        <h2>Correct normalized extraction</h2>
                        <p>
                          For unfamiliar layouts, edit document type or data
                          here. Use null for unknown values; retain printed
                          discrepancies.
                        </p>
                      </div>
                    </div>
                    <textarea
                      className="json-editor"
                      aria-label="Normalized extraction JSON"
                      value={editor}
                      onChange={(e) => {
                        setEditor(e.target.value);
                        setDirty(true);
                      }}
                    />
                    <p className="muted">
                      All changes are schema-validated. Original extraction is
                      included in the review JSON export.
                    </p>
                  </section>
                </>
              )}
              {tab === "xml" && (
                <section className="panel xml-panel">
                  <div className="section-head">
                    <div>
                      <h2>NetCHB entry XML</h2>
                      <p>
                        {result.validation?.valid
                          ? "Passes the downloaded vendor XSD."
                          : "Draft: required header fields and reviewed classifications may still be missing."}
                      </p>
                    </div>
                    <span
                      className={
                        "pill " + (result.validation?.valid ? "green" : "amber")
                      }
                    >
                      {result.validation?.valid
                        ? "XSD valid"
                        : "Needs completion"}
                    </span>
                  </div>
                  {result.validation?.errors?.length ? (
                    <details className="validation-errors">
                      <summary>
                        Schema validation details (
                        {result.validation.errors.length})
                      </summary>
                      <pre>{result.validation.errors.join("\n")}</pre>
                    </details>
                  ) : null}
                  <pre className="xml-code">{result.xml}</pre>
                  <div className="xml-actions">
                    <button
                      className="secondary"
                      onClick={() =>
                        navigator.clipboard
                          .writeText(result.xml)
                          .catch(() =>
                            setError(
                              "Clipboard unavailable. Download the XML instead.",
                            ),
                          )
                      }
                    >
                      Copy XML
                    </button>
                    <button
                      className="primary"
                      disabled={dirty}
                      onClick={() =>
                        download(
                          result.ready ? "entry.xml" : "entry-draft.xml",
                          result.xml,
                          "application/xml",
                        )
                      }
                    >
                      {result.ready
                        ? "Download entry XML"
                        : "Download draft XML"}{" "}
                      ↓
                    </button>
                    <button
                      className="secondary"
                      disabled={dirty}
                      onClick={() =>
                        download(
                          "shipment-review.json",
                          JSON.stringify(result, null, 2),
                          "application/json",
                        )
                      }
                    >
                      Download review JSON
                    </button>
                  </div>
                  <p className="muted">
                    Draft export includes unresolved data; it must be completed
                    before upload. NetCHB acceptance and CBP acceptance are
                    separate checks. No transmission is requested.
                  </p>
                </section>
              )}
              <div className={"review-bar" + (dirty ? " sticky-review" : "")}>
                <div>
                  <strong>
                    {dirty ? "Unsaved review changes" : "Review workspace"}
                  </strong>
                  <small>
                    {dirty
                      ? "The displayed XML reflects the last validated version."
                      : "Fill missing information, resolve conflicts, then regenerate."}
                  </small>
                </div>
                <button className="primary" onClick={review} disabled={busy}>
                  Apply review & regenerate XML →
                </button>
              </div>
            </>
          )}
          <footer className="page-footer">
            <span>ENTRYDESK / SHIPMENT PREPARATION</span>
            <span>Extract → review → export</span>
          </footer>
        </main>
      </div>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
