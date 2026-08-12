import { useState } from 'react'
import { DEBUG_DIAGNOSTICS_SCREEN, type ThemeMode } from './settings/helpers'
import { useI18n } from '../../i18n'
import AppearanceSection from './settings/AppearanceSection'
import PlaybackSection from './settings/PlaybackSection'
import LibrarySection from './settings/LibrarySection'
import SystemSection from './settings/SystemSection'
import ProfileSection from './settings/ProfileSection'
import AboutSection from './settings/AboutSection'
import './SettingsView.css'

type Section = 'appearance' | 'playback' | 'library' | 'system' | 'profile' | 'about'

interface SettingsViewProps {
  currentNickname: string
  onSaveNickname: (nickname: string) => void
  theme?: ThemeMode
  onChangeTheme?: (theme: ThemeMode) => void
  crossfade?: number
  onChangeCrossfade?: (sec: number) => void
  outputDevice?: string
  onChangeOutputDevice?: (id: string) => void
  libraryFolder?: string
  syncMode?: 'auto' | 'manual'
  isScanning?: boolean
  onSelectFolder?: () => void
  onChangeSyncMode?: (mode: 'auto' | 'manual') => void
  onRescan?: () => void
  onClearLibrary?: () => void
  discordRpc?: boolean
  onChangeDiscordRpc?: (v: boolean) => void
}

const navItems: Array<{ id: Section; icon: string }> = [
  {
    id: 'appearance',
    icon: 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z',
  },
  {
    id: 'playback',
    icon: 'M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  },
  {
    id: 'library',
    icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10',
  },
  {
    id: 'system',
    icon: 'M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  },
  {
    id: 'profile',
    icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
  },
  {
    id: 'about',
    icon: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  },
]

const NAV_LABEL_KEYS: Record<Section, string> = {
  appearance: 'settings.nav.appearance',
  playback: 'settings.nav.playback',
  library: 'settings.nav.library',
  system: 'settings.nav.system',
  profile: 'settings.nav.profile',
  about: 'settings.nav.about',
}

export default function SettingsView({
  currentNickname,
  onSaveNickname,
  theme,
  onChangeTheme,
  crossfade,
  onChangeCrossfade,
  outputDevice,
  onChangeOutputDevice,
  libraryFolder,
  syncMode,
  isScanning,
  onSelectFolder,
  onChangeSyncMode,
  onRescan,
  onClearLibrary,
  discordRpc,
  onChangeDiscordRpc,
}: SettingsViewProps) {
  const { t } = useI18n()
  const [activeSection, setActiveSection] = useState<Section>('appearance')

  return (
    <div className="settings-content">

      <div className="settings-nav-sidebar">
        <div className="settings-nav">
          <div className="nav-section-label">{t('settings.nav.main')}</div>
          {navItems.slice(0, 3).map((item) => (
            <button
              key={item.id}
              className={`nav-item ${activeSection === item.id ? 'active' : ''}`}
              onClick={() => setActiveSection(item.id)}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d={item.icon} />
              </svg>
              {t(NAV_LABEL_KEYS[item.id])}
            </button>
          ))}
          <div className="nav-section-label" style={{ marginTop: '16px' }}>
            {t('settings.nav.other')}
          </div>
          {navItems.slice(3).filter((item) => item.id !== 'about' || DEBUG_DIAGNOSTICS_SCREEN).map((item) => (
            <button
              key={item.id}
              className={`nav-item ${activeSection === item.id ? 'active' : ''}`}
              onClick={() => setActiveSection(item.id)}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d={item.icon} />
              </svg>
              {t(NAV_LABEL_KEYS[item.id])}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-main-content">
        <div key={activeSection} className="settings-page">
          {activeSection === 'appearance' && (
            <AppearanceSection theme={theme} onChangeTheme={onChangeTheme} />
          )}
          {activeSection === 'playback' && (
            <PlaybackSection
              crossfade={crossfade}
              onChangeCrossfade={onChangeCrossfade}
              outputDevice={outputDevice}
              onChangeOutputDevice={onChangeOutputDevice}
            />
          )}
          {activeSection === 'library' && (
            <LibrarySection
              libraryFolder={libraryFolder}
              syncMode={syncMode}
              isScanning={isScanning}
              onSelectFolder={onSelectFolder}
              onChangeSyncMode={onChangeSyncMode}
              onRescan={onRescan}
              onClearLibrary={onClearLibrary}
            />
          )}
          {activeSection === 'system' && (
            <SystemSection discordRpc={discordRpc} onChangeDiscordRpc={onChangeDiscordRpc} />
          )}
          {activeSection === 'profile' && (
            <ProfileSection currentNickname={currentNickname} onSaveNickname={onSaveNickname} />
          )}
          {activeSection === 'about' && DEBUG_DIAGNOSTICS_SCREEN && <AboutSection />}
        </div>
      </div>
    </div>
  )
}