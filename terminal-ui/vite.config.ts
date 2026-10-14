import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({plugins:[react()],base:'/terminal-ui/',build:{outDir:'dist',assetsDir:'assets',sourcemap:false,rollupOptions:{output:{manualChunks:(id:string)=>id.includes('/echarts/')||id.includes('/zrender/')?'charts':id.includes('/motion/')||id.includes('/framer-motion/')?'motion':undefined}}}});
