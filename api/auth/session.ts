import handler from '../[...path].ts'
import type { IncomingMessage, ServerResponse } from 'node:http'

export default function sessionHandler(
  request: IncomingMessage,
  response: ServerResponse
) {
  return handler(request, response)
}