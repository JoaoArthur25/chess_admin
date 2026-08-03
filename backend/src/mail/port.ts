// Mailer port. Same adapter pattern as the pairing engine and the repository:
// the service depends on this interface, never on a transport.

export interface Message {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(message: Message): Promise<void>;
}
