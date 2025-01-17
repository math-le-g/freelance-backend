const mongoose = require('mongoose');

const clientSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: true,
  },
  street: {
    type: String,
  },
  postalCode: {
    type: String,
  },
  city: {
    type: String,
  },
});

// Créer un index composé pour l'unicité par utilisateur
clientSchema.index({ user: 1, email: 1 }, { unique: true });

const Client = mongoose.model('Client', clientSchema);
module.exports = Client;
