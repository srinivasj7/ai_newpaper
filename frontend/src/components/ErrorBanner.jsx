/** Shown when a fetch failed. If we had something cached, the paper still prints behind it. */
export default function ErrorBanner({ error, stale, onRetry }) {
  if (!error) return null;
  return (
    <div className="dc-banner" role="status">
      <span>
        {stale
          ? "The wire is down — showing the last paper we have."
          : "The wire is down and nothing is cached yet."}
      </span>
      <span style={{ opacity: 0.75 }}>{error.message}</span>
      <button className="retry" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
