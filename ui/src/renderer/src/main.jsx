import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Spotify CircularSp 대용으로 Figtree(가변) 번들 — 오프라인 동작, 미설치 시 시스템 폰트로 폴백
import '@fontsource-variable/figtree'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
