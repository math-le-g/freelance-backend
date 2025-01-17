const mongoose = require('mongoose');

const prestationSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  client: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: true,
  },
  description: {
    type: String,
    required: true,
  },
  hours: {
    type: Number,
    required: true,
    default: 0,
  },
  hourlyRate: {
    type: Number,
    required: true,
    default: 0,
  },
  total: {
    type: Number,
    required: true,
    default: 0,
  },
  date: {
    type: Date,
    required: true,
    default: Date.now,
  },//////////////////////////////////////////////////////////////////////////////////
  invoiceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Facture',
    default: null
  },
  invoicePaid: {
    type: Boolean,
    default: false
  },///////////////////////////////////////////////////////////////////////////////////
},
  {
    timestamps: true,
  });

module.exports = mongoose.model('Prestation', prestationSchema);

