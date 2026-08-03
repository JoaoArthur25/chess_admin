import type { Mailer, Message } from './port.js';

/**
 * Default mailer: prints the message to the server log instead of sending it.
 *
 * This is what a club running the app on a laptop gets, and it is deliberate —
 * the arbiter reads the reset link off the terminal. It is NOT suitable once
 * other people have accounts, because anyone with log access can then reset any
 * account; configure SMTP for that (see mail/index.ts).
 */
export class ConsoleMailer implements Mailer {
  async send(message: Message): Promise<void> {
    console.log(
      [
        '',
        '─'.repeat(72),
        'E-MAIL (not sent — no SMTP configured, printing instead)',
        `To:      ${message.to}`,
        `Subject: ${message.subject}`,
        '',
        message.text,
        '─'.repeat(72),
        '',
      ].join('\n'),
    );
  }
}
