export const roleProfiles = {
  Executive: {
    team: 'Executive Office',
    permissions: [
      'allData',
      'approveDeals',
      'overrideAI',
      'exportData',
      'manageUsers',
      'manageSettings',
    ],
  },
  Administrator: {
    team: 'Platform Administration',
    permissions: [
      'allData',
      'approveDeals',
      'overrideAI',
      'exportData',
      'manageUsers',
      'manageSettings',
      'manageJobs',
    ],
  },
  'Finance Controller': {
    team: 'Finance Control',
    permissions: ['financeData', 'pricingData', 'approveDeals', 'exportData'],
  },
  'Pricing Manager': {
    team: 'Pricing Strategy',
    permissions: ['financeData', 'pricingData', 'enterpriseData', 'approveDeals', 'overrideAI'],
  },
  'Sales User': {
    team: 'Sales',
    permissions: ['enterpriseData'],
  },
}
