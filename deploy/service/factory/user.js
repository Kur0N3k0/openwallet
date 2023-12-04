const request = require('node-fetch').default
const uuidv4 = require("uuid").v4
const sign = require('jsonwebtoken').sign
const User = require('../models/user')
const Settlement = require('../models/settlement')
const { setupCache } = require("../db")
const { server_url } = require("../config")

const mod = {
    getAll: (callback) => User.find({}).exec(callback),
    getInfo: (nick, callback) => User.findOne({ nick: nick }).exec(callback),
    getWallet: (access_key, secret_key) => {
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
            console.log(e)
            return new Promise((resolve, reject) => {
                reject(new Error("error"))
            })
        }
    },
    setupUser: async (access_key, secret_key, user) => {
        const wallet = await mod.getWallet(access_key, secret_key)
        return User.create({
            nick: user.nick,
            access_key: user.access_key,
            secret_key: user.secret_key,
            ip: user.ip
        })
        .then(_ => mod.snapshotWallet(user, wallet))
        .then(_ => wallet)
    },
    remove: (access_key, secret_key) => {
        return User.findOneAndRemove({
            access_key: access_key,
            secret_key: secret_key
        })
    },
    snapshotWallet: async (user, wallet) => {
        const cache = setupCache()
        let date = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())
        let filtered = wallet.filter(item => item.currency !== "KRW")
        let krw = wallet.filter(item => item.currency == "KRW")[0]
        let totalBalance = parseFloat(krw.balance) + parseFloat(krw.locked)

        let btcitem = []
        let promises = filtered.map((item) => {
            return cache.get("KRW-"+item.currency).then((data) => {
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
            return cache.get("BTC-"+item.currency).then((data) => {
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
            date
        })
        .catch(err => console.log(err))
    },
    getSettlements: (user, range, callback) => Settlement.find({
        nick: user.nick, date: { $gte: range.start, $lte: range.end }
    }).sort({ createdAt: 'asc' }).exec(callback),
}

module.exports = mod