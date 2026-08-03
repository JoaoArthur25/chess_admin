import { ConsoleMailer } from './console.js';
import type { Mailer } from './port.js';

export * from './port.js';
export { ConsoleMailer } from './console.js';

/**
 * Resolve the mailer from configuration. SMTP is used when SMTP_HOST is set;
 * otherwise messages are printed to the server log.
 *
 * The console fallback is intentional for a single-arbiter club install, but it
 * means anyone who can read the logs can reset any account — configure SMTP
 * before other people have accounts.
 */
export async function createMailer(): Promise<Mailer> {
  const host = process.env.SMTP_HOST;
  if (!host) return new ConsoleMailer();

  const { SmtpMailer } = await import('./smtp.js');
  const port = Number(process.env.SMTP_PORT ?? 587);
  const config = {
    host,
    port,
    // Implicit TLS on 465; STARTTLS elsewhere.
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER ?? 'no-reply@chess-admin.local',
  };
  return new SmtpMailer(config);
}
