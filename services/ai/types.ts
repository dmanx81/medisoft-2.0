// No provider receives credentials, repositories or unrestricted patient records.
export type AIAction =
  | 'EXPLAIN_LAB_RESULTS'
  | 'SUMMARIZE_PATIENT'
  | 'ANALYZE_FINANCES'
  | 'SUMMARIZE_OPERATIONS';
export interface AIContext {
  organizationId: string;
  requestedBy: string;
  action: AIAction;
  resourceIds: readonly string[];
  // Minimal, permission-checked, redacted context assembled by application services.
  context: Readonly<Record<string, string | number | readonly string[]>>;
}
export interface AIResponse {
  draft: string;
  requiresHumanReview: true;
  advisoryOnly: true;
  provider: string;
  model: string;
}
export interface AIProvider {
  generate(
    context: AIContext,
    options: { signal?: AbortSignal },
  ): Promise<AIResponse>;
}
// Future orchestration must check organization.ai_enabled, action permissions and
// audit the request before calling a provider. No mutation/validation tools here.
