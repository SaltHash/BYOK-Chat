import test from 'node:test'
import assert from 'node:assert/strict'

const {
  BLANK_IMAGE_GEN, IMAGE_SIZES, normImageGen, buildImagesUrl, mimeOfB64, imageSrc,
  imageRefsFrom, imageRefsFromRounds, generateImages, imageSummary,
} = await import('./imagegen.ts')

const ep = { id: 'e1', name: 'OpenAI', type: 'openai', url: 'https://api.example.com/v1/', key: 'sk-test', model: 'gpt-image-1', on: true }

const jsonResponse = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

test('image preferences normalize size, count, and flags', () => {
  assert.deepEqual(normImageGen(undefined), BLANK_IMAGE_GEN)
  assert.equal(normImageGen({ on: true, size: 'nope' }).size, BLANK_IMAGE_GEN.size)
  assert.equal(normImageGen({ on: 1 }).on, false)
  assert.equal(normImageGen({ count: 99 }).count, 4)
  assert.equal(normImageGen({ count: 0 }).count, 1)
  assert.ok(IMAGE_SIZES.some(([s]) => s === '1024x1024'))
})

test('the images URL sits beside chat completions on the same base', () => {
  assert.equal(buildImagesUrl('https://api.example.com/v1/'), 'https://api.example.com/v1/images/generations')
  assert.equal(buildImagesUrl('  '), '/images/generations')
})

test('base64 mime sniffing and src building', () => {
  assert.equal(mimeOfB64('iVBORw0KGgo'), 'image/png')
  assert.equal(mimeOfB64('/9j/4AAQ'), 'image/jpeg')
  assert.equal(mimeOfB64('unknown'), 'image/png')
  assert.match(imageSrc({ b64: 'iVBORw0KGgo' }), /^data:image\/png;base64,/)
  assert.equal(imageSrc({ url: 'https://cdn.example/x.png' }), 'https://cdn.example/x.png')
})

test('image references are found in results and tool rounds', () => {
  assert.deepEqual(imageRefsFrom('done [image:img-abc] and [image:img-abc] and [image:img-def_2]'), ['img-abc', 'img-def_2'])
  assert.deepEqual(imageRefsFrom('[image:bad id]'), [])
  assert.deepEqual(imageRefsFromRounds([
    { calls: [{ result: '[image:img-a]' }, { result: 'nothing' }] },
    { calls: [{ result: '[image:img-b] [image:img-a]' }] },
  ]), ['img-a', 'img-b'])
})

test('generation posts a b64 request and keeps both b64 and url results', async () => {
  const calls = []
  const fetchFn = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers })
    return jsonResponse(200, { data: [
      { b64_json: '/9j/4AAQ', revised_prompt: 'a cat' },
      { url: 'https://cdn.example/x.png' },
      { nothing: true },
    ] })
  }
  const images = await generateImages(ep, 'gpt-image-1', 'a cat', { size: '512x512', count: 2 }, fetchFn)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://api.example.com/v1/images/generations')
  assert.equal(calls[0].headers.authorization, 'Bearer sk-test')
  assert.deepEqual(calls[0].body, { model: 'gpt-image-1', prompt: 'a cat', n: 2, size: '512x512', response_format: 'b64_json' })
  assert.deepEqual(images, [
    { b64: '/9j/4AAQ', mime: 'image/jpeg', revised: 'a cat' },
    { url: 'https://cdn.example/x.png' },
  ])
})

test('a server that rejects response_format gets one retry without it', async () => {
  const bodies = []
  const fetchFn = async (_url, init) => {
    const body = JSON.parse(init.body)
    bodies.push(body)
    if ('response_format' in body) return jsonResponse(400, { error: { message: "Unsupported parameter: 'response_format' is not supported with this model." } })
    return jsonResponse(200, { data: [{ url: 'https://cdn.example/y.png' }] })
  }
  const images = await generateImages(ep, 'flux-1', 'a dog', {}, fetchFn)
  assert.equal(images.length, 1)
  assert.equal(bodies.length, 2)
  assert.ok('response_format' in bodies[0])
  assert.ok(!('response_format' in bodies[1]))
})

test('provider errors surface their own message and anthropic is refused', async () => {
  const fetchFn = async () => jsonResponse(403, { error: { message: 'model not enabled for this organization' } })
  await assert.rejects(() => generateImages(ep, 'gpt-image-1', 'x', {}, fetchFn), /model not enabled/)
  await assert.rejects(() => generateImages({ ...ep, type: 'anthropic' }, 'x', 'x', {}, fetchFn), /OpenAI-compatible/)
  await assert.rejects(() => generateImages(ep, 'x', '   ', {}, fetchFn), /Provide a prompt/)
  const empty = async () => jsonResponse(200, { data: [] })
  await assert.rejects(() => generateImages(ep, 'x', 'x', {}, empty), /no images/)
})

test('the model-facing summary never contains image data', () => {
  const text = imageSummary([{ b64: 'iVBORw0KGgo' }, { url: 'https://x' }], '1024x1024')
  assert.match(text, /Generated 2 images at 1024x1024/)
  assert.ok(!text.includes('iVBORw0KGgo'))
})
