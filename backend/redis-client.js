const redis = require('redis');

const client = redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

client.on('error', (err) => {
  console.error('Redis Client Error:', err);
});

client.on('connect', () => {
  console.log('✓ Connected to Redis');
});

async function connect() {
  if (!client.isOpen) {
    await client.connect();
  }
  return client;
}

module.exports = { client, connect };
