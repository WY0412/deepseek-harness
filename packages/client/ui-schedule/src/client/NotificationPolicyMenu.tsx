import { useRef, useState } from 'react'
import { IconChevronDownOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { TaskMenu } from './TaskMenu.tsx'
import css from './ActionCreateCard.module.css'

export type NotificationPolicy = 'changes' | 'always'

interface NotificationPolicyMenuProps extends PropsLocale<'schedule.manager'> {
  readonly value: NotificationPolicy
  readonly disabled: boolean
  readonly onChange: (policy: NotificationPolicy) => void
}

export function NotificationPolicyMenu({ value, disabled, onChange, t }: NotificationPolicyMenuProps) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const labels = { changes: t('action.notifyChanges'), always: t('action.notifyAlways') }

  return <div className={css.field} onKeyDown={(event) => {
    if (event.key !== 'Escape' || !open) return
    event.stopPropagation()
    setOpen(false)
    trigger.current?.focus()
  }}>
    <span className={css.fieldLabel}>{t('action.notificationPolicy')}</span>
    <TaskMenu
      open={open && !disabled}
      portal
      className={css.menuRoot}
      listClassName={css.destinationMenu}
      items={[{ id: 'changes', label: labels.changes }, { id: 'always', label: labels.always }]}
      selectedId={value}
      onSelect={(id) => {
        onChange(id === 'always' ? 'always' : 'changes')
        setOpen(false)
      }}
      onClose={() => { setOpen(false) }}
      anchor={<button ref={trigger} type="button" className={css.control} disabled={disabled}
        aria-label={t('action.notificationPolicy')} aria-haspopup="menu" aria-expanded={open && !disabled}
        onClick={() => { setOpen(previous => !previous) }}>
        <span className={css.controlValue}>{labels[value]}</span>
        <IconChevronDownOutlineRegular size={13} className={css.chevron} />
      </button>}
    />
  </div>
}
