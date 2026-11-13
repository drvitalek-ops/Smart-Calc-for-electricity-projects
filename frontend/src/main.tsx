import {installRussianValidation} from "./errors";
import React from 'react'
import {createRoot} from 'react-dom/client'
import App from './App'
import AppErrorBoundary from './AppErrorBoundary'
import './style.css'
import './Workbench.css'
import './QuotationRows.css'
installRussianValidation(document);
createRoot(document.getElementById('root')!).render(<React.StrictMode><AppErrorBoundary><App/></AppErrorBoundary></React.StrictMode>)
