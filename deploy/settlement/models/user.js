const mongoose = require('mongoose');

const userScheme = new mongoose.Schema({
  nick: { type: String, required: true },
  access_key: { type: String, required: true },
  secret_key: { type: String, required: true },
  ip: { type: String, required: true }
},
{
  timestamps: true
});

userScheme.index({ nick: 1, access_key: 1, secret_key: 1 }, { unique: true })

module.exports = mongoose.model('user', userScheme);