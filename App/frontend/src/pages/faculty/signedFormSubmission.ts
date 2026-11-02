const activeSubmissions = new Set<string>();

export function beginSignedFormSubmission(observationId: string) {
  if (activeSubmissions.has(observationId)) return false;
  activeSubmissions.add(observationId);
  return true;
}

export function endSignedFormSubmission(observationId: string) {
  activeSubmissions.delete(observationId);
}
