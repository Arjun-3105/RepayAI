import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import fs from 'fs'

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    {
      name: 'serve-data-files',
      configureServer(server) {
        const files = [
          ['/api/summary.json',             '../summary.json'],
          ['/api/audit_log.jsonl',          '../audit_log.jsonl'],
          ['/api/refund_batch.json',        '../refund_data/refund_test.json'],
          ['/api/refund_summary.json',      '../refund_data/refund_summary.json'],
          ['/api/refund_train.json',        '../refund_data/refund_train.json'],
          ['/api/refund_val.json',          '../refund_data/refund_val.json'],
          ['/api/synthetic_batch.json',     '../data/synthetic_batch.json'],
          ['/api/razorpay_summary.json',    '../data/razorpay_summary.json'],
          ['/api/razorpay_customers.json',  '../data/razorpay_customers.json'],
          ['/api/razorpay_orders.json',     '../data/razorpay_orders.json'],
          ['/api/razorpay_mandate_events.json', '../data/razorpay_mandate_events.json'],
        ]
        files.forEach(([route, rel]) => {
          server.middlewares.use(route, (req, res) => {
            const fp = path.resolve(import.meta.dirname, rel)
            if (fs.existsSync(fp)) {
              const isJson = fp.endsWith('.json')
              res.setHeader('Content-Type', isJson ? 'application/json' : 'text/plain')
              res.setHeader('Cache-Control', 'no-cache')
              res.end(fs.readFileSync(fp, 'utf-8'))
            } else {
              res.statusCode = 404
              res.end('{}')
            }
          })
        })
      },
    },
  ],
  server: { port: 5173, host: true },
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
})
