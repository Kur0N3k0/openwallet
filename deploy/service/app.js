const request = require('request-promise')
const uuidv4 = require("uuid/v4")
const sign = require('jsonwebtoken').sign
const morgan = require("morgan")
const express = require("express")
const app = express()
const server = require('http').createServer(app)
const io = require('socket.io')(server, { pingInterval: 2000, pingTimeout: 5000 })
const redis = require('redis')
const cache = redis.createClient({ host: "openwallet-redis", port: 6379 })
const mongoose = require('mongoose')

const User = require('./models/user')

const server_url = process.env.UPBIT_OPEN_API_SERVER_URL || 'https://api.upbit.com'
const mongo_uri = process.env.MONGO_URI || 'mongodb://localhost/openwallet'

mongoose.Promise = global.Promise

mongoose.connect(mongo_uri, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('Successfully connected to mongodb'))
  .catch(e => console.error(e))

function getIP(req) {
    return req.headers["x-real-ip"] || req.connection.remoteAddress
}

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

app.use(morgan("combined"))
app.use(express.json())
app.use('/static', express.static(__dirname + '/static'))
app.set('view engine', 'ejs')
app.enable('trust proxy')

app.get("/", (req, res) => {
    res.render("index")
})

app.get("/user/:user", (req, res) => {
    const nick = req.params.user
    User.findOne({ nick: nick }).exec((err, result) => {
        if(result !== null) {
            res.render("user", { user: result })
        } else {
            res.render("error", { msg: "user not found", access_key: "", secret_key: "" })
        }
    })
})

app.post("/setup", (req, res) => {
    if(typeof req.body.nick === "string" &&
        typeof req.body.access_key === "string" &&
        typeof req.body.secret_key === "string"
    ){
        const ip = getIP(req)
        getWallet(req.body.access_key, req.body.secret_key)
        .then((data) => {
            User.create({
                nick: req.body.nick,
                access_key: req.body.access_key,
                secret_key: req.body.secret_key,
                ip: ip
            })
            .then(_ => {
                cache.setex(`wallet_${req.body.nick}`, 3, JSON.stringify(data))
                res.json({ error: 0 })
            })
            .catch(_ => res.json({ error: -1 }))
        })
        .catch((err) => {
            res.json({ error: -5 })
        })
    }
    else res.json({ error: -2 })
})

app.post("/remove", (req, res) => {
    if(typeof req.body.access_key === "string" &&
        typeof req.body.secret_key === "string"
    ){
        User.findOneAndRemove({
            access_key: req.body.access_key,
            secret_key: req.body.secret_key
        }).then(_ => res.json({ error: 0 }))
        .catch(_ => res.json({ error: -3 }))
    }
    else res.json({ error: -4 })
})

app.get("/ranking", (req, res) => {
    cache.get("ranking", (err, data) => {
        if(data !== null) {
            return res.render("ranking", { users: JSON.parse(data) })
        }

        let wallets = []
        User.find({}).exec(async (err, users) => {
            if(users === null) {
                res.json({ error: -6 })
                return
            }

            let promises = users.map(async (user) => {
                const { nick, access_key, secret_key } = user
                return getWallet(access_key, secret_key)
                    .then((wallet) => {
                        wallets.push({ nick, wallet })
                    })
                    .catch((err) => {
                        console.log(err)
                    })
            })

            await Promise.all(promises)

            promises = wallets.map((info) => {
                return new Promise(async (resolve) => {
                    let filtered = info.wallet.filter(item => item.currency != "KRW")
                    let krw = info.wallet.filter(item => item.currency == "KRW")[0]
                    let KRWBalance = parseFloat(krw.balance) + parseFloat(krw.locked)

                    let prom = filtered.map((item) => {
                        return new Promise(resolve => {
                            cache.get("KRW-"+item.currency, (err, data) => {
                                if(data == null) {
                                    resolve({ currency: item.currency, startPrice: 0, afterPrice: 0 })
                                    return
                                }
                                
                                data = JSON.parse(data)

                                let avg_buy_price = parseFloat(item.avg_buy_price)
                                let balance = parseFloat(item.balance) + parseFloat(item.locked)
                
                                let startPrice = balance * avg_buy_price
                                let afterPrice = balance * data.trade_price
                
                                resolve({ currency: item.currency, startPrice, afterPrice })
                            })
                        })
                    })

                    let result = await Promise.all(prom)
                    let BTCprice = 0

                    BTCprice = await new Promise(resolve => {
                        cache.get("KRW-BTC", (err, btc) => {
                            btc = JSON.parse(btc)
                            resolve(btc.trade_price)
                        })
                    })

                    prom = filtered.map((item) => {
                        return new Promise(resolve => {
                            cache.get("BTC-"+item.currency, (err, data) => {
                                if(data == null) {
                                    resolve({ currency: item.currency, startPrice: 0, afterPrice: 0 })
                                    return
                                }
                                
                                data = JSON.parse(data)
        
                                result.forEach((x) => {
                                    if(x.currency == item.currency){
                                        if(x.startPrice == 0) {
                                            let avg_buy_price = parseFloat(item.avg_buy_price)
                                            let balance = parseFloat(item.balance) + parseFloat(item.locked)
                            
                                            let startPrice = balance * avg_buy_price
                                            let afterPrice = balance * data.trade_price * BTCprice
                            
                                            resolve({ currency: item.currency, startPrice, afterPrice })
                                        } else {
                                            resolve({ currency: item.currency, startPrice: 0, afterPrice: 0 })
                                        }
                                    }
                                })

                            })
                        })
                    })

                    let result2 = await Promise.all(prom)
                    
                    let startBalance = KRWBalance
                    let afterBalance = KRWBalance

                    result.forEach((item) => {
                        startBalance += item.startPrice
                        afterBalance += item.afterPrice
                    })
                    
                    result2.forEach((item) => {
                        startBalance += item.startPrice
                        afterBalance += item.afterPrice
                    })

                    var percentage = afterBalance > startBalance ? (afterBalance / startBalance) * 100 - 100 : -(1 - afterBalance / startBalance) * 100
                    resolve({ nick: info.nick, total_profit: parseFloat(percentage.toFixed(2)) })
                })
            })

            let result = await Promise.all(promises)

            result.sort((a, b) => {
                if(a.total_profit < b.total_profit)
                    return 1
                if(a.total_profit > b.total_profit)
                    return -1
                
                if(a.total_profit == b.total_profit) {
                    if(a.nick < b.nick)
                        return -1
                    if(a.nick > b.nick)
                        return 1
                    return 0
                }
                return 0
            })

            cache.setex("ranking", 60 * 30, JSON.stringify(result))
            res.render("ranking", { users: result })
        })
    })
})

io.sockets.on('connection', (client) => {
    client.on('wallet', (cred) => {
        if(cred === undefined || cred.nick === undefined)
            return

        User.findOne({ nick: cred.nick }).exec((err, result) => {
            if(result !== null) {
                cache.get(`wallet_${cred.nick}`, (err, cdata) => {
                    if(err || cdata == null) {
                        getWallet(result.access_key, result.secret_key)
                            .then((data) => {
                                cache.setex(`wallet_${cred.nick}`, 3, JSON.stringify(data))
                                client.emit('wallet', data)
                            })
                            .catch((err) => {
                                client.emit('error')
                            })
                        return
                    }
                    const data = JSON.parse(cdata)
                    client.emit('wallet', data)
                })
            } else {
                client.emit('error', { msg: "user not found" })
            }
        })
    })
})

server.listen(3000, "0.0.0.0", () => {
    console.log("[*] openwallet service started")
})