import { hasURL } from '~/utils/urlChecks'

test('hasURL', () => {
  expect(hasURL('this is my personal website: https://www.example.com')).toBe(true)
  expect(hasURL('#corngang')).toBe(false)
  expect(hasURL('Unislap-LP.org')).toBe(true)
  expect(hasURL('https://swap.gno.now')).toBe(true)
  expect(hasURL('https://www.example.org')).toBe(true)
  expect(hasURL('http://swap.gno.now')).toBe(true)
  expect(hasURL('http://username:password@swap.gno.now')).toBe(true)
  expect(hasURL('http://app.example.org')).toBe(true)
  expect(hasURL('username:password@app.example.org:22')).toBe(true)
  expect(hasURL('swap.gno.now:80')).toBe(true)
  expect(hasURL('asdf swap.gno.now:80 asdf')).toBe(true)
})
