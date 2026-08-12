import { useState } from 'react'
import { appDataDir, join } from '@tauri-apps/api/path'
import { writeTextFile, mkdir } from '@tauri-apps/plugin-fs'
import { useI18n } from '../i18n'
import './Onboarding.css'
import Logo from './Logo'

interface OnboardingProps {
  onComplete: (nickname: string) => void
}

export default function Onboarding({ onComplete }: OnboardingProps) {
  const { t } = useI18n()
  const [step, setStep] = useState<'welcome' | 'profile'>('welcome')
  const [nickname, setNickname] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const handleContinue = async () => {
    if (!nickname.trim()) return
    setIsSaving(true)
    try {
      const appDir = await appDataDir()
      const playlyDir = await join(appDir, 'playly')
      const userFile = await join(playlyDir, 'user.json')
      try {
        await mkdir(playlyDir, { recursive: true })
      } catch (e) {
      }
      await writeTextFile(userFile, JSON.stringify({ nickname: nickname.trim() }, null, 2))
      onComplete(nickname.trim())
    } catch (error) {
      console.error('Ошибка сохранения профиля:', error)
      alert(t('onboarding.saveError'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="onboarding-overlay">
      <div className="splash-bg"></div>
      {step === 'welcome' && (
        <div className="screen active">
          <div className="container">
            <div className="card">
              <Logo
                style={{
                  width: 92,
                  height: 81,
                  color: 'var(--text)',
                  marginBottom: 16,
                }}
              />
              <div className="title">{t('onboarding.welcomeTitle')}</div>
              <div className="subtitle subtitle-long">{t('onboarding.welcomeText')}</div>
              <button className="btn btn-primary" onClick={() => setStep('profile')}>
                {t('onboarding.continue')}
              </button>
            </div>
          </div>
        </div>
      )}
      {step === 'profile' && (
        <div className="screen active">
          <div className="container">
            <div className="card">
              <div className="welcome-text">
                {t('onboarding.welcomeName', { name: nickname || t('onboarding.nickname') })}
              </div>
              <div className="embed-card">
                <svg className="embed-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                  <path d="M7 11V7a5 5 0 0110 0v4"/>
                </svg>
                <div className="embed-text">
                  <strong>{t('onboarding.embedStrong')}</strong>
                  {t('onboarding.embedText')}
                  <strong>{t('onboarding.embedStrong2')}</strong>
                  {t('onboarding.embedSuffix')}
                </div>
              </div>
              <div className="input-group">
                <label className="input-label" htmlFor="nicknameInput">
                  {t('onboarding.nickname')}
                </label>
                <input 
                  type="text" 
                  className="input-field" 
                  id="nicknameInput" 
                  placeholder={t('onboarding.nicknamePlaceholder')}
                  autoComplete="off"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleContinue()}
                />
              </div>
              <button 
                className="btn btn-primary" 
                onClick={handleContinue}
                disabled={!nickname.trim() || isSaving}
              >
                {isSaving ? t('onboarding.saving') : t('onboarding.continue')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}