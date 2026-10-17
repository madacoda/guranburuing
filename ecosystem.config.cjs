/**
 * PM2 Ecosystem Configuration for Granblue Fantasy Remote Controller
 *
 * Runs the Discord Remote Command Gateway and 05:00 JST Autonomous Scheduler 24/7 on your VPS.
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 *   pm2 startup
 */

module.exports = {
  apps: [
    {
      name: 'gbf-controller',
      script: 'src/cli/run-discord-controller.ts',
      interpreter: 'bun',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        APP_ENV: 'production',
        HEADLESS: 'true',
        AUTO_LAUNCH_CHROME: 'true',
      },
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      kill_timeout: 5000,
    }
  ]
};
