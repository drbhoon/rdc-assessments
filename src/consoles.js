/**
 * The two consoles this app serves, and which assessment types belong to each.
 *
 * One codebase, one database, one `interviews` table — split only by audience,
 * because that is the split that actually matters here:
 *
 *   - ASSESSMENT types are taken by RDC employees: trainee progress reports and
 *     the Kaushal skill validations.
 *   - RECRUITMENT types are taken by people who do not work here yet.
 *
 * They were on one dropdown, which meant HR scrolled past five employee
 * dashboards to reach the two they wanted, and the portal offered a single
 * tile for two unrelated jobs. Splitting the console is a route and a tile —
 * not a second application, a second container or a second AI key. New
 * recruitment types added here appear on that tile for free.
 *
 * Consumed by App.jsx (routing) and AdminDashboard.jsx (dropdown, title, and
 * the server-side filter on the session list), so the two cannot drift.
 */
export const CONSOLES = {
  assessment: {
    path: '/admin',
    title: 'RDC ASSESSMENTS',
    tagline: 'AI-Powered Assessment System for RDC employees',
    emptyHint: 'Select an assessment to evaluate reports or generate links.',
    groups: [
      {
        label: 'Offline PDF Evaluators',
        options: [
          ['ops', 'Operations Trainee Eval'],
          ['sales', 'Sales Trainee Eval'],
        ],
      },
      {
        label: 'Remote Assessment Links',
        options: [
          ['kaushal_mm', 'Kaushal MM Validation'],
          ['kaushal_tech', 'Kaushal Technical (Concrete)'],
          ['kaushal_batching', 'Kaushal Batching'],
        ],
      },
    ],
  },

  recruitment: {
    path: '/admin/recruitment',
    title: 'RDC RECRUITMENT',
    tagline: 'AI-Powered Recruitment System for external candidates',
    emptyHint: 'Select a recruitment track to generate candidate links.',
    groups: [
      {
        label: 'Remote Assessment Links',
        options: [
          ['recruitment', 'Fresher Recruitment'],
          ['sales_recruitment', 'Sales Recruitment'],
        ],
      },
    ],
  },
};

/** Every assessment type belonging to one console, flat. */
export function typesFor(consoleKey) {
  const config = CONSOLES[consoleKey] || CONSOLES.assessment;
  return config.groups.flatMap((group) => group.options.map(([value]) => value));
}
