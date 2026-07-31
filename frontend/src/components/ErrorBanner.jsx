/** Shown when a fetch failed. If we had something cached, the paper still prints behind it. */
export default function ErrorBanner({ error, stale, onRetry }) {
  if (!error) return null;
  return (
    <div className="dc-banner" role="status">
      <span>
        {stale
          ? "Unable to reach the service. Showing the most recent cached edition."
          : "Unable to reach the service, and no edition is cached locally."}
      </span>
      <span style={{ opacity: 0.75 }}>{error.message}</span>
      <button className="retry" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
