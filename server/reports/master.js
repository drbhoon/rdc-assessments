/**
 * Employee master client — the portal's /api/master/* over MASTER_API_URL.
 *
 * On hr.rdcc.ai that is http://portal:3000 on the private Docker network.
 * MASTER_API_KEY stays on the server: the HR console asks this app, and this
 * app asks the portal.
 */

const BASE = () => String(process.env.MASTER_API_URL || '').replace(/\/$/, '');

export function masterConfigured() {
  return Boolean(BASE() && process.env.MASTER_API_KEY);
}

async function masterGet(path, params) {
  if (!masterConfigured()) {
    throw new Error('Employee master is not configured. Set MASTER_API_URL and MASTER_API_KEY.');
  }
  const query = params && params.toString();
  const url = `${BASE()}${path}${query ? `?${query}` : ''}`;

  let response;
  try {
    response = await fetch(url, {
      headers: { 'x-master-key': process.env.MASTER_API_KEY },
      signal: AbortSignal.timeout(20000),
    });
  } catch (err) {
    throw new Error(
      err?.name === 'TimeoutError'
        ? 'The employee master did not respond in time.'
        : `Could not reach the employee master: ${err?.message || 'network error'}`,
    );
  }
  if (response.status === 401) throw new Error('The employee master rejected our key (MASTER_API_KEY).');
  if (response.status === 404) throw new Error(`The employee master does not offer ${path} — the portal needs updating.`);
  if (!response.ok) throw new Error(`Employee master returned HTTP ${response.status}.`);
  return response.json();
}

/** The filter names the portal's /master page uses, passed straight through. */
const LIST_KEYS = ['location', 'designation', 'company', 'cost_centre', 'source', 'code'];
const ONE_KEYS = ['q', 'doj_from', 'doj_to', 'dob_from', 'dob_to'];

/**
 * Employees matching the /master filters.
 * @param {object} filters  query-shaped: arrays for LIST_KEYS, strings for ONE_KEYS
 * @param {boolean} picker  trim to code, name, designation, location, e-mail
 */
export async function fetchEmployees(filters = {}, picker = true) {
  const params = new URLSearchParams();
  if (picker) params.set('fields', 'picker');
  for (const key of LIST_KEYS) {
    const v = filters[key];
    for (const item of Array.isArray(v) ? v : v ? [v] : []) if (item) params.append(key, String(item));
  }
  for (const key of ONE_KEYS) {
    const v = Array.isArray(filters[key]) ? filters[key][0] : filters[key];
    if (v) params.set(key, String(v));
  }
  const data = await masterGet('/api/master/employees', params);
  return Array.isArray(data?.employees) ? data.employees : [];
}

/** Full records for exactly these codes, keyed by code. */
export async function fetchByCodes(codes) {
  const unique = [...new Set(codes.filter(Boolean))];
  if (!unique.length) return new Map();
  const rows = await fetchEmployees({ code: unique }, false);
  return new Map(rows.map((e) => [e.employee_code, e]));
}

export async function fetchFilterOptions() {
  const data = await masterGet('/api/master/filter-options');
  const list = (v) => (Array.isArray(v) ? v : []);
  return {
    locations: list(data?.locations),
    designations: list(data?.designations),
    companies: list(data?.companies),
    costCentres: list(data?.costCentres),
  };
}
