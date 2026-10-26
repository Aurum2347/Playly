import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { getCurrentWindow } from '@tauri-apps/api/window'
import './index.css'
import '@fontsource/noto-color-emoji'

/* Одна сборка на два окна: главное и мини-плеер у трея (его метка — «mini») */
const isMini = (() => {
  try {
    return getCurrentWindow().label === 'mini'
  } catch {
    return false
  }
})()

if (isMini) {
  /* Окно прозрачное: скруглённые углы рисует сам мини-плеер */
  document.documentElement.classList.add('mini-window')
  document.documentElement.style.backgroundColor = 'transparent'
}

/* Мини-плееру не нужен код всего приложения — грузим только своё.
   Это точка входа, горячая замена модулей ей не нужна. */
// eslint-disable-next-line react-refresh/only-export-components
const Root = lazy(() => (isMini ? import('./mini/MiniApp') : import('./App')))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>
      <Root />
    </Suspense>
  </StrictMode>,
)
