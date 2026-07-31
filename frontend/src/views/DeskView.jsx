import { useMemo, useState } from "react";
import { TRUSTS, WEIGHTS } from "../defaults.js";

const SAVE_TEXT = { idle: "", saving: "Saving…", saved: "Saved to the pipeline ✓", failed: "Couldn't reach the pipeline — kept locally" };

export default function DeskView({ config, setConfig, saveState, feedback, onImport, importedCount, onClearImported }) {
  const [topicName, setTopicName] = useState("");
  const [topicWeight, setTopicWeight] = useState("normal");
  const [srcDomain, setSrcDomain] = useState("");
  const [srcTrust, setSrcTrust] = useState("allowed");
  const [importText, setImportText] = useState("");
  const [importMsg, setImportMsg] = useState(null);
  const [showExport, setShowExport] = useState(false);
  const [copied, setCopied] = useState(false);

  const save = (next) => setConfig(next);

  const addTopic = () => {
    const label = topicName.trim();
    if (!label) return;
    const slug = label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    if (!slug || config.topics.some((t) => t.slug === slug)) return;
    save({ ...config, topics: [...config.topics, { slug, label, weight: topicWeight, enabled: true }] });
    setTopicName("");
  };

  const addSource = () => {
    const domain = srcDomain
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "");
    if (!domain || config.sources.some((s) => s.domain === domain)) return;
    save({ ...config, sources: [...config.sources, { domain, trust: srcTrust }] });
    setSrcDomain("");
  };

  const exportPayload = useMemo(
    () =>
      JSON.stringify(
        {
          version: config.version ?? 1,
          exportedAt: new Date().toISOString(),
          briefName: config.briefName,
          topics: config.topics,
          sources: config.sources,
          feedback: Object.entries(feedback).map(([storyId, f]) => ({ storyId, ...f })),
        },
        null,
        2,
      ),
    [config, feedback],
  );

  const doImport = () => {
    try {
      const parsed = JSON.parse(importText);
      const eds = Array.isArray(parsed) ? parsed : [parsed];
      for (const e of eds) {
        if (!e?.date || (!e.lead && !e.stories)) throw new Error("edition needs at least `date` and `lead` or `stories`");
      }
      const kept = onImport(eds);
      setImportMsg({ ok: true, text: `Imported ${kept.length} edition${kept.length > 1 ? "s" : ""}. Check the Archive.` });
      setImportText("");
    } catch (e) {
      setImportMsg({ ok: false, text: `Rejected: ${e.message}` });
    }
  };

  const copyExport = async () => {
    try {
      await navigator.clipboard.writeText(exportPayload);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setShowExport(true);
    }
  };

  return (
    <div className="dc-desk">
      <h3>Masthead</h3>
      <p className="hint">Name the paper. It's yours, after all.</p>
      <div className="dc-add">
        <input value={config.briefName} onChange={(e) => save({ ...config, briefName: e.target.value })} aria-label="Brief name" />
        <span className={`dc-save ${saveState}`}>{SAVE_TEXT[saveState]}</span>
      </div>

      <h3>Topics</h3>
      <p className="hint">
        Weight tells the pipeline how much column space each desk earns. Toggling off hides it here and exports as disabled.
      </p>
      {config.topics.map((t) => (
        <div className="dc-row" key={t.slug}>
          <span className="name">
            {t.label}
            <small>{t.slug}</small>
          </span>
          {WEIGHTS.map((w) => (
            <button
              key={w}
              className={`dc-pill ${t.weight === w ? "on" : ""}`}
              onClick={() => save({ ...config, topics: config.topics.map((x) => (x.slug === t.slug ? { ...x, weight: w } : x)) })}
            >
              {w}
            </button>
          ))}
          <button
            className={`dc-pill ${t.enabled ? "good on" : ""}`}
            onClick={() =>
              save({ ...config, topics: config.topics.map((x) => (x.slug === t.slug ? { ...x, enabled: !x.enabled } : x)) })
            }
          >
            {t.enabled ? "on" : "off"}
          </button>
          <button
            className="dc-x"
            aria-label={`Remove ${t.label}`}
            onClick={() => save({ ...config, topics: config.topics.filter((x) => x.slug !== t.slug) })}
          >
            ✕
          </button>
        </div>
      ))}
      <div className="dc-add">
        <input
          placeholder="New topic, e.g. Robotics & Humanoids"
          value={topicName}
          onChange={(e) => setTopicName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addTopic()}
        />
        <select value={topicWeight} onChange={(e) => setTopicWeight(e.target.value)}>
          {WEIGHTS.map((w) => (
            <option key={w}>{w}</option>
          ))}
        </select>
        <button className="dc-btn" onClick={addTopic}>
          Add topic
        </button>
      </div>

      <h3>Sources</h3>
      <p className="hint">Preferred sources get cited first; blocked ones never make print.</p>
      {config.sources.map((s) => (
        <div className="dc-row" key={s.domain}>
          <span className="name" style={{ fontFamily: "var(--mono)", fontSize: 14 }}>
            {s.domain}
          </span>
          {TRUSTS.map((tr) => (
            <button
              key={tr}
              className={`dc-pill ${tr === "blocked" ? "warn" : tr === "preferred" ? "good" : ""} ${s.trust === tr ? "on" : ""}`}
              onClick={() =>
                save({ ...config, sources: config.sources.map((x) => (x.domain === s.domain ? { ...x, trust: tr } : x)) })
              }
            >
              {tr}
            </button>
          ))}
          <button
            className="dc-x"
            aria-label={`Remove ${s.domain}`}
            onClick={() => save({ ...config, sources: config.sources.filter((x) => x.domain !== s.domain) })}
          >
            ✕
          </button>
        </div>
      ))}
      <div className="dc-add">
        <input
          placeholder="domain or RSS host, e.g. arstechnica.com"
          value={srcDomain}
          onChange={(e) => setSrcDomain(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addSource()}
        />
        <select value={srcTrust} onChange={(e) => setSrcTrust(e.target.value)}>
          {TRUSTS.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <button className="dc-btn" onClick={addSource}>
          Add source
        </button>
      </div>

      <h3>Pipeline exchange</h3>
      <p className="hint">
        Config saves straight to the pipeline; the payload below is the fallback when the wire is down. Paste edition JSON to
        preview it here before it ships. {Object.keys(feedback).length} feedback marks recorded.
      </p>
      <div className="dc-add">
        <button className="dc-btn" onClick={copyExport}>
          {copied ? "Copied ✓" : "Copy config + feedback JSON"}
        </button>
        <button className="dc-btn ghost" onClick={() => setShowExport((s) => !s)}>
          {showExport ? "Hide" : "View"} payload
        </button>
      </div>
      {showExport && <pre className="dc-export">{exportPayload}</pre>}
      <div className="dc-import">
        <textarea
          placeholder={'Paste edition JSON (single object or array). Minimum: {"date":"2026-07-18","lead":{...},"stories":[...]}'}
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
        />
        <div className="dc-add">
          <button className="dc-btn" onClick={doImport} disabled={!importText.trim()}>
            Import edition
          </button>
          {importedCount > 0 && (
            <button className="dc-btn ghost" onClick={onClearImported}>
              Drop {importedCount} imported
            </button>
          )}
        </div>
        {importMsg && <p className={`dc-note ${importMsg.ok ? "ok" : "err"}`}>{importMsg.text}</p>}
      </div>
    </div>
  );
}
