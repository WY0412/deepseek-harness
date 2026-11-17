/** Credential requests stay on the control-plane origin and never keep a typed value. */
import { readFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'
import { apply as hostApply } from '../src/index.ts'
import { apply } from '../src/client/index.ts'
import {
  ACK_BUNDLE,
  cloudBody,
  credentialUrl,
  gitBody,
  parseSave,
  parseStatus,
  readControlOrigin,
  saveMessage,
} from '../src/client/credentials.ts'

it('reads only an https control origin and builds the two form bodies', () => {
  expect(readControlOrigin(undefined)).toBeNull()
  expect(readControlOrigin({ querySelector: () => null })).toBeNull()
  expect(readControlOrigin({ querySelector: () => ({ getAttribute: () => 'http://dshk8syw.com' }) })).toBeNull()
  expect(readControlOrigin({
    querySelector: () => ({ getAttribute: () => 'https://dshk8syw.com' }),
  })).toBe('https://dshk8syw.com')
  expect(credentialUrl('https://dshk8syw.com')).toBe('https://dshk8syw.com/user-credentials')
  expect(cloudBody('LTAIabcdefghijklmnop', 'secret-value-16b')).toBe(
    'kind=cloud&accessKeyId=LTAIabcdefghijklmnop&accessKeySecret=secret-value-16b',
  )
  expect(gitBody('ghp_example')).toBe('kind=git&token=ghp_example')
  expect(parseStatus(200, { ready: true, cloudKey: 'saved', git: 'missing', accessKeySecret: 'nope' })).toEqual({
    ready: true, cloudKey: 'saved', git: 'missing',
  })
  expect(parseStatus(200, { ready: true, cloudKey: 'secret-value-16b', git: 'missing' })).toBeNull()
  expect(parseSave(200, { ok: true, cloudKey: 'saved' })).toBe('saved')
  expect(parseSave(400, { error: 'invalid', token: 'ghp_example' })).toBe('invalid')
  expect(parseSave(403, { error: 'origin' })).toBe('failed')
  expect(parseSave(500, { error: 'unavailable' })).toBe('unavailable')
  expect(saveMessage('cloud', 'invalid', 'zh')).toBe('阿里云钥匙格式不对')
  expect(saveMessage('git', 'invalid', 'zh')).toBe('Git 凭证格式不对')
  expect(saveMessage('cloud', 'unavailable', 'zh')).toBe('还不能保存')
  expect(saveMessage('git', 'failed', 'en')).toBe('Not saved')
})

it('registers the ACK plugin slot only when the control origin meta exists', () => {
  const registered: Array<{ key?: string }> = []
  const ctx = {
    slots: {
      inject(_name: string, run: () => (() => void) | undefined) {
        run()
      },
      register(options: { key?: string }) {
        registered.push(options)
        return () => {}
      },
    },
  }
  apply(ctx as never)
  expect(registered).toEqual([])

  vi.stubGlobal('document', {
    querySelector: () => ({ getAttribute: () => 'https://dshk8syw.com' }),
  })
  try {
    apply(ctx as never)
    expect(registered).toEqual([{ name: 'plugins.bundle.config', key: ACK_BUNDLE }])
  } finally {
    vi.unstubAllGlobals()
  }
  expect(hostApply()).toBeUndefined()
})

it('keeps the credential form out of the optional ACK bundle patch', () => {
  const patch = readFileSync(new URL('../../../experimental/ack-mcp-bundle/cordis.patch.yml', import.meta.url), 'utf8')
  const web = readFileSync(new URL('../../../bundle/web-app/cordis.patch.yml', import.meta.url), 'utf8')
  expect(patch).toContain('mcp-ack')
  expect(patch).toContain('http://dsh-ack-mcp.dsh.svc:8000/mcp')
  expect(patch).not.toContain('ui-ack-credentials')
  expect(patch).not.toContain('user-credentials')
  expect(web).toContain('id: ui-ack-credentials')
  expect(web).toContain('@deepseek-ai/dsh-client-ui-ack-credentials')
})
