const cron = require('node-cron')

const request = require("node-fetch").default
const uuidv4 = require("uuid").v4
const sign = require('jsonwebtoken').sign
const { promisify } = require("util");
const redis = require('redis')
const cache = redis.createClient({ url: "redis://openwallet-redis:6379" })
cache.connect()

const mongoose = require('mongoose')

const User = require('./models/user')
const Settlement = require('./models/settlement')

const server_url = process.env.UPBIT_OPEN_API_SERVER_URL || 'https://api.upbit.com'
const mongo_uri = process.env.MONGO_URI || 'mongodb://localhost/openwallet'

mongoose.Promise = global.Promise

mongoose.connect(mongo_uri, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('Successfully connected to mongodb'))
  .catch(e => console.error(e))

function getWallet(access_key, secret_key) {
    const payload = {
        access_key: access_key,
        nonce: uuidv4(),
    }

    try{
        const token = sign(payload, secret_key)

        const options = {
            method: "GET",
            url: server_url + "/v1/accounts",
            headers: {Authorization: `Bearer ${token}`},
        }

        return request(server_url + "/v1/accounts", options)
            .then((resp) => resp.json())
    } catch(e) {
        return new Promise((resolve, reject) => {
            reject(new Error("error"))
        })
    }
}

function getMarkets() {
    return request(server_url + "/v1/market/all").then(resp => resp.json())
}

function getTicker(ticker) {
    var url = new URL(server_url + "/v1/ticker")
    url.searchParams.append("markets", ticker.join(","))
    return request(url.toString()).then(resp => resp.json())
}

function unique(arr) {
    return [...new Set(arr)]
}

async function work() {
    let date = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())

    let tcache = {}
    let wallets = []
    let markets = await getMarkets()
    let upbit_markets = markets.map(ticker => ticker.market)

    User.find({}).then(async users => {
        let proms = users.map(async (user) => {
            const { nick, access_key, secret_key } = user
            return getWallet(access_key, secret_key)
                .then((wallet) => {
                    wallets.push({ nick, wallet })
                })
                .catch((err) => {
                    console.log(err)
                })
        })

        await Promise.all(proms)
        
        let currencys = []
        wallets.map(info => {
            info.wallet.filter(info => info.currency !== "KRW").map(item => {
                if(upbit_markets.indexOf(item.unit_currency+"-"+item.currency) === -1)
                    return

                currencys.push(item.unit_currency+"-"+item.currency)
                if(item.currency !== "BTC" && upbit_markets.indexOf("BTC-"+item.currency) !== -1) {
                    currencys.push("BTC-"+item.currency)
                }
            })
        })
        currencys = unique(currencys)
        let tickers = await getTicker(currencys)
        tickers.map(resp => {
            tcache[resp.market] = resp.trade_price
        })

        let BTCprice = tcache["KRW-BTC"]
        wallets.map(info => {
            let filtered = info.wallet.filter(item => item.currency != "KRW")
            let krw = info.wallet.filter(item => item.currency == "KRW")[0]
            let KRWBalance = parseFloat(krw.balance) + parseFloat(krw.locked)

            let result = filtered.map(item => {
                let balance = parseFloat(item.balance) + parseFloat(item.locked)

                let afterPrice = balance * tcache[item.unit_currency+"-"+item.currency]
                if(item.unit_currency === "BTC")
                    afterPrice = afterPrice * BTCprice

                if(isNaN(afterPrice)) {
                    afterPrice = 0
                }

                return afterPrice
            })

            result.forEach((item) => {
                KRWBalance += item
            })

            Settlement.create({
                nick: info.nick,
                balance: Math.floor(KRWBalance),
                date: date
            })
            .catch(err => console.log(err))
        })
    })
}

cron.schedule('0 0 0 * * *', async () => {
    console.log("[*] start settlement")

    work()
})

work()

// console.log("wow")
// getDeposit("I63Fhbxui4KGL5XXd4Zv27xWiNvr8BNlkHGGcehS", "c1MeK5E8hEBwWKck9wuuJ5aimlKp6XytqvKW462e").then(res => console.log(res))