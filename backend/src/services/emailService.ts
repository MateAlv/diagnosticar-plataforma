import nodemailer from 'nodemailer';
import { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, FRONTEND_URL, IS_PRODUCTION } from '../config.js';

const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: false,
    auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
    },
});

export async function sendVerificationEmail(email: string, token: string) {
    const verificationUrl = `${FRONTEND_URL}/verify?token=${token}`;

    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
        if (IS_PRODUCTION) {
            throw new Error('SMTP is not configured for production email delivery.');
        }
        console.log(`[MOCK EMAIL] To: ${email}, Link: ${verificationUrl}`);
        return;
    }

    try {
        await transporter.sendMail({
            from: '"Diagnostic.ar" <no-reply@diagnostic.ar>',
            to: email,
            subject: 'Verify your email',
            html: `
        <h1>Welcome to Diagnostic.ar</h1>
        <p>Please click the link below to verify your email address:</p>
        <a href="${verificationUrl}">${verificationUrl}</a>
      `,
        });
        console.log(`Verification email sent to ${email}`);
    } catch (error) {
        console.error('Error sending email:', error);
        if (!IS_PRODUCTION) {
            console.log(`[FALLBACK EMAIL] To: ${email}, Link: ${verificationUrl}`);
        }
    }
}
