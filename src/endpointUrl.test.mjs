import test from 'node:test'
import assert from 'node:assert/strict'
import { apiCompanyOf, apiUrlFor, companySlug } from './endpointUrl.ts'

test('reads the company out of the api.<company>.com/v1 shape', () => {
  assert.equal(apiCompanyOf('https://api.deepseek.com/v1'), 'deepseek')
  assert.equal(apiCompanyOf('https://api.deepseek.com/v1/'), 'deepseek')
  assert.equal(apiCompanyOf(' https://API.Acme.COM/v1 '), 'acme')
  assert.equal(apiCompanyOf('http://api.acme.com/v1'), 'acme')
})

test('leaves URLs that do not fit the shape alone', () => {
  assert.equal(apiCompanyOf(''), null)
  assert.equal(apiCompanyOf('http://localhost:11434/v1'), null)
  assert.equal(apiCompanyOf('https://api.groq.com/openai/v1'), null)
  assert.equal(apiCompanyOf('https://openrouter.ai/api/v1'), null)
  assert.equal(apiCompanyOf('https://api.acme.ai/v1'), null)
})

test('tidies whatever the company field is given', () => {
  assert.equal(companySlug('Acme'), 'acme')
  assert.equal(companySlug('  Acme  '), 'acme')
  assert.equal(companySlug('Acme AI'), 'acmeai')
  assert.equal(companySlug('api.acme.com/v1'), 'acme')
  assert.equal(companySlug('https://api.acme.com/v1'), 'acme')
  assert.equal(companySlug('acme.'), 'acme')
  assert.equal(companySlug('/'), '')
})

test('builds the base URL from a company', () => {
  assert.equal(apiUrlFor('acme'), 'https://api.acme.com/v1')
  assert.equal(apiUrlFor('https://api.acme.com/v1'), 'https://api.acme.com/v1')
  assert.equal(apiUrlFor(''), '')
  assert.equal(apiUrlFor('   '), '')
})
