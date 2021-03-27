const request = require('request-promise')
const uuidv4 = require("uuid/v4")
const wsClient = require('ws')
const redis = require('redis')
const cache = redis.createClient({ host: "openwallet-redis", port: 6379 })

const server_url = process.env.UPBIT_OPEN_API_SERVER_URL || 'https://api.upbit.com'
const server_wss = process.env.UPBIT_OPEN_API_SERVER_WSS || 'wss://api.upbit.com/websocket/v1'

const upbit = {
    getMarkets: function() {
        const options = {
            method: "GET",
            url: server_url + "/v1/market/all"
        }
        
        return request(options)
            .then((markets) => {
                const result = JSON.parse(markets)
                return result.map((item) => item["market"])
            })
            .catch((error) => {
                console.log(error)
                return error
            })
    },

    connectToGetQuotations: function(markets) {
        const socket = new wsClient(server_wss)

        socket.on("open", () => {
            console.log(`[*] upbit quotation service connected`)
            setInterval(() => {
                socket.send(JSON.stringify([
                    { "ticket": uuidv4() },
                    {
                        "type": "ticker",
                        "codes": markets,
                        "isOnlySnapshot":true
                    }
                ]))
            }, 1000)
        })
        
        socket.on('message', (data) => {
            const result = JSON.parse(Buffer.from(data).toString())
            cache.set(result.code, JSON.stringify(result))
        })
        
        socket.on('ping', () => {
            socket.emit('pong')
        })
    },

    init: function() {
        this.getMarkets()
            .then((markets) => this.connectToGetQuotations(markets))
            .catch((err) => { console.log(err) })
    }
}

upbit.init()