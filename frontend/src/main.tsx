import {installRussianValidation} from "./errors";
import React from 'react'
import {createRoot} from 'react-dom/client'
import App from './App'
import AppErrorBoundary from './AppErrorBoundary'
import './design-system/tokens.css'
import './style.css'
import './Workbench.css'
import './QuotationRows.css'
import './AuditFixes.css'
import './VisualRefresh.css'
installRussianValidation(document);
createRoot(document.getElementById('root')!).render(<React.StrictMode><AppErrorBoundary><App/></AppErrorBoundary></React.StrictMode>)
