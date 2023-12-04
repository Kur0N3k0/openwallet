const mongoose = require('mongoose')
const redis = require('redis')
const { mongo_uri, redis_uri } = require("./config")
var cache = null

mongoose.Promise = global.Promise

function setupDB() {
    if(mongoose.connection.readyState === 0) {
        mongoose.connect(mongo_uri, { useNewUrlParser: true, useUnifiedTopology: true })
        .then(() => console.log('Successfully connected to mongodb'))
        .catch(e => console.error(e))
    }
}

function setupCache() {
    if(cache === null || cache.isOpen === false) {
        cache = redis.createClient({ url: redis_uri })
        cache.connect()
    }
    return cache
}

module.exports = {
    setupDB,
    setupCache
}