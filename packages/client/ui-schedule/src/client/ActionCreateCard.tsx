/** Inline card for creating one typed Schedule action. */
import { useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent, ReactNode } from 'react'
import {
  Button, IconChevronDownOutlineRegular, IconClockOutlineRegular, IconCloseOutlineRegular,
  IconInfoOutlineRegular, Input,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ScheduleAutomationOptions } from '@deepseek-ai/dsh-schedule/client'
import { ClockPicker } from './ClockPicker.tsx'
import { TaskMenu } from './TaskMenu.tsx'
import type { TaskMenuItem } from './TaskMenu.tsx'
import css from './ActionCreateCard.module.css'

type Translate = PropsLocale<'schedule.manager'>['t']
type ActionKind = 'cluster-watch' | 'error-budget'
type Destination = ScheduleAutomationOptions['destinations'][number]

export type DestinationDirectoryStatus = 'idle' | 'loading' | 'ready' | 'error'

/** Inputs for the presentational action-creation card. */
export interface ActionCreateCardProps {
  readonly kind: ActionKind
  readonly clusterId: string
  readonly time: string
  readonly destinations: readonly Destination[]
  readonly directoryStatus: DestinationDirectoryStatus
  readonly destinationId: string
  readonly creating: boolean
  readonly createError: boolean
  readonly onClusterIdChange: (value: string) => void
  readonly onTimeChange: (value: string) => void
  readonly onDestinationChange: (value: string) => void
  readonly onRetryDestinations: () => void
  readonly onSubmit: () => void
  readonly onCancel: () => void
  readonly t: Translate
}

function clockLabel(value: string): string {
  return value.slice(0, 5)
}

function DestinationLabel({ destination }: { readonly destination: Destination }): ReactNode {
  return <span className={css.destinationLabel}>
    <span className={css.destinationName}>{destination.ref.label}</span>
    <span className={css.destinationChannel}>{destination.channel}</span>
  </span>
}

/** Render the labelled, responsive form without owning remote calls. */
export function ActionCreateCard(props: ActionCreateCardProps) {
  const {
    kind, clusterId, time, destinations, directoryStatus, destinationId, creating, createError,
    onClusterIdChange, onTimeChange, onDestinationChange, onRetryDestinations, onSubmit, onCancel, t,
  } = props
  const [timeOpen, setTimeOpen] = useState(false)
  const [destinationOpen, setDestinationOpen] = useState(false)
  const timeRef = useRef<HTMLButtonElement>(null)
  const selected = destinations.find(item => item.ref.id === destinationId)
  const cardLabel = t(kind === 'cluster-watch' ? 'action.card.clusterWatch' : 'action.card.errorBudget')
  const items: readonly TaskMenuItem[] = destinations.map(destination => ({
    id: destination.ref.id,
    label: <DestinationLabel destination={destination} />,
  }))
  const canSubmit = directoryStatus === 'ready'
    && destinationId !== ''
    && !creating
    && (kind !== 'cluster-watch' || /^c[a-z0-9]{32}$/u.test(clusterId))

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (canSubmit) onSubmit()
  }

  return <section className={css.card} role="region" aria-label={cardLabel}>
    <div className={css.header}>
      <div>
        <h2>{t(kind === 'cluster-watch' ? 'action.clusterWatch' : 'action.errorBudget')}</h2>
        <p>{t('action.cardDescription')}</p>
      </div>
      <Button type="button" size="sm" className={css.close} aria-label={t('action.close')} onClick={onCancel}>
        <IconCloseOutlineRegular size={14} />
      </Button>
    </div>

    <form onSubmit={submit}>
      <div className={kind === 'cluster-watch' ? css.fieldsCluster : css.fieldsBudget}>
        {kind === 'cluster-watch' && <label className={css.field}>
          <span className={css.fieldLabel}>{t('action.clusterId')}</span>
          <span className={css.input}>
            <Input
              aria-label={t('action.clusterId')}
              placeholder="c…"
              value={clusterId}
              disabled={creating}
              onChange={(event) => { onClusterIdChange(event.target.value) }}
            />
          </span>
        </label>}

        <div className={css.field} onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
          if (event.key !== 'Escape' || !timeOpen) return
          event.stopPropagation()
          setTimeOpen(false)
          timeRef.current?.focus()
        }}>
          <span className={css.fieldLabel}>{t('action.time')}</span>
          <button
            ref={timeRef}
            type="button"
            className={css.control}
            aria-label={t('action.time')}
            aria-haspopup="dialog"
            aria-expanded={timeOpen}
            disabled={creating}
            onClick={() => { setTimeOpen(value => !value); setDestinationOpen(false) }}
          >
            <span className={css.controlLeading}><IconClockOutlineRegular size={15} /></span>
            <span className={css.controlValue}>{t('action.timeValue', { time: clockLabel(time) })}</span>
          </button>
          <ClockPicker
            open={timeOpen}
            anchorRef={timeRef}
            value={time}
            seconds={false}
            onPick={onTimeChange}
            onClose={() => { setTimeOpen(false) }}
            t={t}
          />
        </div>

        <div className={css.field}>
          <span className={css.fieldLabel}>{t('action.destination')}</span>
          <TaskMenu
            open={destinationOpen}
            portal
            items={items}
            selectedId={destinationId || undefined}
            className={css.menuRoot}
            listClassName={css.destinationMenu}
            onSelect={(id) => { onDestinationChange(id); setDestinationOpen(false) }}
            onClose={() => { setDestinationOpen(false) }}
            anchor={<button
              type="button"
              className={css.control}
              aria-label={t('action.destination')}
              aria-haspopup="menu"
              aria-expanded={destinationOpen}
              disabled={creating || directoryStatus !== 'ready' || destinations.length === 0}
              onClick={() => { setDestinationOpen(value => !value); setTimeOpen(false) }}
            >
              <span className={css.controlValue}>
                {selected === undefined
                  ? <span className={css.placeholder}>{t(directoryStatus === 'loading' ? 'action.destinationLoading' : 'action.destinationPlaceholder')}</span>
                  : <DestinationLabel destination={selected} />}
              </span>
              <IconChevronDownOutlineRegular size={13} className={css.chevron} />
            </button>}
          />
          {directoryStatus === 'ready' && destinations.length === 0 && <div className={css.fieldMessage}>
            {t('action.destinationEmpty')}
          </div>}
          {directoryStatus === 'error' && <div className={css.fieldMessage} role="alert">
            <span>{t('action.destinationError')}</span>
            <Button type="button" size="sm" onClick={onRetryDestinations}>{t('action.retry')}</Button>
          </div>}
        </div>
      </div>

      <div className={css.footer}>
        <div className={css.onlineNote}>
          <IconInfoOutlineRegular size={14} />
          <span>{t('action.onlineOnly')}</span>
        </div>
        <div className={css.actions}>
          <Button type="button" size="sm" disabled={creating} onClick={onCancel}>{t('rule.cancel')}</Button>
          <Button type="submit" variant="primary" size="sm" disabled={!canSubmit}>
            {t(creating ? 'action.creating' : 'action.create')}
          </Button>
        </div>
      </div>
      {createError && <div className={css.createError} role="alert">{t('action.createError')}</div>}
    </form>
  </section>
}
