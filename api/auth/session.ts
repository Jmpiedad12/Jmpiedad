import handler from '../api-handler.js'
import type { IncomingMessage, ServerResponse } from 'node:http'

export default function sessionHandler(
  request: IncomingMessage,
  response: ServerResponse
) {
  return handler(request, response)
}