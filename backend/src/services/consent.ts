import type { User } from '../repositories/userRepository.js';

/**
 * The version of /terminos an account accepted. Accepting them is also the
 * express consent Ley 25.326 asks for health data (art. 7) and for sending it
 * abroad (art. 12), so a new version is accepted again once.
 */
export const HEALTH_DATA_CONSENT_VERSION = '2026-10-07';

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
