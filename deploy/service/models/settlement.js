const mongoose = require('mongoose');

const settlementScheme = new mongoose.Schema({
    nick: { type: String, required: true },
    balance: { type: Number, required: true },
    date: { type: Date, required: true }
},
{
    timestamps: true
});

settlementScheme.index({ nick: 1, date: 1 }, { unique: true })

module.exports = mongoose.model('settlement', settlementScheme);