import type { IncomingMessage, ServerResponse } from 'node:http'

export default function handler(
  request: IncomingMessage,
  response: ServerResponse
) {
  response.statusCode = 200
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify({ status: 'API working' }))
}