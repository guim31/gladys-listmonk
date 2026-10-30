// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// A self-hosted Listmonk: its address, and an API user with its token (Admin →
// Users → New, type "API").
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Refresh intervals offered in the configuration, in seconds.
export const POLL_INTERVALS = ['60', '120', '300', '600'];

export const DEFAULT_CONFIG = {
  url: '',
  api_user: '',
  api_token: '',
  poll_interval: '120',
  campaign_control: false,
  language: 'fr',
};

// An address copied from the browser points at the admin or at the API: the
// server is above.
const APP_PATH = /\/(admin|api)(\/.*)?$/i;

/**
 * Parse the address typed by the user into a base URL: a bare host or IP
 * (`192.0.2.10:9000`), or a URL copied from the browser
 * (`https://lists.example.org/admin/campaigns`). HTTP by default for a bare
 * host. A path is kept (Listmonk behind a reverse proxy sub-path).
 * @param {unknown} raw
 * @returns {string|null} `http(s)://host[:port][/path]`, '' when empty, null
 *   when unusable
 */
export function parseServerUrl(raw) {
  if (typeof raw !== 'string') {
    return '';
  }
  const text = raw.trim();
  if (!text) {
    return '';
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    return null;
  }
  // Credentials in the address would end up in the logs.
  if (url.username || url.password) {
    return null;
  }
  const path = url.pathname.replace(APP_PATH, '').replace(/\/+$/, '');
  return `${url.origin}${path}`;
}

/** Host part shown to the user (no scheme). */
export const hostOf = (url) => (url ? url.replace(/^https?:\/\//, '') : '');

const trimmed = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const pollInterval = POLL_INTERVALS.includes(String(source.poll_interval))
    ? String(source.poll_interval)
    : DEFAULT_CONFIG.poll_interval;
  return {
    url: parseServerUrl(source.url),
    // A pasted token often carries a trailing space or new line.
    apiUser: trimmed(source.api_user),
    apiToken: trimmed(source.api_token),
    pollIntervalMs: Number(pollInterval) * 1000,
    campaignControl: source.campaign_control === true || source.campaign_control === 'true',
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}

/**
 * What is missing to read Listmonk, null when the configuration is complete:
 * 'noUrl', 'invalidUrl', 'noUser' or 'noToken'.
 */
export function missingCredentials(config) {
  if (config.url === null) {
    return 'invalidUrl';
  }
  if (config.url === '') {
    return 'noUrl';
  }
  if (!config.apiUser) {
    return 'noUser';
  }
  return config.apiToken ? null : 'noToken';
}
