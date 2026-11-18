// @vitest-environment jsdom
/** The form posts to the control plane and clears every typed value after the response. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { CredentialForm } from '../src/client/CredentialForm.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  document.head.innerHTML = ''
  document.documentElement.lang = 'zh'
})

function origin(value: string): void {
  const meta = document.createElement('meta')
  meta.name = 'dsh-control-origin'
  meta.content = value
  document.head.appendChild(meta)
}

it('posts the key to the control origin and clears the inputs', async () => {
  origin('https://dshk8syw.com')
  const calls: Array<{ url: string; init?: RequestInit | undefined }> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    if (init?.method === 'POST') {
      return new Response(JSON.stringify({ ok: true, cloudKey: 'saved', accessKeySecret: 'secret-value-16b' }), { status: 200 })
    }
    const saved = calls.some(call => call.init?.method === 'POST')
    return new Response(JSON.stringify({
      ready: true,
      cloudKey: saved ? 'saved' : 'missing',
      git: 'missing',
      accessKeySecret: 'secret-value-16b',
    }), { status: 200 })
  }))

  render(<CredentialForm />)
  await waitFor(() => expect(screen.getByText('保存后，集群操作和集群通知使用这把钥匙。页面不会再显示它。')).toBeTruthy())
  expect(calls[0]).toMatchObject({ url: 'https://dshk8syw.com/user-credentials', init: { credentials: 'include' } })
  expect(calls[0]?.init?.method).toBeUndefined()

  fireEvent.change(screen.getByLabelText('AccessKey ID'), { target: { value: 'LTAIabcdefghijklmnop' } })
  fireEvent.change(screen.getByLabelText('AccessKey Secret'), { target: { value: 'secret-value-16b' } })
  fireEvent.click(screen.getByRole('button', { name: '保存钥匙' }))

  await waitFor(() => expect(screen.getByText('已保存')).toBeTruthy())
  const posted = calls.find(call => call.init?.method === 'POST')
  expect(posted?.url).toBe('https://dshk8syw.com/user-credentials')
  expect(posted?.init?.credentials).toBe('include')
  expect(posted?.init?.headers).toEqual({ 'content-type': 'application/x-www-form-urlencoded' })
  expect(posted?.init?.body).toBe('kind=cloud&accessKeyId=LTAIabcdefghijklmnop&accessKeySecret=secret-value-16b')
  expect(screen.getByLabelText('AccessKey ID')).toHaveProperty('value', '')
  expect(screen.getByLabelText('AccessKey Secret')).toHaveProperty('value', '')
  expect(screen.getByLabelText('GitHub token')).toHaveProperty('value', '')
  expect(document.body.textContent).not.toContain('secret-value-16b')
})

it('says the save did not happen and still clears the token', async () => {
  origin('https://dshk8syw.com')
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return new Response(JSON.stringify({ error: 'origin', token: 'ghp_example' }), { status: 403 })
    return new Response(JSON.stringify({ ready: true, cloudKey: 'missing', git: 'missing' }), { status: 200 })
  }))
  render(<CredentialForm />)
  await screen.findByText('保存后，代码对照使用这把凭证。页面不会再显示它。')
  fireEvent.change(screen.getByLabelText('GitHub token'), { target: { value: 'ghp_example' } })
  fireEvent.click(screen.getByRole('button', { name: '保存凭证' }))
  await screen.findByText('这次没保存')
  expect(screen.getByLabelText('GitHub token')).toHaveProperty('value', '')
  expect(document.body.textContent).not.toContain('ghp_example')
})

it('renders nothing without a control origin', () => {
  const { container } = render(<CredentialForm />)
  expect(container.textContent).toBe('')
})

it('presents each credential as a named form with an associated status', async () => {
  origin('https://dshk8syw.com')
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    ready: true,
    cloudKey: 'saved',
    git: 'missing',
  }), { status: 200 })))

  render(<CredentialForm />)

  const cloud = await screen.findByRole('form', { name: '阿里云钥匙' })
  const git = screen.getByRole('form', { name: 'Git 凭证' })
  expect(cloud.getAttribute('aria-describedby')).toBe('ack-cloud-state')
  expect(git.getAttribute('aria-describedby')).toBe('ack-git-state')
  expect(document.getElementById('ack-cloud-state')?.getAttribute('role')).toBe('status')
  expect(document.getElementById('ack-git-state')?.getAttribute('role')).toBe('status')
})
