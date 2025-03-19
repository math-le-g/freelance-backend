const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const prestationSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  client: {
    type: Schema.Types.ObjectId,
    ref: 'Client',
    required: true
  },
  date: {
    type: Date,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  billingType: {
    type: String,
    enum: ['hourly', 'fixed'],
    required: true
  },
  hours: {
    type: Number
  },
  hourlyRate: {
    type: Number
  },
  fixedPrice: {
    type: Number
  },
  quantity: {
    type: Number,
    default: 1
  },
  duration: {
    type: Number,
    default: 0
  },
  durationUnit: {
    type: String,
    enum: ['minutes', 'hours', 'days'],
    default: 'minutes'
  },
  total: {
    type: Number,
    required: true
  },
  invoiceId: {
    type: Schema.Types.ObjectId,
    ref: 'Facture',
    default: null
  },
  invoicePaid: {
    type: Boolean,
    default: false
  },
  // Nouveaux champs pour suivi de rectifications
  isReplaced: {
    type: Boolean,
    default: false
  },
  replacedByPrestationId: {
    type: Schema.Types.ObjectId,
    ref: 'Prestation',
    default: null
  },
  originalPrestationId: {
    type: Schema.Types.ObjectId,
    ref: 'Prestation',
    default: null
  },
  // Nouveaux champs pour accès rapide aux infos de facture
  invoiceStatus: {
    type: String,
    enum: ['draft', 'unpaid', 'paid', 'overdue', 'cancelled', 'RECTIFIEE'],
    default: null
  },
  invoiceIsSentToClient: {
    type: Boolean,
    default: false
  },
  invoiceLocked: {
    type: Boolean,
    default: false
  }
}, 
{ timestamps: true });

module.exports = mongoose.model('Prestation', prestationSchema);



/*
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
  billingType: {
    type: String,
    enum: ['hourly', 'fixed', 'daily'],
    required: true,
    default: 'hourly'
  },
  // Pour facturation horaire
  hours: {
    type: Number,
    required: function () { return this.billingType === 'hourly'; },
    default: 0
  },
  hourlyRate: {
    type: Number,
    required: function () { return this.billingType === 'hourly'; },
    default: 0
  },
  // Pour facturation forfaitaire et journalière
  fixedPrice: {
    type: Number,
    required: function() { return this.billingType === 'fixed' || this.billingType === 'daily'; },
    default: 0,
  },
  quantity: {
    type: Number,
    default: 1,
    min: 1
  },
  duration: {
    type: Number,
    required: function () { return this.billingType !== 'fixed'; }, // requis pour 'hourly' et 'daily'
    default: 0
  },
  // Supprimé durationValue car incohérent et inutilisé
  durationUnit: {
    type: String,
    enum: ['minutes', 'hours', 'days'],
    required: true,
    default: 'minutes'
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
  },
  invoiceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Facture',
    default: null
  },
  invoicePaid: {
    type: Boolean,
    default: false
  },
  
  // Nouveaux champs pour la gestion des rectifications
  
  // Champ pour marquer une prestation comme remplacée par une rectification
  isReplaced: {
    type: Boolean,
    default: false
  },
  
  // Référence à la prestation originale (si c'est une prestation rectificative)
  originalPrestationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Prestation',
    default: null
  },
  
  // Référence à la prestation rectificative (si cette prestation a été remplacée)
  replacedByPrestationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Prestation',
    default: null
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Hook pre-save pour calculer le total
prestationSchema.pre('save', function (next) {
  if (this.billingType === 'hourly') {
    this.total = this.hours * this.hourlyRate;
  } else if (this.billingType === 'fixed') {
    this.total = this.fixedPrice * (this.quantity || 1);
  } else if (this.billingType === 'daily') {
    // Pour 'daily', duration représente le nombre de jours en minutes
    const nbDays = this.duration / 1440; // 1 jour = 1440 minutes
    this.total = nbDays * this.fixedPrice;
  }
  next();
});

// Virtual 'hoursEquivalent' pour afficher la durée de manière cohérente
prestationSchema.virtual('hoursEquivalent').get(function () {
  if (this.billingType === 'hourly') {
    return this.hours || 0;
  } else if (this.billingType === 'daily') {
    return this.duration / 1440 || 0; // Nombre de jours
  }
  return this.duration / 60 || 0; // Pour 'minutes'
});

// Validation personnalisée pour assurer la cohérence entre billingType et durationUnit
prestationSchema.pre('save', function (next) {
  if (this.billingType === 'hourly') {
    this.duration = this.hours * 60; // Convertir les heures en minutes
    this.total = this.hours * this.hourlyRate;
  } else if (this.billingType === 'fixed') {
    this.total = this.fixedPrice * (this.quantity || 1);
  } else if (this.billingType === 'daily') {
    this.total = (this.duration / 1440) * this.fixedPrice;
  }
  next();
});

module.exports = mongoose.model('Prestation', prestationSchema);
*/