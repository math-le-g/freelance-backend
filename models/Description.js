// models/Description.js
const mongoose = require('mongoose');

const descriptionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  text: {
    type: String,
    required: true
  },
  frequency: {
    type: Number,
    default: 1
  },
  lastUsed: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Index composé pour rechercher par utilisateur et texte
descriptionSchema.index({ user: 1, text: 1 });

module.exports = mongoose.model('Description', descriptionSchema);

