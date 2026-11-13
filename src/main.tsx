import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { getCurrentWindow } from '@tauri-apps/api/window'
import './index.css'
import '@fontsource/noto-color-emoji'
import { installTooltips } from './lib/tooltips'

/* Одна сборка на четыре окна: главное, мини-плеер у трея («mini»), меню трея («traymenu») и уведомление («notice») */
const label = (() => {
  try {
    return getCurrentWindow().label
  } catch {
    return 'main'
  }
})()
const isMini = label === 'mini'
const isTrayMenu = label === 'traymenu'
const isNotice = label === 'notice'

if (isMini || isTrayMenu || isNotice) {
  /* Окно прозрачное: скруглённые углы рисует сам мини-плеер / меню / уведомление */
  document.documentElement.classList.add(isMini ? 'mini-window' : isTrayMenu ? 'tray-window' : 'notice-window')
  document.documentElement.style.backgroundColor = 'transparent'
}

/* Подсказки при наведении в стиле Playly (вместо системных) - в главном окне и мини-плеере */
if (!isTrayMenu && !isNotice) installTooltips()

/* Мини-плееру и меню трея не нужен код всего приложения — грузим только своё.
   Отдельные import(), а не один с «?:» внутри: сборщик склеивал такой вызов в один и подгружал
   мини-плееру стили главного окна вместо его собственных (в релизе мини-плеер был без оформления).
   Это точка входа, горячая замена модулей ей не нужна. */
// eslint-disable-next-line react-refresh/only-export-components
const MiniRoot = lazy(() => import('./mini/MiniApp'))
// eslint-disable-next-line react-refresh/only-export-components
const TrayMenuRoot = lazy(() => import('./tray/TrayMenu'))
// eslint-disable-next-line react-refresh/only-export-components
const MainRoot = lazy(() => import('./App'))
// eslint-disable-next-line react-refresh/only-export-components
const NoticeRoot = lazy(() => import('./notice/NoticeApp'))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>
      {isMini ? <MiniRoot /> : isTrayMenu ? <TrayMenuRoot /> : isNotice ? <NoticeRoot /> : <MainRoot />}
    </Suspense>
  </StrictMode>,
)
