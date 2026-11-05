import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './ui/App.tsx'
import { loadCachedVersionsIntoMemory } from './logic/SourceCache'

loadCachedVersionsIntoMemory().catch(err =>
  console.warn('Failed to load cached versions:', err)
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)