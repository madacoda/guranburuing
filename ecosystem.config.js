module.exports = {
  apps: [
    {
      name: 'gbf-daemon',
      script: './node_modules/tsx/dist/cli.mjs',
      args: 'src/index.ts',
      cwd: 'C:/laragon/www/gbf',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '350M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        HOST: '0.0.0.0',
        AUTH_TOKEN: 'gbf_secure_remote_token_2026_x89a1',
        CDP_PORT: 9222
      },
      error_file: './logs/error.log',
      out_file: './logs/app.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    }
  ]
};
