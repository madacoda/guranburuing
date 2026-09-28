module.exports = {
  apps: [
    {
      name: 'gbf-daemon',
      script: './src/index.ts',
      interpreter: 'bun',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '350M',
      env: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 3000,
        HOST: process.env.HOST || '0.0.0.0',
        AUTH_TOKEN: process.env.AUTH_TOKEN || '',
        CDP_PORT: process.env.CDP_PORT || 9222
      },
      error_file: './logs/error.log',
      out_file: './logs/app.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    }
  ]
};
