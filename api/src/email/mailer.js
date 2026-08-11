/*
    Email transporter (mailer)

    Responsibilities:
    - Create and export a Nodemailer transporter configured from environment
      variables.
    - When SMTP credentials are absent (local development), automatically
      create a temporary Ethereal test account. Ethereal catches all outgoing
      emails and provides a preview URL — no real emails are ever delivered,
      and no sign-up is required.

    How it works:
    - On first call to `getTransporter()` the module checks whether SMTP_HOST
      is set in the environment.
        • If yes  → create a real SMTP transporter.
        • If no   → call Ethereal's `createTestAccount()`, which returns a
                    temporary username + password, then create an SMTP transport
                    pointing at Ethereal's servers.
    - The transporter is cached in a module-level variable so the Ethereal
      account is only created once per process start.
    - `sendMail(options)` wraps the underlying transporter. In development it
      also logs the Nodemailer preview URL so you can open the email in your
      browser without setting up a mail client.

    Usage:
        import { sendMail } from './mailer.js';
        const info = await sendMail({ to, subject, html, text });
*/

import nodemailer from 'nodemailer';
import { config } from '../config.js';

// Module-level transporter cache. Initialised lazily on first send.
let _transporter = null;

/**
 * Returns a ready Nodemailer transporter. Creates it on first call.
 *
 * The async initialisation (Ethereal account creation) is handled here so
 * callers don't need to worry about setup — they just call `sendMail`.
 *
 * @returns {Promise<nodemailer.Transporter>}
 */
async function getTransporter() {
    // Return the cached transporter if it already exists.
    if (_transporter) return _transporter;

    if (config.SMTP_HOST) {
        // ── Production / staging path ─────────────────────────────────────────
        // A real SMTP host is configured. Create a transporter using those
        // credentials. SMTP_PORT defaults to 587 (STARTTLS / submission).
        console.log(`[mailer] Using real SMTP server: ${config.SMTP_HOST}:${config.SMTP_PORT}`);
        _transporter = nodemailer.createTransport({
            host: config.SMTP_HOST,
            port: config.SMTP_PORT,
            // Port 465 uses implicit TLS (smtps://). Any other port uses
            // STARTTLS via the `secure: false` + `requireTLS` combination.
            secure: config.SMTP_PORT === 465,
            auth: {
                user: config.SMTP_USER,
                pass: config.SMTP_PASS
            }
        });
    } else {
        // ── Development path (Ethereal) ───────────────────────────────────────
        // No real SMTP credentials → create a free Ethereal test account.
        // Ethereal is a fake SMTP service that captures all messages and lets
        // you view them at https://ethereal.email/messages. Nothing is
        // delivered to real inboxes.
        console.log('[mailer] No SMTP_HOST set — creating Ethereal test account for development...');
        const testAccount = await nodemailer.createTestAccount();
        console.log(`[mailer] Ethereal account ready: ${testAccount.user}`);

        _transporter = nodemailer.createTransport({
            host: 'smtp.ethereal.email',
            port: 587,
            secure: false,          // STARTTLS on port 587
            auth: {
                user: testAccount.user,
                pass: testAccount.pass
            }
        });
    }

    return _transporter;
}

/**
 * Send an email.
 *
 * @param {object} options
 * @param {string}   options.to       - Recipient address (e.g. "alice@example.com")
 * @param {string}   options.subject  - Email subject line
 * @param {string}   options.html     - HTML body (rich email content)
 * @param {string}   [options.text]   - Plain-text fallback for clients that
 *                                      don't render HTML
 *
 * @returns {Promise<nodemailer.SentMessageInfo>} - Nodemailer result object.
 *   In development, use `nodemailer.getTestMessageUrl(result)` on the returned
 *   value to get the Ethereal preview link.
 */
export async function sendMail({ to, subject, html, text }) {
    const transporter = await getTransporter();

    const result = await transporter.sendMail({
        from: config.SMTP_FROM,   // "Stockey <noreply@stockey.dev>"
        to,
        subject,
        html,
        text: text ?? ''          // Nodemailer accepts empty string
    });

    // In development, Nodemailer provides a URL to preview the captured email
    // on the Ethereal web interface. Log it so you can click it directly in
    // the terminal.
    const previewUrl = nodemailer.getTestMessageUrl(result);
    if (previewUrl) {
        console.log(`[mailer] 📧 Preview email at: ${previewUrl}`);
    }

    return result;
}
