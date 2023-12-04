const request = require('node-fetch').default
const uuidv4 = require("uuid").v4
const sign = require('jsonwebtoken').sign
const morgan = require("morgan")
const express = require("express")
const app = express()
const server = require('http').createServer(app)
const io = require('socket.io')(server, { pingInterval: 2000, pingTimeout: 5000 })

const { server_url } = require("./config")
const { setupDB, setupCache } = require("./db")
const { getIP, getTicker, getMarkets, unique } = require("./utils")
const userFactory = require("./factory/user")
const User = require('./models/user')
const Settlement = require('./models/settlement')
const Board = require('./models/board')

setupDB()
const cache = setupCache()

function getWallet(access_key, secret_key) {
    const payload = {
        access_key: access_key,
        nonce: uuidv4(),
    }
    
    try{
        const token = sign(payload, secret_key)
    
        const options = {
            method: "GET",
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

app.use(morgan("combined"))
app.use(express.json())
app.use('/static', express.static(__dirname + '/static'))
app.set('view engine', 'ejs')
app.enable('trust proxy')

app.get("/", (req, res) => {
    res.render("index", {
        title: "Openwallet",
        description: "Reveal your wallet"
    })
})

app.get("/user/:user", (req, res) => {
    const nick = req.params.user
    
    userFactory.getInfo(nick, (err, result) => {
        if(result === null)
            return res.render("error", { msg: "user not found", access_key: "", secret_key: "" })
        
        console.log(result)
        res.render("user", {
            title: `${result.nick}'s Wallet`,
            description: `${result.nick}'s Wallet`,
            user: result
        })
    })
})

app.post("/setup", async (req, res) => {
    const { nick, access_key, secret_key } = req.body
    if(typeof nick !== "string" || typeof access_key !== "string" || typeof secret_key !== "string") {
        return res.json({ error: -2 })
    }

    const ip = getIP(req)
    userFactory.setupUser(access_key, secret_key, { nick, access_key, secret_key, ip })
    .then(data => {
        cache.setEx(`wallet_${nick}`, 3, JSON.stringify(data))
        res.json({ error: 0 })
    })
    .catch(e => {
        console.log(e)
        res.json({ error: -1 })
    })
})

app.post("/remove", (req, res) => {
    const { access_key, secret_key } = req.body
    if(typeof access_key !== "string" || typeof secret_key !== "string") {
        return res.json({ error: -4 })
    }
    userFactory.remove(access_key, secret_key)
        .then(_ => res.json({ error: 0 }))
        .catch(_ => res.json({ error: -3 }))
})

app.get("/ranking/total", (req, res) => {
    let result = []

    userFactory.getAll(async (err, users) => {
        let waits = []
        users.map((user) => {
            waits.push(new Promise((resolve) => {
                userFactory.getSettlements(user, {
                    start: new Date("1970-01-01"),
                    end: new Date()
                }, (err, settlements) => {
                    if (settlements === null) {
                        resolve()
                        return
                    }
    
                    if (settlements.length === 0) {
                        resolve()
                        return
                    }
    
                    // console.log(settlements)
                    const last = settlements[settlements.length - 1]
                    const start = settlements[0]
    
                    const profit = last.balance - start.balance
                    const rate = last.balance >= start.balance ? last.balance / start.balance * 100 - 100 : -(1 - last.balance / start.balance) * 100
                    
                    result.push({ nick: user.nick, total_profit: parseFloat(rate.toFixed(2)), profit: Math.floor(profit) })
                    resolve()
                })
            }))
        })

        await Promise.all(waits)

        result.sort((a, b) => {
            if(a.total_profit < b.total_profit)
                return 1
            if(a.total_profit > b.total_profit)
                return -1
            
            if(a.profit < b.profit)
                return -1
            if(a.profit > b.profit)
                return 1

            if(a.nick < b.nick)
                return -1
            if(a.nick > b.nick)
                return 1
            return 0
        })

        return res.render("ranking", {
            title: "Ranking",
            description: "Profit ranking",
            users: result
        })
    })
})

app.get("/ranking", (req, res) => {
    cache.get("ranking").then(async data => {
        console.log("data:", data)
        if(data !== null && data.length !== 0) {
            return res.render("ranking", {
                title: "Ranking",
                description: "Profit ranking",
                users: JSON.parse(data)
            })
        }

        let tcache = {}
        let wallets = []
        let markets = await getMarkets()
        let upbit_markets = markets.map(ticker => ticker.market)

        User.find({}).exec(async (err, users) => {
            if(users === null) {
                return res.json({ error: -6 })
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
            promises = wallets.map((info) => {
                return new Promise(async (resolve) => {
                    let filtered = info.wallet.filter(item => item.currency != "KRW")
                    let krw = info.wallet.filter(item => item.currency == "KRW")[0]
                    let KRWBalance = parseFloat(krw.balance) + parseFloat(krw.locked)

                    let result = filtered.map(item => {
                        let avg_buy_price = parseFloat(item.avg_buy_price)
                        let balance = parseFloat(item.balance) + parseFloat(item.locked)
        
                        let startPrice = balance * avg_buy_price
                        let afterPrice = balance * tcache[item.unit_currency+"-"+item.currency]
                        if(item.unit_currency === "BTC")
                            afterPrice = afterPrice * BTCprice

                        if(isNaN(afterPrice)) {
                            startPrice = 0
                            afterPrice = 0
                        }

                        return {
                            currency: item.currency,
                            startPrice,
                            afterPrice
                        }
                    })

                    let startBalance = KRWBalance
                    let afterBalance = KRWBalance

                    result.forEach((item) => {
                        startBalance += item.startPrice
                        afterBalance += item.afterPrice
                    })

                    console.log(info.nick, startBalance, afterBalance)

                    var percentage = afterBalance > startBalance ? (afterBalance / startBalance) * 100 - 100 : -(1 - afterBalance / startBalance) * 100
                    resolve({ nick: info.nick, total_profit: parseFloat(percentage.toFixed(2)), profit: Math.floor(afterBalance - startBalance) })
                })
            })

            let result = await Promise.all(promises)

            result.sort((a, b) => {
                if(a.total_profit < b.total_profit)
                    return 1
                if(a.total_profit > b.total_profit)
                    return -1
                
                if(a.profit < b.profit)
                    return -1
                if(a.profit > b.profit)
                    return 1

                if(a.nick < b.nick)
                    return -1
                if(a.nick > b.nick)
                    return 1
                return 0
            })

            cache.setEx("ranking", 60 * 5, JSON.stringify(result))
            res.render("ranking", {
                title: "Ranking",
                description: "Profit ranking",
                users: result
            })
        })
    })
})

app.get("/settlement/:user", (req, res) => {
    const nick = req.params.user

    User.findOne({ nick: nick }).exec((err, result) => {
        if(result !== null) {
            res.render("settlement", {
                title: `${result.nick}'s Settlement`,
                description: `${result.nick}'s Settlement`,
                user: result
            })
        } else {
            res.render("error", { msg: "user not found", access_key: "", secret_key: "" })
        }
    })
})

app.post("/settlement/:user", (req, res) => {
    const user = req.params.user
    const limit = parseInt(req.body.limit)
    const date = new Date(req.body.date)
    date.setHours(0)

    Settlement.find({ nick: user, date: { $lte: date } })
        .limit(limit)
        .sort({ date: 'desc' })
        .then((result) => res.json(result) )
        .catch(err => {
            res.json({ error: -7 })
        })
})

app.get("/kimchi", (req, res) => {
    res.render("premium", {
        title: "Kimchi premium",
        description: "Kimchi premium"
    })
})

app.get("/board", (req, res) => {
    Board.find({}).sort({ 'createdAt': -1 }).exec((err, data) => {
        let board = []
        if(data !== null) {
            board = data
        }
        res.render("board", {
            title: "버그 및 제안",
            description: "버그 제보 및 기능 제안",
            board: board
        })
    })
})

app.get("/board/view/:uuid", (req, res) => {
    const uuid = req.params.uuid
    Board.findOne({ uuid: uuid }).exec((err, data) => {
        if(data == null) {
            return res.render("error", { msg: "content not found", access_key: "", secret_key: "" })
        }
        res.render("board_view", {
            title: data.title,
            description: data.title,
            board: data
        })
    })
})

app.get("/board/write", (req, res) => {
    res.render("board_write", {
        title: "버그 및 기능제안 작성",
        description: "버그 및 기능제안 작성"
    })
})

app.post("/board/write", (req, res) => {
    const ip = getIP(req)
    Board.create({
        uuid: uuidv4(),
        title: req.body.title,
        content: req.body.content,
        nick: req.body.nick,
        checked: false,
        ip: ip
    })
    .then(() => res.json({ error: 0 }))
    .catch(_ => res.json({ error: -1 }))
})

io.sockets.on('connection', (client) => {
    client.on('wallet', (cred) => {
        if(cred === undefined || cred.nick === undefined)
            return

        User.findOne({ nick: cred.nick }).exec((err, result) => {
            if(result !== null) {
                cache.get(`wallet_${cred.nick}`).then((cdata) => {
                    if(err || cdata == null) {
                        getWallet(result.access_key, result.secret_key)
                            .then((data) => {
                                cache.setEx(`wallet_${cred.nick}`, 3, JSON.stringify(data))
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