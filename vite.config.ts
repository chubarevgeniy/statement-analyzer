import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Полностью статическое приложение: никакого бэкенда. base './' чтобы можно было
// открывать собранный билд из любой папки / поддиректории при пересылке другим людям.
export default defineConfig({
  base: './',
  plugins: [react()],
});
