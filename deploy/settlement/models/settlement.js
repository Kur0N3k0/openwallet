const mongoose = require('mongoose');

const settlementScheme = new mongoose.Schema({
    nick: { type: String, required: true },
    balance: { type: Number, required: true },
    date: { type: Date, required: true }
},
{
    timestamps: true
});

module.exports = mongoose.model('settlement', settlementScheme);