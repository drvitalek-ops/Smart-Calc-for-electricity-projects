import {fileURLToPath} from 'node:url'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
export default defineConfig({plugins:[tailwindcss()],server:{fs:{allow:[fileURLToPath(new URL('..',import.meta.url))]},proxy:{'/api':'http://127.0.0.1:8000'}}})
