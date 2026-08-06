import { useMemo, useState } from "react";
import { TRUSTS, WEIGHTS } from "../defaults.js";

const SAVE_TEXT = {
  idle: "",
  saving: "Saving…",
  saved: "Saved",
  failed: "Save failed — changes kept in this browser",
  locked: "Locked — unlock to publish this change",
};

export default function DeskView({
  config,
  setConfig,
  saveState,
  feedback,
  onImport,
  importedCount,
  onClearImported,
  unlocked,
  onUnlock,
  onLock,
}) {
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
      setImportMsg({
        ok: true,
        text: `Imported ${kept.length} edition${kept.length > 1 ? "s" : ""}. Available in the archive.`,
      });
      setImportText("");
    } catch (e) {
      setImportMsg({ ok: false, text: `Import rejected: ${e.message}` });
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
      <h3>Editing</h3>
      <p className="hint">
        Anyone can read this paper; only someone with the passphrase can change what it publishes. Topics, sources, and
        story votes all steer tomorrow&rsquo;s edition, so all three are behind it. Edits made while locked stay in this
        browser and are sent once you unlock.
      </p>
      <div className="dc-add">
        <span className={`dc-save ${unlocked ? "saved" : ""}`}>{unlocked ? "Unlocked" : "Locked"}</span>
        <button className="dc-btn ghost" onClick={unlocked ? onLock : onUnlock}>
          {unlocked ? "Lock" : "Unlock"}
        </button>
      </div>

      <h3>Publication</h3>
      <p className="hint">The name shown in the masthead.</p>
      <div className="dc-add">
        <input value={config.briefName} onChange={(e) => save({ ...config, briefName: e.target.value })} aria-label="Brief name" />
        <span className={`dc-save ${saveState}`}>{SAVE_TEXT[saveState]}</span>
      </div>

      <h3>Topics</h3>
      <p className="hint">
        Weight determines how much of each edition a topic is allocated. A disabled topic is hidden here and excluded
        from generation.
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
      <p className="hint">Preferred sources are cited first. Blocked sources are excluded from every edition.</p>
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

      <h3>Configuration &amp; data</h3>
      <p className="hint">
        Changes are saved automatically. The payload below is a manual fallback for when the service is unreachable.
        Edition JSON can be pasted in to preview it locally before publication. {Object.keys(feedback).length} feedback
        {Object.keys(feedback).length === 1 ? " entry" : " entries"} recorded in this browser.
      </p>
      <div className="dc-add">
        <button className="dc-btn" onClick={copyExport}>
          {copied ? "Copied" : "Copy configuration JSON"}
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
              Remove {importedCount} imported
            </button>
          )}
        </div>
        {importMsg && <p className={`dc-note ${importMsg.ok ? "ok" : "err"}`}>{importMsg.text}</p>}
      </div>
    </div>
  );
}
