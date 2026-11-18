/** Two empty credential groups on the ACK cluster plugin page. */
import { useEffect, useRef, useState } from 'react'
import {
  cloudBody,
  credentialUrl,
  gitBody,
  loadStatus,
  parseSave,
  readControlOrigin,
  readJson,
  saveMessage,
  type CredentialStatus,
} from './credentials.ts'

interface Copy {
  cloudTitle: string
  gitTitle: string
  id: string
  secret: string
  token: string
  saveCloud: string
  saveGit: string
  cloudEmpty: string
  gitEmpty: string
  cloudSaved: string
  gitSaved: string
  unavailable: string
  unknown: string
}

function copy(lang: string): Copy {
  if (lang.toLowerCase().startsWith('en')) {
    return {
      cloudTitle: 'Aliyun key',
      gitTitle: 'Git credential',
      id: 'AccessKey ID',
      secret: 'AccessKey Secret',
      token: 'GitHub token',
      saveCloud: 'Save key',
      saveGit: 'Save credential',
      cloudEmpty: 'After saving, cluster actions and cluster watch use this key. This page will not show it again.',
      gitEmpty: 'After saving, code comparison uses this credential. This page will not show it again.',
      cloudSaved: 'Saved. Type the full new value to replace it.',
      gitSaved: 'Saved. Type the full new value to replace it.',
      unavailable: 'Saving is not available.',
      unknown: 'Could not tell whether a value is already saved.',
    }
  }
  return {
    cloudTitle: '阿里云钥匙',
    gitTitle: 'Git 凭证',
    id: 'AccessKey ID',
    secret: 'AccessKey Secret',
    token: 'GitHub token',
    saveCloud: '保存钥匙',
    saveGit: '保存凭证',
    cloudEmpty: '保存后，集群操作和集群通知使用这把钥匙。页面不会再显示它。',
    gitEmpty: '保存后，代码对照使用这把凭证。页面不会再显示它。',
    cloudSaved: '已保存。要更换时填写完整的新值。',
    gitSaved: '已保存。要更换时填写完整的新值。',
    unavailable: '还不能保存。',
    unknown: '还没读到是否已保存。',
  }
}

function clear(fields: Array<HTMLInputElement | null>): void {
  for (const field of fields) {
    if (field) field.value = ''
  }
}

/**
 * Render the Aliyun key and GitHub token groups. Inputs are cleared after every response.
 * @returns the two groups, or nothing when this page has no control-plane origin.
 */
export function CredentialForm() {
  const doc = (globalThis as { document?: Document }).document
  const origin = doc === undefined ? null : readControlOrigin(doc)
  const lang = doc?.documentElement.lang || 'zh'
  const text = copy(lang)
  const idRef = useRef<HTMLInputElement>(null)
  const secretRef = useRef<HTMLInputElement>(null)
  const tokenRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<CredentialStatus | null>(null)
  const [cloudNote, setCloudNote] = useState('')
  const [gitNote, setGitNote] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (origin === null) return undefined
    let gone = false
    void loadStatus(origin).then((next) => {
      if (!gone) setStatus(next)
    })
    return () => {
      gone = true
    }
  }, [origin])

  if (doc === undefined || origin === null) return null
  const page = doc
  const controlOrigin = origin
  const blocked = busy || status?.ready === false

  async function submit(kind: 'cloud' | 'git'): Promise<void> {
    if (blocked) return
    setBusy(true)
    const body = kind === 'cloud'
      ? cloudBody(idRef.current?.value ?? '', secretRef.current?.value ?? '')
      : gitBody(tokenRef.current?.value ?? '')
    const note = kind === 'cloud' ? setCloudNote : setGitNote
    try {
      const response = await fetch(credentialUrl(controlOrigin), {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      })
      const result = parseSave(response.status, await readJson(response))
      note(saveMessage(kind, result, page.documentElement.lang))
      if (result === 'saved') {
        const next = await loadStatus(controlOrigin)
        if (next) setStatus(next)
      }
    } catch {
      note(saveMessage(kind, 'failed', page.documentElement.lang))
    } finally {
      clear([idRef.current, secretRef.current, tokenRef.current])
      setBusy(false)
    }
  }

  const cloudState = status === null
    ? text.unknown
    : status.ready
      ? (status.cloudKey === 'saved' ? text.cloudSaved : text.cloudEmpty)
      : text.unavailable
  const gitState = status === null
    ? text.unknown
    : status.ready
      ? (status.git === 'saved' ? text.gitSaved : text.gitEmpty)
      : text.unavailable

  return <div>
    <form autoComplete="off" onSubmit={(event) => {
      event.preventDefault()
      void submit('cloud')
    }}>
      <h2>{text.cloudTitle}</h2>
      <p>{cloudNote || cloudState}</p>
      <label>{text.id}<input ref={idRef} name="accessKeyId" autoComplete="off" /></label>
      <label>{text.secret}<input ref={secretRef} name="accessKeySecret" type="password" autoComplete="new-password" /></label>
      <button type="submit" disabled={blocked}>{text.saveCloud}</button>
    </form>
    <form autoComplete="off" onSubmit={(event) => {
      event.preventDefault()
      void submit('git')
    }}>
      <h2>{text.gitTitle}</h2>
      <p>{gitNote || gitState}</p>
      <label>{text.token}<input ref={tokenRef} name="token" type="password" autoComplete="new-password" /></label>
      <button type="submit" disabled={blocked}>{text.saveGit}</button>
    </form>
  </div>
}
