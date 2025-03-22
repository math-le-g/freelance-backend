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
  taxeURSSAF: {
    type: Number,
    default: 0.246,
  },
  tauxTVA: {
    type: Number,
    default: 0.20, // 20%
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
  // NOUVEAU: Ajout du schéma pour les messages légaux et commentaires personnalisés
  legalMessages: {
    enableLatePaymentComment: {
      type: Boolean,
      default: false
    },
    latePaymentText: {
      type: String,
      default: "Tout retard de paiement entraînera une indemnité forfaitaire pour frais de recouvrement de 40 euros (Article L441-10 du Code de commerce)."
    },
    enableCustomComment: {
      type: Boolean,
      default: false
    },
    customCommentText: {
      type: String,
      default: ""
    }
  },
  // Champ existant pour le préfixe d'avoir
  prefixeAvoir: {
    type: String,
    default: "A"
  }
}, { timestamps: true });

module.exports = mongoose.model('BusinessInfo', BusinessInfoSchema);




/*
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
  taxeURSSAF: {
    type: Number,
    default: 0.246,
  },
  tauxTVA: {
    type: Number,
    default: 0.20, // 20%
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
*/