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
    required: function () { return this.billingType === 'hourly' },
    default: 0
  },
  hourlyRate: {
    type: Number,
    required: function () { return this.billingType === 'hourly' },
    default: 0
  },
  // Pour facturation forfaitaire
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
    default: 0
  },
  durationValue: {
    type: Number,
    default: '',
  },
  durationUnit: {
    type: String,
    enum: ['minutes', 'hours', 'days'],
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
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

prestationSchema.pre('save', function (next) {
  if (this.billingType === 'hourly') {
    this.total = this.hours * this.hourlyRate;
  } else if (this.billingType === 'fixed') {
    // Forfait : quantity × prix unitaire
    this.total = this.fixedPrice * (this.quantity || 1);
  } else if (this.billingType === 'daily') {
    // "Journalier" => this.duration = total minutes => nb de jours = duration / (24*60)
    const nbDays = this.duration / (24 * 60); // ex: 3 jours => 3 * 24 * 60 = 4320
    // total = prix × nbDays
    this.total = nbDays * this.fixedPrice;
  }
  next();
});

prestationSchema.virtual('hoursEquivalent').get(function () {
  if (this.billingType === 'hourly') {
    return this.hours || 0;
  }
  return this.duration ? this.duration / 60 : 0;
});

module.exports = mongoose.model('Prestation', prestationSchema);

