export const ONBOARDING_DISMISSED_STORAGE_KEY = 'wireedm.onboarding.dismissed';

export function hasDismissedOnboarding(
  storage: Pick<Storage, 'getItem'> = globalThis.localStorage
) {
  try {
    return storage.getItem(ONBOARDING_DISMISSED_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function rememberOnboardingDismissal(
  storage: Pick<Storage, 'setItem'> = globalThis.localStorage
) {
  try {
    storage.setItem(ONBOARDING_DISMISSED_STORAGE_KEY, 'true');
  } catch {
    // Dismissal still succeeds for the current session when storage is unavailable.
  }
}
