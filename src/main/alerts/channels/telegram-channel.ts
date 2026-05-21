import type { TelegramConfig } from '../../store/types'

export async function sendTelegramAlert(config: TelegramConfig, message: string): Promise<void> {
  const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: config.chatId,
      text: message,
      parse_mode: 'HTML'
    })
  })
  if (!response.ok) {
    const data = await response.json() as { description?: string }
    throw new Error(`Telegram error: ${data.description || response.status}`)
  }
}

export async function testTelegram(config: TelegramConfig): Promise<{ success: boolean; error?: string }> {
  try {
    await sendTelegramAlert(config, '<b>[monitc]</b> Test mesajı. Bağlantı başarılı.')
    return { success: true }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}
