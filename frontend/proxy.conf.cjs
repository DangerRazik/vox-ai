// Browser /api/v1 -> backend /v1. Override the target before starting ng serve.
module.exports = {
  '/api/**': {
    target: process.env.VOX_API_TARGET || 'http://127.0.0.1:8000',
    changeOrigin: true,
    pathRewrite: { '^/api': '' },
  },
};
