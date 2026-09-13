export const reportStatusLabels: Record<string, string> = {
  ISSUED: 'Issued',
  SUPERSEDED: 'Superseded',
};
export const deliveryMethodLabels: Record<string, string> = {
  DOWNLOAD: 'Download',
  PRINT: 'Print',
  MANUAL: 'Manual',
};
export const deliveryStatusLabels: Record<string, string> = {
  RECORDED: 'Recorded',
  FAILED: 'Failed',
};
export const reportActivityLabels: Record<string, string> = {
  LAB_ORDER_COMPLETED: 'Order completed',
  LAB_ORDER_REOPENED: 'Order reopened',
  LAB_REPORT_GENERATED: 'Laboratory report issued',
  LAB_REPORT_DOWNLOADED: 'Laboratory report downloaded',
  LAB_REPORT_DELIVERED: 'Laboratory report delivery recorded',
  LAB_REPORT_SUPERSEDED: 'Laboratory report superseded',
  LAB_REPORT_SHARE_CREATED: 'Secure report link created',
  LAB_REPORT_SHARE_REVOKED: 'Secure report link revoked',
  LAB_REPORT_SHARE_ACCESSED: 'Secure report link opened',
  LAB_REPORT_SHARE_VERIFIED: 'Secure report PIN verified',
  LAB_REPORT_SHARE_DOWNLOAD: 'Secure report PDF downloaded',
};
export const shareStatusLabels: Record<string, string> = {
  ACTIVE: 'Active',
  EXPIRED: 'Expired',
  REVOKED: 'Revoked',
};
export const shareExpiryLabels: Record<string, string> = {
  '24h': '24 hours',
  '3d': '3 days',
  '7d': '7 days',
  '30d': '30 days',
};
