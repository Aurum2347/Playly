import { useEffect, useRef, useState } from 'react'
import { appDataDir, join } from '@tauri-apps/api/path'
import { exists, readFile, readTextFile, writeTextFile, writeFile, remove, mkdir } from '@tauri-apps/plugin-fs'
import { open } from '@tauri-apps/plugin-dialog'
import { imageMime } from './helpers'
import { useI18n } from '../../../i18n'

type AvatarShape = 'circle' | 'square'

interface ProfileSettings {
  avatarFile?: string
  avatarShape?: AvatarShape
}

interface ProfileSectionProps {
  currentNickname: string
  onSaveNickname: (nickname: string) => void
}

export default function ProfileSection({ currentNickname, onSaveNickname }: ProfileSectionProps) {
  const { t } = useI18n()
  const [nickname, setNickname] = useState(currentNickname)
  const [isSaved, setIsSaved] = useState(false)
  const [avatarShape, setAvatarShape] = useState<AvatarShape>('circle')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [avatarFile, setAvatarFile] = useState<string | null>(null)
  const [isProfileLoading, setIsProfileLoading] = useState(true)
  const [isSavingAvatar, setIsSavingAvatar] = useState(false)

  const profileDirRef = useRef<string | null>(null)
  const avatarUrlRef = useRef<string | null>(null)

  useEffect(() => {
    setNickname(currentNickname)
  }, [currentNickname])

  const getProfileDir = async () => {
    if (profileDirRef.current) return profileDirRef.current

    const appDir = await appDataDir()
    const playlyDir = await join(appDir, 'playly')
    const profileDir = await join(playlyDir, 'profile')

    await mkdir(profileDir, { recursive: true })

    profileDirRef.current = profileDir
    return profileDir
  }

  const notifyProfileUpdated = () => {
    window.dispatchEvent(new Event('playly-profile-updated'))
  }

  const writeProfile = async (patch: { avatarFile?: string | null; avatarShape?: AvatarShape | null }) => {
    const profileDir = await getProfileDir()
    const profileFile = await join(profileDir, 'profile.json')

    let current: ProfileSettings = {}

    if (await exists(profileFile)) {
      try {
        current = JSON.parse(await readTextFile(profileFile)) as ProfileSettings
      } catch {
        current = {}
      }
    }

    const next: ProfileSettings = { ...current }

    if (patch.avatarShape !== undefined) {
      if (patch.avatarShape === null) delete next.avatarShape
      else next.avatarShape = patch.avatarShape
    }

    if (patch.avatarFile !== undefined) {
      if (patch.avatarFile === null || !patch.avatarFile) delete next.avatarFile
      else next.avatarFile = patch.avatarFile
    }

    await writeTextFile(profileFile, JSON.stringify(next, null, 2))
  }

  useEffect(() => {
    let cancelled = false

    const loadProfile = async () => {
      try {
        const profileDir = await getProfileDir()
        const profileFile = await join(profileDir, 'profile.json')

        if (await exists(profileFile)) {
          const raw = await readTextFile(profileFile)
          const data = JSON.parse(raw) as ProfileSettings

          if (!cancelled) {
            setAvatarShape(data.avatarShape === 'square' ? 'square' : 'circle')
          }

          if (data.avatarFile) {
            const filePath =
              data.avatarFile.includes('/') || data.avatarFile.includes('\\')
                ? data.avatarFile
                : await join(profileDir, data.avatarFile)

            if (await exists(filePath)) {
              const bytes = await readFile(filePath)

              if (!cancelled) {
                if (avatarUrlRef.current) URL.revokeObjectURL(avatarUrlRef.current)

                const url = URL.createObjectURL(
                  new Blob([bytes as unknown as BlobPart], { type: imageMime(filePath) })
                )

                avatarUrlRef.current = url
                setAvatarUrl(url)
                setAvatarFile(data.avatarFile)
              }
            }
          }
        }
      } catch (e) {
        console.error('Ошибка загрузки профиля:', e)
      } finally {
        if (!cancelled) setIsProfileLoading(false)
      }
    }

    loadProfile()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    return () => {
      if (avatarUrlRef.current) URL.revokeObjectURL(avatarUrlRef.current)
    }
  }, [])

  const handleSaveNickname = async () => {
    if (nickname.trim()) {
      setIsSaved(true)
      await onSaveNickname(nickname.trim())
      setTimeout(() => setIsSaved(false), 1500)
    }
  }

  const handleAvatarShapeChange = async (shape: AvatarShape) => {
    setAvatarShape(shape)
    try {
      await writeProfile({ avatarShape: shape })
      notifyProfileUpdated()
    } catch (e) {
      console.error('Ошибка сохранения формы аватарки:', e)
    }
  }

  const handleUploadAvatar = async () => {
    if (isSavingAvatar) return
    setIsSavingAvatar(true)

    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: t('settings.profile.imagesFilter'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
      })

      if (!selected || Array.isArray(selected)) return

      const extRaw = selected.split('.').pop()?.toLowerCase() || 'png'
      const ext = extRaw === 'jpeg' ? 'jpg' : extRaw
      const fileName = `avatar.${ext}`

      const profileDir = await getProfileDir()
      const targetPath = await join(profileDir, fileName)

      const bytes = await readFile(selected)
      await writeFile(targetPath, bytes)

      if (avatarUrlRef.current) URL.revokeObjectURL(avatarUrlRef.current)

      const url = URL.createObjectURL(
        new Blob([bytes as unknown as BlobPart], { type: imageMime(targetPath) })
      )

      avatarUrlRef.current = url
      setAvatarUrl(url)

      const oldFile = avatarFile
      setAvatarFile(fileName)

      await writeProfile({ avatarFile: fileName, avatarShape })
      notifyProfileUpdated()

      if (oldFile && oldFile !== fileName) {
        const oldPath = await join(profileDir, oldFile)
        if (await exists(oldPath)) await remove(oldPath)
      }
    } catch (e) {
      console.error('Ошибка загрузки аватара:', e)
    } finally {
      setIsSavingAvatar(false)
    }
  }

  const handleRemoveAvatar = async () => {
    try {
      const profileDir = await getProfileDir()

      if (avatarFile) {
        const filePath = await join(profileDir, avatarFile)
        if (await exists(filePath)) await remove(filePath)
      }

      if (avatarUrlRef.current) {
        URL.revokeObjectURL(avatarUrlRef.current)
        avatarUrlRef.current = null
      }

      setAvatarUrl(null)
      setAvatarFile(null)

      await writeProfile({ avatarFile: null })
      notifyProfileUpdated()
    } catch (e) {
      console.error('Ошибка удаления аватара:', e)
    }
  }

  return (
    <>
      <h1 className="page-title">{t('settings.profile.title')}</h1>
      <p className="page-subtitle">{t('settings.profile.subtitle')}</p>

      <div className="settings-section">
        <div className="section-title">{t('settings.profile.personal')}</div>

        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-name">{t('settings.profile.nickname')}</div>
            <div className="setting-desc">{t('settings.profile.nicknameDesc')}</div>
          </div>

          <div className="setting-control">
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                type="text"
                className="input-field"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
              />

              <button
                className={`btn ${isSaved ? 'btn-primary' : ''}`}
                onClick={handleSaveNickname}
                style={
                  isSaved
                    ? { background: 'var(--success)', color: 'var(--bg)', borderColor: 'var(--success)' }
                    : {}
                }
              >
                {isSaved ? t('common.saved') : t('common.save')}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <div className="section-title">{t('settings.profile.avatar')}</div>

        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-name">{t('settings.profile.avatarImage')}</div>
            <div className="setting-desc">{t('settings.profile.avatarDesc')}</div>
          </div>

          <div className="setting-control">
            <div className="avatar-row">
              <div className={`avatar shape-${avatarShape}`}>
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt={t('settings.profile.avatarImage')}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                )}
              </div>

              <div className="avatar-actions">
                <button
                  className="btn"
                  onClick={handleUploadAvatar}
                  disabled={isSavingAvatar || isProfileLoading}
                  style={isSavingAvatar || isProfileLoading ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  {isSavingAvatar ? t('common.loading') : t('settings.profile.upload')}
                </button>

                <button
                  className="btn btn-ghost"
                  onClick={handleRemoveAvatar}
                  disabled={!avatarUrl || isSavingAvatar || isProfileLoading}
                  style={!avatarUrl || isSavingAvatar || isProfileLoading ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
                >
                  {t('settings.profile.remove')}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-name">{t('settings.profile.shape')}</div>
            <div className="setting-desc">{t('settings.profile.shapeDesc')}</div>
          </div>

          <div className="setting-control">
            <div className="radio-group">
              <label className="radio-option">
                <input
                  type="radio"
                  name="avatarShape"
                  value="circle"
                  checked={avatarShape === 'circle'}
                  onChange={() => handleAvatarShapeChange('circle')}
                />
                <span className="radio-dot"></span>
                <span className="radio-label">{t('settings.profile.circle')}</span>
              </label>

              <label className="radio-option">
                <input
                  type="radio"
                  name="avatarShape"
                  value="square"
                  checked={avatarShape === 'square'}
                  onChange={() => handleAvatarShapeChange('square')}
                />
                <span className="radio-dot"></span>
                <span className="radio-label">{t('settings.profile.square')}</span>
              </label>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}