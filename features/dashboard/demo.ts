// Synthetic workflow examples only. No patient identifiers or production records.
export const demoOrders = [
  {
    id: 'DEMO-1045',
    tests: 'Complete blood count',
    time: '09:42',
    status: 'NEW',
  },
  {
    id: 'DEMO-1044',
    tests: 'Lipid profile',
    time: '09:35',
    status: 'COLLECTED',
  },
  {
    id: 'DEMO-1043',
    tests: 'Thyroid panel',
    time: '09:18',
    status: 'PROCESSING',
  },
  {
    id: 'DEMO-1042',
    tests: 'Glucose',
    time: '09:04',
    status: 'AWAITING_VALIDATION',
  },
  {
    id: 'DEMO-1041',
    tests: 'Renal function',
    time: '08:50',
    status: 'COMPLETED',
  },
] as const;
