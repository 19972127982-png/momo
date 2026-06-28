import './assets/main.css'

import { createRoot } from 'react-dom/client'
import App from './App'

// W1：先不开 StrictMode —— pixi-live2d-display + PIXI canvas 的 dev 双挂载会撕掉 WebGL ctx
// W2+ 把 PetCanvas 改成 idempotent init 之后再开
createRoot(document.getElementById('root')!).render(<App />)
