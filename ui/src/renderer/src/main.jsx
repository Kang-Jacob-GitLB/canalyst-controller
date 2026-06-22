import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Pretendard 폰트는 index.css 의 @font-face 에서 woff2 만 번들(레거시 woff 제외).
import App from './App'
import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
