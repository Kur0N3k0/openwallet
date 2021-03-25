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
        User.create({
            nick: req.body.nick,
            access_key: req.body.access_key,
            secret_key: req.body.secret_key,
            ip: ip
        })
        .then(_ => res.json({ error: 0 }))
        .catch(_ => res.json({ error: -1 }))
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

io.sockets.on('connection', (client) => {
    client.on('quotation', (markets) => {
        markets.forEach((market) => {
            cache.get(`KRW-${market}`, (err, data) => {
                if(data !== null) {
                    client.emit('message', JSON.parse(data))
                }
            })
        })
    })

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