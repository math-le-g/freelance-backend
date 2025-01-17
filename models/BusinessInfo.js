const mongoose = require('mongoose');

const BusinessInfoSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: { type: String, required: true },
  address: { type: String, required: true },
  postalCode: { type: String, required: true },
  city: { type: String, required: true },
  phone: { type: String, required: true },
  email: { type: String, required: true },
  siret: { type: String, required: true },
  companyType: { type: String, required: true },
  invoiceTitle: { // Ajout du champ
    type: String,
    default: '', // Valeur par défaut
  },
  invoiceNumberStart: {
    type: Number,
    default: 1, // Numéro de départ par défaut
    required: true,
  },
  currentInvoiceNumber: {
    type: Number,
    default: 0, // Sera mis à jour lors de la création des factures
    required: true,
  },
  features: {
    invoiceStatus: {
      enabled: { type: Boolean, default: false },
      paymentDelay: { type: Number, default: 30 } // délai de paiement en jours
    },
    automaticReminders: {
      enabled: { type: Boolean, default: false },
      firstReminder: { type: Number, default: 7 }, // jours après échéance
      secondReminder: { type: Number, default: 15 },
      thirdReminder: { type: Number, default: 30 }
    },
  },
  displayOptions: {
    showDueDateOnInvoice: { type: Boolean, default: true },
    showDueDateInHistory: { type: Boolean, default: true },
    showTvaComment: { type: Boolean, default: false }
  },
}, { timestamps: true });

module.exports = mongoose.model('BusinessInfo', BusinessInfoSchema);