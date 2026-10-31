import nodemailer, { type Transporter } from 'nodemailer';

// Reminder emails go through EMAIL_MODE in backend/.env:
//   (unset) or off: no emails, only in-app notifications
//   ethereal:       a free Ethereal test inbox; nothing is delivered, and the server log
//                   prints a link to view each email (for the demo)
//   smtp:           a real mail server from SMTP_URL (smtp://user:pass@host:port)
// The professor emails in the seed data are example.edu addresses, so ethereal is the
// mode to use for now. Email is a stretch goal; a failed email never fails the request.

export interface ReminderEmail {
  to: string;
  name: string;
  subject: string;
}

const FROM = 'Assessment Helper <no-reply@assessment-helper.example.edu>';

let transport: Promise<Transporter | null> | undefined;
let override: Transporter | null | undefined;
const inFlight = new Set<Promise<unknown>>();

async function createTransport(): Promise<Transporter | null> {
  const mode = process.env.EMAIL_MODE?.trim().toLowerCase();
  if (!mode || mode === 'off') return null;
  if (mode === 'smtp') {
    const url = process.env.SMTP_URL?.trim();
    if (!url) throw new Error('EMAIL_MODE=smtp needs SMTP_URL.');
    return nodemailer.createTransport(url);
  }
  if (mode === 'ethereal') {
    const account = await nodemailer.createTestAccount();
    return nodemailer.createTransport({
      host: account.smtp.host,
      port: account.smtp.port,
      secure: account.smtp.secure,
      auth: { user: account.user, pass: account.pass },
    });
  }
  throw new Error(`Unknown EMAIL_MODE "${mode}". Use off, ethereal, or smtp.`);
}

function getTransport(): Promise<Transporter | null> {
  if (override !== undefined) return Promise.resolve(override);
  transport ??= createTransport().catch((error: unknown) => {
    transport = undefined; // try again on the next send
    throw error;
  });
  return transport;
}

// Tests swap in an offline transport (or null for no email).
export function setMailTransportForTests(next: Transporter | null | undefined) {
  override = next;
}

// Tests wait for background sends to finish.
export async function waitForEmails() {
  await Promise.allSettled([...inFlight]);
}

export function reminderText(email: ReminderEmail) {
  return `Hello ${email.name},\n\n${email.subject}\n\nPlease sign in to Assessment Helper to sign up for your observation.\n\nAssessment Committee`;
}

// Sends each email and reports what happened. Errors are returned, not thrown.
export async function sendReminderEmails(emails: ReminderEmail[]) {
  if (!emails.length) return [];
  let mailer: Transporter | null;
  try {
    mailer = await getTransport();
  } catch (error) {
    console.error('Reminder emails were not sent:', (error as Error).message);
    return emails.map((email) => ({ to: email.to, sent: false }));
  }
  if (!mailer) return emails.map((email) => ({ to: email.to, sent: false }));
  const results = [];
  for (const email of emails) {
    try {
      const info = await mailer.sendMail({
        from: FROM, to: email.to, subject: 'Classroom observation reminder', text: reminderText(email),
      });
      const preview = nodemailer.getTestMessageUrl(info);
      if (preview) console.log(`Reminder email to ${email.to}: ${preview}`);
      results.push({ to: email.to, sent: true, info });
    } catch (error) {
      console.error(`Reminder email to ${email.to} failed:`, (error as Error).message);
      results.push({ to: email.to, sent: false });
    }
  }
  return results;
}

// Starts sending in the background so the AC's request returns right away.
export function queueReminderEmails(emails: ReminderEmail[]) {
  const job = sendReminderEmails(emails);
  inFlight.add(job);
  void job.finally(() => inFlight.delete(job));
}
