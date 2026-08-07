import React from 'react';
import ReactDOM from 'react-dom/client';
import { DockApp } from './DockApp';
import { TooltipHost } from '@/components/Tooltip';
import '../styles/tokens.css';
import './dock.css';

ReactDOM.createRoot(document.getElementById('dock-root')!).render(
  <React.StrictMode>
    <DockApp />
    <TooltipHost />
  </React.StrictMode>,
);
