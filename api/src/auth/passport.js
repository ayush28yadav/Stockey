// Passport configuration (Google OAuth)
// Purpose: when Google OAuth is configured, provide a Passport strategy
// that creates or links users in the application database. The strategy
// verifies that Google supplies a verified email address and handles
// edge-cases where an email already exists with a different provider.
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { config } from '../config.js';
import { pool } from '../db.js';
export function configurePassport() {
    if (!config.googleConfigured)
        return passport;
    passport.use(new GoogleStrategy({
        clientID: config.GOOGLE_CLIENT_ID,
        clientSecret: config.GOOGLE_CLIENT_SECRET,
        callbackURL: config.GOOGLE_CALLBACK_URL,
        state: true,
        passReqToCallback: false
    }, async (_accessToken, _refreshToken, profile, done) => {
        try {
            const email = profile.emails?.[0]?.value?.trim().toLowerCase();
            if (!email || profile._json?.email_verified !== true) {
                return done(new Error('Google did not provide a verified email address.'));
            }
            const existingProvider = await pool.query('SELECT id, email, password_hash, oauth_provider, oauth_id FROM users WHERE oauth_provider = $1 AND oauth_id = $2', ['google', profile.id]);
            if (existingProvider.rows[0])
                return done(null, existingProvider.rows[0]);
            const existingEmail = await pool.query('SELECT id, email, password_hash, oauth_provider, oauth_id FROM users WHERE email = $1 FOR UPDATE', [email]);
            if (existingEmail.rows[0]) {
                const user = existingEmail.rows[0];
                if (user.oauth_provider && user.oauth_provider !== 'google')
                    return done(new Error('This email is already linked to another sign-in provider.'));
                const linked = await pool.query(`UPDATE users SET oauth_provider = 'google', oauth_id = $2 WHERE id = $1
           RETURNING id, email, password_hash, oauth_provider, oauth_id`, [user.id, profile.id]);
                return done(null, linked.rows[0]);
            }
            const created = await pool.query(`INSERT INTO users (email, oauth_provider, oauth_id)
         VALUES ($1, 'google', $2)
         RETURNING id, email, password_hash, oauth_provider, oauth_id`, [email, profile.id]);
            return done(null, created.rows[0]);
        }
        catch (error) {
            return done(error);
        }
    }));
    return passport;
}
