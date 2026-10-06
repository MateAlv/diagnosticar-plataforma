import type { User } from '../repositories/userRepository.js';

/**
 * The wording of the health-data consent in /terminos. A new wording gets a
 * new version, and every account is asked again before its next search.
 */
export const HEALTH_DATA_CONSENT_VERSION = '2026-10-06';

export function hasHealthDataConsent(user: Pick<User, 'health_data_consent_version'> | null | undefined): boolean {
    return user?.health_data_consent_version === HEALTH_DATA_CONSENT_VERSION;
}

/** What the browser gets to know about a signed-in account. */
export function publicUser(user: User) {
    return {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        health_data_consent: hasHealthDataConsent(user),
    };
}
