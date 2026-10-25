import type { AiErrorCode } from '../../shared/ai'

export class AiError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'AiError'
  }
}

export function toAiError(cause: unknown): AiError {
  if (cause instanceof AiError) return cause
  return new AiError('failed', cause instanceof Error ? cause.message : 'Something went wrong.')
}
