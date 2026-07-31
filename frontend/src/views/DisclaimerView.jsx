const OWNER_URL = import.meta.env.VITE_SITE_OWNER_URL ?? null;

/**
 * Terms and disclaimer. Reachable from the footer on every page.
 *
 * The content here is deliberately unambiguous: this is an automated, experimental,
 * personal project whose output is unverified machine-generated text, and nothing on the
 * site is advice of any kind. Keep this page in step with the per-table notes on the
 * market pages — they are the same commitment stated twice.
 */
export default function DisclaimerView() {
  return (
    <div className="dc-desk dc-legal">
      <h3>Terms &amp; Disclaimer</h3>
      <p className="hint">Last updated 31 July 2026. Applies to every page and every document served here.</p>

      <h4>Nature of this publication</h4>
      <p>
        This site is a personal, experimental project. Its contents are generated automatically by large language
        models from publicly available sources, selected and ranked by another model, and published without human
        review. No editor checks any statement before it appears.
      </p>
      <p>
        Machine-generated text can be inaccurate, incomplete, outdated, internally inconsistent, or entirely
        fabricated, including quotations, figures, dates, and citations that appear authoritative. Treat everything
        here as an unverified draft, not as reporting, and verify anything that matters against the linked primary
        source.
      </p>

      <h4>Not financial, investment, legal, or tax advice</h4>
      <p>
        Nothing on this site is investment advice, a recommendation, a solicitation, or an offer to buy or sell any
        security or financial instrument, and nothing here should be relied on in making any financial decision. The
        operator is not a registered investment adviser, broker-dealer, or financial planner, and no advisory or
        fiduciary relationship of any kind is created by your use of this site.
      </p>
      <p>
        Price scenarios, conviction ratings, sentiment labels, options structures, and any "aggressive case" figures
        are speculative model output produced under stated assumptions. They are not forecasts, price targets,
        valuations, or guarantees, and the probabilities attached to them are not statistically derived. Options
        strategies in particular carry a risk of rapid and total loss of the premium paid, and losses on some
        positions can exceed the amount invested. Consult a licensed professional who knows your circumstances
        before acting on anything you read here.
      </p>

      <h4>No warranty</h4>
      <p>
        The site and its contents are provided "as is" and "as available", without warranty of any kind, express or
        implied, including but not limited to warranties of accuracy, completeness, reliability, timeliness,
        merchantability, fitness for a particular purpose, and non-infringement. No representation is made that the
        site will be available, uninterrupted, secure, or error-free, or that any edition will be published on any
        schedule.
      </p>

      <h4>Limitation of liability</h4>
      <p>
        To the fullest extent permitted by law, the operator shall not be liable for any loss or damage of any kind
        arising from your access to, use of, or reliance on this site or its contents, including without limitation
        direct, indirect, incidental, consequential, special, exemplary, or punitive damages, loss of profits,
        trading and investment losses, loss of data, or business interruption, whether based in contract, tort,
        negligence, strict liability, or any other theory, and whether or not the operator has been advised of the
        possibility of such loss. Your sole and exclusive remedy is to stop using the site.
      </p>

      <h4>Third-party content and trademarks</h4>
      <p>
        Summaries link to third-party sources whose content remains the property of their respective owners. Links
        are provided for verification and are not endorsements; the operator does not control and is not responsible
        for third-party content. Company names, tickers, and trademarks are used for identification only and imply no
        affiliation with, sponsorship by, or endorsement from any entity mentioned. The operator may hold positions
        in securities discussed and undertakes no obligation to disclose or update them.
      </p>

      <h4>Automated access, indexing, and model training</h4>
      <p>
        This site is private and is excluded from search indexing. Crawling, scraping, archiving, indexing, bulk
        downloading, and the use of any content here as input to train or evaluate machine learning models are not
        permitted, whether or not the technical measures on the site are honoured. The absence of an effective
        technical barrier is not permission.
      </p>

      <h4>Changes</h4>
      <p>
        These terms may change without notice, and editions may be corrected, replaced, or withdrawn at any time. Use
        of the site after a change constitutes acceptance of the revised terms. If you do not accept these terms, do
        not use this site.
      </p>

      {OWNER_URL && (
        <>
          <h4>Contact</h4>
          <p>
            For more information, see{" "}
            <a href={OWNER_URL} target="_blank" rel="noreferrer">
              {OWNER_URL.replace(/^https?:\/\//, "")}
            </a>
            .
          </p>
        </>
      )}
    </div>
  );
}
