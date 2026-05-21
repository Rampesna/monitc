import nodemailer from 'nodemailer'
import type { SmtpConfig } from '../../store/types'

export async function sendSmtpAlert(config: SmtpConfig, subject: string, body: string, recipients: string[]): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.username,
      pass: config.password
    }
  })

  await transporter.sendMail({
    from: config.fromAddress,
    to: recipients.join(', '),
    subject,
    text: body,
    html: `<pre style="font-family:monospace">${body}</pre>`
  })
}

export async function testSmtp(config: SmtpConfig): Promise<{ success: boolean; error?: string }> {
  try {
    await sendSmtpAlert(config, '[monitc] Test E-postası', 'Bu bir test e-postasıdır. monitc bağlantısı başarılı.', [config.fromAddress])
    return { success: true }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}
