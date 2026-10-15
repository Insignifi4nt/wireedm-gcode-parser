import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PackageToolsPage } from './PackageToolsPage';
import '@/components/ui/theme.css';
import './package-tools.css';

createRoot(document.getElementById('root')!).render(<StrictMode><PackageToolsPage /></StrictMode>);
