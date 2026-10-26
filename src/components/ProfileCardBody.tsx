import { frameStyle, type ImageFrame } from '../lib/imageFrame'
import type { AvatarShape } from '../lib/profile'
import SessionClock from './SessionClock'
import DefaultAvatar from './DefaultAvatar'

interface ProfileCardBodyProps {
  nickname: string
  avatarUrl?: string | null
  avatarShape?: AvatarShape
  avatarFrame?: ImageFrame
  clockTitle?: string
}

/** Содержимое карточки профиля в сайдбаре: аватарка, ник и таймер сессии (используется и в предпросмотре) */
export default function ProfileCardBody({ nickname, avatarUrl, avatarShape, avatarFrame, clockTitle }: ProfileCardBodyProps) {
  return (
    <>
      <div className={`profile-avatar ${avatarShape === 'square' ? 'square' : ''}`}>
        {avatarUrl ? <img src={avatarUrl} alt="" draggable={false} style={frameStyle(avatarFrame)} /> : <DefaultAvatar seed={nickname} />}
      </div>

      <div className="profile-info">
        <div className="profile-nickname">{nickname}</div>
        <SessionClock className="profile-session" title={clockTitle} />
      </div>
    </>
  )
}
