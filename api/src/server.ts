import { buildApp } from './app.js';

const app = buildApp();
const port = Number(process.env.PORT ?? 3000);

// 0.0.0.0 is required for the app to be reachable from inside a container
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`API listening on port ${port}`);
});

server.on('error', (err) => {
  console.error(err);
  process.exit(1);
});