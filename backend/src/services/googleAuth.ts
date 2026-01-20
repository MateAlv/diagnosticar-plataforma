import passport from 'passport';
import { Strategy as GoogleStrategy, Profile } from 'passport-google-oauth20';
import { GOOGLE_AUTH_ENABLED, GOOGLE_CALLBACK_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } from '../config.js';

export type GoogleProfile = Profile;

export function configureGoogleAuth(): boolean {
    if (!GOOGLE_AUTH_ENABLED || !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
        return false;
    }

    passport.use(
        new GoogleStrategy(
            {
                clientID: GOOGLE_CLIENT_ID,
                clientSecret: GOOGLE_CLIENT_SECRET,
                callbackURL: GOOGLE_CALLBACK_URL,
            },
            (_accessToken, _refreshToken, profile, done) => {
                return done(null, profile);
            }
        )
    );

    return true;
}
