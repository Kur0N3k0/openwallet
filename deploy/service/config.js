module.exports = {
    mongo_uri: process.env.MONGO_URI || 'mongodb://localhost/openwallet',
    server_url: process.env.UPBIT_OPEN_API_SERVER_URL || 'https://api.upbit.com',
    redis_uri: process.env.REDIS_URI || "redis://openwallet-redis:6379"
}