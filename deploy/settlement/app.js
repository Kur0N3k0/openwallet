const request = require("request-promise")
const uuidv4 = require("uuid/v4")
const sign = require('jsonwebtoken').sign
const { promisify } = require("util");
const redis = require('redis')
const cache = redis.createClient({ host: "openwallet-redis", port: 6379 })
const getAsync = promisify(cache.get).bind(cache);
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

        return request(options)
            .then((wallet) => {
                var mWallet = JSON.parse(wallet)
                return mWallet
            })
    } catch(e) {
        return new Promise((resolve, reject) => {
            reject(new Error("error"))
        })
    }
}

let btc = {}
cache.get("KRW-BTC", (err, info) => {
    btc = JSON.parse(info)
})

let date = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()+1)

User.find({}).then(async users => {
    let proms = users.map((user) => {
        return new Promise(resolve => {
            getWallet(user.access_key, user.secret_key)
            .then(async (wallet) => {
                let filtered = wallet.filter(item => item.currency !== "KRW")
                let krw = wallet.filter(item => item.currency == "KRW")[0]
                let totalBalance = parseFloat(krw.balance) + parseFloat(krw.locked)

                let btcitem = []
                let promises = filtered.map((item) => {
                    return getAsync("KRW-"+item.currency).then((data) => {
                        if(data == null) {
                            btcitem.push(item.currency)
                            return 0
                        }
                        
                        data = JSON.parse(data)
        
                        let balance = parseFloat(item.balance) + parseFloat(item.locked)
                        return balance * data.trade_price
                    })
                })

                let balances = await Promise.all(promises)

                promises = btcitem.map((item) => {
                    return getAsync("BTC-"+item.currency).then((data) => {
                        if(data == null) {
                            return 0
                        }

                        data = JSON.parse(data)

                        let balance = parseFloat(item.balance) + parseFloat(item.locked)
                        return balance * data.trade_price * btc.trade_price
                    })
                })
                
                balances.concat(await Promise.all(promises))
                balances.forEach((item) => {
                    totalBalance += item
                })

                Settlement.create({
                    nick: user.nick,
                    balance: Math.floor(totalBalance),
                    date: date
                })
                .catch(err => console.log(err))
                .finally(_ => resolve())
            })
            .catch((err) => console.log(err))
        })
    })

    await Promise.all(proms)

    process.exit(0)
})