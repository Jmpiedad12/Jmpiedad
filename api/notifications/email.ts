import nodemailer from 'nodemailer'

const emailConfigurationError = (message: string) => Object.assign(new Error(message), { status: 503 })

export const sendEmailNotification = async (to: string, subject: string, text: string) => {
  const host = process.env.SMTP_HOST || 'smtp.gmail.com'
  const port = Number(process.env.SMTP_PORT || 465)
  const user = process.env.SMTP_USER
  const password = process.env.SMTP_PASS
  const from = process.env.SMTP_FROM || user

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw emailConfigurationError('SMTP_PORT must be a valid port number.')
  }
  if (!user || !password || !from) {
    throw emailConfigurationError('Email notifications are not configured. Set SMTP_USER and SMTP_PASS.')
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass: password },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  })

  try {
    await transporter.sendMail({ from, to, subject, text })
  } catch (error) {
    console.error('Google SMTP email delivery failed:', error)
    throw emailConfigurationError('Google SMTP could not send the email. Check SMTP_USER, SMTP_PASS, SMTP_HOST, and SMTP_PORT.')
  }
}
