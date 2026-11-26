import nodemailer from 'nodemailer'

export const sendEmailNotification = async (to: string, subject: string, text: string) => {
  const host = process.env.SMTP_HOST || 'smtp.gmail.com'
  const port = Number(process.env.SMTP_PORT || 465)
  const user = process.env.SMTP_USER
  const password = process.env.SMTP_PASS
  const from = process.env.SMTP_FROM || user

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('SMTP_PORT must be a valid port number.')
  }
  if (!user || !password || !from) {
    throw new Error('Email notifications are not configured. Set SMTP_USER and SMTP_PASS.')
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass: password },
  })

  await transporter.sendMail({ from, to, subject, text })
}
