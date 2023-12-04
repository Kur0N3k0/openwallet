const request = require('node-fetch').default
const { server_url } = require("./config")

module.exports = {
    getIP: function(req) {
        return req.headers["x-real-ip"] || req.connection.remoteAddress
    },
    getWeekStart: function(d) {
        d = new Date(d)
        var day = d.getDay()
        var diff = d.getDate() - day + (day == 0 ? -6:1)
        return new Date(d.setDate(diff))
    },
    getTicker: function(ticker) {
        var url = new URL(server_url + "/v1/ticker")
        url.searchParams.append("markets", ticker.join(","))
        return request(url.toString()).then(resp => resp.json())
    },
    getMarkets: function() {
        return request(server_url + "/v1/market/all").then(resp => resp.json())
    },
    unique: function (arr) { return [...new Set(arr)] }
}