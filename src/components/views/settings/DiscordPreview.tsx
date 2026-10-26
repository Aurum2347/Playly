import type { ReactNode } from 'react'
import { useI18n } from '../../../i18n'
import type { DiscordParts } from '../../../lib/discord'
import Logo from '../../Logo'

/* Пример трека для предпросмотра */
const SAMPLE = { title: 'Midnight City', artist: 'M83', album: "Hurry Up, We're Dreaming" }

/* Блок, который плавно схлопывается по высоте, а не исчезает рывком */
function Reveal({ show, children, className }: { show: boolean; children: ReactNode; className?: string }) {
  return (
    <div className={`rpc-reveal ${show ? '' : 'off'} ${className ?? ''}`} aria-hidden={!show}>
      <div className="rpc-reveal-inner">{children}</div>
    </div>
  )
}

/** Как будет выглядеть статус в профиле Discord при выбранных настройках (пример во время воспроизведения) */
export default function DiscordPreview({ parts }: { parts: DiscordParts }) {
  const { t } = useI18n()
  const details = parts.title ? SAMPLE.title : t('discord.privateTitle')
  const state = parts.artist ? `${t('discord.author')}: ${SAMPLE.artist}` : 'Playly'
  const links = parts.buttons && parts.title && parts.artist

  return (
    <div className="rpc-preview" aria-label={t('settings.system.discordPreview')}>
      <div className="rpc-preview-label">{t('settings.system.discordPreview')}</div>
      <div className="rpc-card">
        <div className="rpc-card-head">
          {/* key: при смене текста старый плавно сменяется новым */}
          <span key={parts.title ? 'title' : 'app'} className="rpc-swap">
            {t('settings.system.discordListening', { name: parts.title ? SAMPLE.title : 'Playly' })}
          </span>
        </div>
        <div className="rpc-card-body">
          <div className={`rpc-card-art ${parts.album ? 'has-album' : ''}`} title={parts.album ? SAMPLE.album : 'Playly'}>
            <Logo style={{ width: 30, height: 27, color: '#fff' }} />
          </div>
          <div className="rpc-card-text">
            <div key={details} className={`rpc-card-details rpc-swap ${links ? 'link' : ''}`}>{details}</div>
            <div key={state} className={`rpc-card-state rpc-swap ${parts.buttons && parts.artist ? 'link' : ''}`}>{state}</div>
            <Reveal show={parts.album}>
              <div className="rpc-card-album">{SAMPLE.album}</div>
            </Reveal>
          </div>
        </div>
        <Reveal show={parts.progress}>
          <div className="rpc-card-progress">
            <span>1:24</span>
            <div className="rpc-card-bar"><i /></div>
            <span>4:03</span>
          </div>
        </Reveal>
        <Reveal show={parts.buttons}>
          <div className="rpc-card-buttons">
            <span>GitHub</span>
            <Reveal show={links}>
              <span>{t('discord.search')}</span>
            </Reveal>
          </div>
        </Reveal>
      </div>
    </div>
  )
}
