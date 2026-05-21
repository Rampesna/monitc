import type { WhatsAppConfig } from '../../store/types'

export async function sendWhatsAppAlert(config: WhatsAppConfig, message: string, recipients: string[]): Promise<void> {
  for (const recipient of recipients) {
    if (config.provider === 'twilio') {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`
      const body = new URLSearchParams({
        From: `whatsapp:${config.phoneNumber}`,
        To: `whatsapp:${recipient}`,
        Body: message
      })
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: body.toString()
      })
      if (!response.ok) {
        const text = await response.text()
        throw new Error(`Twilio error: ${response.status} ${text}`)
      }
    } else if (config.provider === 'custom' && config.apiUrl) {
      const response = await fetch(config.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.authToken}`
        },
        body: JSON.stringify({ to: recipient, message })
      })
      if (!response.ok) {
        throw new Error(`WhatsApp API error: ${response.status}`)
      }
    }
  }
}

export async function testWhatsApp(config: WhatsAppConfig): Promise<{ success: boolean; error?: string }> {
  try {
    await sendWhatsAppAlert(config, '[monitc] Test mesajı. Bağlantı başarılı.', [config.phoneNumber])
    return { success: true }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}
