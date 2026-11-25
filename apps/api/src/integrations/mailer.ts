/**
 * Real SMTP email delivery powered by Nodemailer.
 * Uses Settings -> Notifications (`notifications.smtp_*`) with env fallbacks.
 */
import nodemailer = require('nodemailer');
import type Mail = require('nodemailer/lib/mailer');
import { getCached } from './settings';
import { decryptSecretValue } from '../security/secret-store';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

export async function getSmtpConfig(override: Partial<SmtpConfig> = {}): Promise<SmtpConfig> {
  const host = String(override.host ?? await getCached('notifications.smtp_host', '') ?? process.env.SMTP_HOST ?? '').trim();
  const port = Number(override.port ?? await getCached('notifications.smtp_port', 587) ?? process.env.SMTP_PORT ?? 587) || 587;
  const secureRaw = override.secure ?? await getCached('notifications.smtp_secure', false) ?? (process.env.SMTP_SECURE === 'true');
  const secure = secureRaw === true || secureRaw === 'true' || port === 465;
  const user = String(override.user ?? await getCached('notifications.smtp_user', '') ?? process.env.SMTP_USER ?? '').trim();
  const rawPass = override.pass && override.pass !== '••••••••'
    ? override.pass
    : (await getCached('notifications.smtp_pass', '') || process.env.SMTP_PASS || '');
  const pass = decryptSecretValue(String(rawPass || ''));
  const company = String(await getCached('general.company_name', 'IzanDesk ISP') || 'IzanDesk ISP').trim();
  const fromAddr = String(override.from ?? await getCached('notifications.smtp_from', '') ?? process.env.SMTP_FROM ?? (user || 'noreply@izandesk.local')).trim();
  const from = fromAddr.includes('<') ? fromAddr : `${company} <${fromAddr}>`;
  return { host, port, secure, user, pass, from };
}

function makeTransport(cfg: SmtpConfig) {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 12_000,
    ...(cfg.user ? { auth: { user: cfg.user, pass: cfg.pass } } : {}),
  });
}

export async function verifySmtpConnection(override: Partial<SmtpConfig> & { test_to?: string } = {}): Promise<{
  ok: boolean;
  detail: string;
  sentTestEmail?: boolean;
}> {
  const cfg = await getSmtpConfig(override);
  if (!cfg.host) return { ok: false, detail: 'SMTP host is not configured' };
  const transport = makeTransport(cfg);
  try {
    await transport.verify();
    if (override.test_to) {
      const info = await transport.sendMail({
        from: cfg.from,
        to: override.test_to,
        subject: 'IzanDesk SMTP Test',
        text: `SMTP verification succeeded from ${cfg.host}:${cfg.port} (${cfg.secure ? 'TLS' : 'STARTTLS/plain'}).`,
      });
      return {
        ok: true,
        sentTestEmail: true,
        detail: `SMTP ${cfg.host}:${cfg.port} verified and test email sent (${info.messageId || 'ok'})`,
      };
    }
    return {
      ok: true,
      detail: `SMTP ${cfg.host}:${cfg.port} verified (${cfg.secure ? 'TLS' : 'STARTTLS/plain'}${cfg.user ? `, user=${cfg.user}` : ''})`,
    };
  } catch (e: any) {
    return { ok: false, detail: e?.message || String(e) };
  } finally {
    try { transport.close(); } catch { /* ignore */ }
  }
}

export async function sendEmail(input: {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  attachments?: Mail.Attachment[];
  override?: Partial<SmtpConfig>;
}): Promise<{
  ok: boolean;
  status: 'SENT' | 'SIMULATED' | 'FAILED';
  messageId?: string;
  mode: 'live' | 'simulated' | 'error';
  note: string;
  error?: string;
}> {
  const cfg = await getSmtpConfig(input.override);
  const to = Array.isArray(input.to) ? input.to.join(', ') : String(input.to || '').trim();
  if (!to) {
    return { ok: false, status: 'FAILED', mode: 'error', note: 'Recipient email is required', error: 'Recipient email is required' };
  }
  if (!cfg.host) {
    return {
      ok: true,
      status: 'SIMULATED',
      messageId: `SIM-EMAIL-${Date.now()}`,
      mode: 'simulated',
      note: 'SMTP host not configured in Settings -> Notifications; simulated.',
    };
  }
  const transport = makeTransport(cfg);
  try {
    const info = await transport.sendMail({
      from: cfg.from,
      to,
      subject: input.subject || 'IzanDesk Notification',
      text: input.text,
      html: input.html,
      attachments: input.attachments,
    });
    return {
      ok: true,
      status: 'SENT',
      messageId: String(info.messageId || ''),
      mode: 'live',
      note: `Email delivered via ${cfg.host}:${cfg.port}`,
    };
  } catch (e: any) {
    const msg = e?.message || String(e);
    return {
      ok: false,
      status: 'FAILED',
      mode: 'error',
      note: 'SMTP email delivery failed',
      error: msg,
    };
  } finally {
    try { transport.close(); } catch { /* ignore */ }
  }
}
