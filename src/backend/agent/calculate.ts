const MAX_LENGTH = 200

export function calculate(expression: string): number {
  if (expression.length > MAX_LENGTH) throw new Error('Expression is too long.')
  const tokens = expression.replace(/,/g, '').match(/\d+(?:\.\d+)?(?:e[+-]?\d+)?|[-+*/%^()]|\S/gi) ?? []
  let index = 0

  const peek = () => tokens[index]
  const take = () => tokens[index++]

  function primary(): number {
    const token = take()
    if (token === '(') {
      const value = sum()
      if (take() !== ')') throw new Error('Missing closing parenthesis.')
      return value
    }
    if (token === '-') return -primary()
    if (token === '+') return primary()
    if (token !== undefined && /^\d/.test(token)) return Number(token)
    throw new Error(`Unexpected ${token === undefined ? 'end of expression' : `"${token}"`}.`)
  }

  function power(): number {
    const base = primary()
    if (peek() === '^') {
      take()
      return base ** power()
    }
    return base
  }

  function product(): number {
    let value = power()
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const operator = take()
      const right = power()
      value = operator === '*' ? value * right : operator === '/' ? value / right : value % right
    }
    return value
  }

  function sum(): number {
    let value = product()
    while (peek() === '+' || peek() === '-') {
      value = take() === '+' ? value + product() : value - product()
    }
    return value
  }

  const result = sum()
  if (index < tokens.length) throw new Error(`Unexpected "${peek()}".`)
  if (!Number.isFinite(result)) throw new Error('The result is not a finite number.')
  return result
}
