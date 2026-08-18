/**
 * Status line above the paper. Three cases:
 *   - offline (known, from the browser): a calm notice; the cached paper prints behind it.
 *   - a fetch failed while online: the louder "unable to reach the service", with a retry.
 *   - all well: nothing.
 */
export default function ErrorBanner({ error, stale, offline, hasEdition, onRetry }) {
  if (!offline && !error) return null;

  if (offline) {
    return (
      <div className="dc-banner offline" role="status">
        <span>
          {hasEdition
            ? "You’re offline — showing the last saved edition."
            : "You’re offline. Reconnect to load the paper."}
        </span>
      </div>
    );
  }

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
