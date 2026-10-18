export const ONBOARDING_DISMISSED_STORAGE_KEY = 'wireedm.onboarding.dismissed';

export function hasDismissedOnboarding(
  storage: Pick<Storage, 'getItem'> | undefined = undefined
) {
  try {
    return (storage === undefined ? globalThis.localStorage : storage).getItem(ONBOARDING_DISMISSED_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function rememberOnboardingDismissal(
  storage: Pick<Storage, 'setItem'> | undefined = undefined
) {
  try {
    (storage === undefined ? globalThis.localStorage : storage).setItem(ONBOARDING_DISMISSED_STORAGE_KEY, 'true');
  } catch {
    // Dismissal still succeeds for the current session when storage is unavailable.
  }
}
