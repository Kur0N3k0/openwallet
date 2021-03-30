const mongoose = require('mongoose');

const boardScheme = new mongoose.Schema({
  uuid: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  content: { type: String, required: true },
  nick: { type: String, required: true },
  checked: { type: Boolean, required: true },
  ip: { type: String, required: true }
},
{
  timestamps: true
});

module.exports = mongoose.model('board', boardScheme);