import { PLATFORM_META } from '../platformMeta.jsx';
import { formatCount, timeAgo, formatTimestamp } from '../format.js';

/**
 * One platform card.
 *
 * Renders three states from a single payload:
 *   - not implemented  -> a dimmed placeholder ("scraper not built yet")
 *   - no data          -> "No data available", prompting a refresh
 *   - data             -> avatar, title, stats, freshness
 *
 * All platform-specific knowledge comes from PLATFORM_META, so this component
 * never grows a switch statement as platforms are added.
 *
 * @param {{payload: Object, busy: boolean}} props
 */
export default function PlatformCard({ payload, busy }) {
  const { platform, label, url, implemented, hasData, data, ageSeconds } = payload;
  const meta = PLATFORM_META[platform];
  const Icon = meta.icon;

  const title = hasData ? meta.title(data) : label;
  const subtitle = hasData ? meta.subtitle(data) : null;

  return (
    <article
      className={`card${!implemented ? ' card--pending' : ''}${busy ? ' card--busy' : ''}`}
      style={{ '--platform-color': meta.color, '--platform-accent': meta.accent }}
    >
      <div className="card__accent" aria-hidden="true" />

      <header className="card__header">
        <span className="card__icon">
          <Icon />
        </span>
        <span className="card__platform">{label}</span>

        {implemented && (
          <span className={`card__badge${hasData ? '' : ' card__badge--warn'}`}>
            {busy ? 'Refreshing…' : hasData ? 'Live' : 'No data'}
          </span>
        )}
        {!implemented && <span className="card__badge card__badge--muted">Not built yet</span>}
      </header>

      {!implemented ? (
        <div className="card__empty">
          <p>Scraper not implemented yet.</p>
          <p className="card__empty-hint">This card activates as soon as {label} is built.</p>
        </div>
      ) : !hasData ? (
        <div className="card__empty">
          <p>No data available.</p>
          <p className="card__empty-hint">Press “Refresh data” to run the scraper.</p>
        </div>
      ) : (
        <>
          <div className="card__identity">
            {data.profileImage ? (
              <img
                className="card__avatar"
                src={data.profileImage}
                alt={`${title} profile`}
                /* Meta and LinkedIn CDNs reject hot-links that send a referer. */
                referrerPolicy="no-referrer"
                loading="lazy"
              />
            ) : (
              <div className="card__avatar card__avatar--empty" aria-hidden="true" />
            )}

            <div className="card__names">
              <h2 className="card__title" title={title}>
                {title}
              </h2>
              {subtitle && <p className="card__subtitle">{subtitle}</p>}
            </div>
          </div>

          <dl className="card__stats">
            {meta.stats.map(({ label: statLabel, key }) => (
              <div className="stat" key={key}>
                <dt className="stat__label">{statLabel}</dt>
                <dd className="stat__value">{formatCount(data[key])}</dd>
              </div>
            ))}
          </dl>
        </>
      )}

      <footer className="card__footer">
        <span className="card__updated" title={hasData ? formatTimestamp(data.lastUpdated) : ''}>
          {implemented && hasData ? `Updated ${timeAgo(ageSeconds)}` : ' '}
        </span>
        {url && (
          <a className="card__link" href={url} target="_blank" rel="noopener noreferrer">
            Visit ↗
          </a>
        )}
      </footer>
    </article>
  );
}
