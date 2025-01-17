const mongoose = require('mongoose');

const FactureSchema = new mongoose.Schema({
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
  // Date choisie pour la facture (différente du createdAt)
  dateFacture: {
    type: Date,
    required: true,
  },
  // Champs relatifs aux prestations sont gérés via la référence 'prestations'
  prestations: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Prestation',
    }
  ],

  // Montants
  montantHT: {
    type: Number,
    required: true,
    default: 0,
  },
  taxeURSSAF: {
    type: Number,
    required: true,
    default: 0,
  },
  montantNet: {
    type: Number,
    required: true,
    default: 0,
  },
  montantTVA: {
    type: Number,
    required: true,
    default: 0,
  },
  montantTTC: {
    type: Number,
    required: true,
    default: 0,
  },
  nombreHeures: {
    type: Number,
    required: true,
    default: 0,
  },

  // Numéro de facture
  invoiceNumber: {
    type: Number,
    required: true,
    unique: true,
    index: true,
  },

  // Année et Mois de la facture
  year: {
    type: Number,
    required: true,
  },
  month: {
    type: Number,
    required: true,
  },

  // Date d'échéance
  dateEcheance: {
    type: Date,
    required: true,
  },

  // Statut
  status: {
    type: String,
    enum: ['unpaid', 'paid', 'overdue'],
    default: 'unpaid',
    index: true,
  },

  // Chemin du PDF généré
  pdfPath: {
    type: String,
  },

  // Historique de rappels
  rappels: [
    {
      type: {
        type: String,
        enum: ['premier', 'deuxieme', 'troisieme'],
      },
      date: {
        type: Date,
        default: Date.now,
      },
      status: {
        type: String,
        enum: ['sent', 'failed'],
        default: 'sent',
      },
    },
  ],

  // Historique des paiements
  historiquePaiements: [
    {
      date: {
        type: Date,
        default: Date.now,
      },
      montant: {
        type: Number,
        required: true,
      },
      methode: {
        type: String,
        required: true,
      },
      commentaire: {
        type: String,
      },
    },
  ],

  // Historique des versions de la facture
  versions: [
    {
      date: { type: Date, default: Date.now },
      client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },
      dateFacture: Date,
      montantHT: Number,
      taxeURSSAF: Number,
      montantNet: Number,
      montantTTC: Number,
      nombreHeures: Number,
      changesComment: String, // Motif de la rectification
    },
  ],

  // Détails du paiement
  methodePaiement: {
    type: String,
  },
  commentairePaiement: {
    type: String,
  },
  datePaiement: {
    type: Date,
  },
},
{
  timestamps: true, // crée automatiquement createdAt, updatedAt
});

// Index composé pour les recherches fréquentes
FactureSchema.index({ user: 1, status: 1, dateEcheance: 1 });

// Middleware pour mettre à jour le statut
FactureSchema.pre('save', async function (next) {
  if (this.isModified('status') || this.isModified('dateEcheance')) {
    const maintenant = new Date();
    if (this.status === 'unpaid' && this.dateEcheance < maintenant) {
      this.status = 'overdue';
    }
  }
  next();
});

// Méthode pour marquer comme payée
FactureSchema.methods.marquerCommePaye = async function (methodePaiement, commentaire) {
  this.status = 'paid';
  this.datePaiement = new Date();
  this.methodePaiement = methodePaiement;
  this.commentairePaiement = commentaire;

  this.historiquePaiements.push({
    date: this.datePaiement,
    montant: this.montantHT, //this.montantTTC
    methode: methodePaiement,
    commentaire: commentaire
  });

  await this.save();
};

// Méthodes virtuelles pour des calculs
FactureSchema.virtual('joursRetard').get(function () {
  if (this.status === 'paid' || !this.dateEcheance) return 0;
  const maintenant = new Date();
  const joursRetard = Math.floor((maintenant - this.dateEcheance) / (1000 * 60 * 60 * 24));
  return Math.max(0, joursRetard);
});

// Méthode pour vérifier si une facture est en retard
FactureSchema.methods.isEnRetard = function () {
  return this.status !== 'paid' && new Date() > this.dateEcheance;
};

// Méthode pour obtenir le prochain rappel à envoyer
FactureSchema.methods.getProchainRappel = function () {
  if (this.status === 'paid') return null;

  const rappelsEnvoyes = new Set(this.rappels.map(r => r.type));
  const joursRetard = this.joursRetard;

  if (!rappelsEnvoyes.has('premier') && joursRetard >= 7) return 'premier';
  if (!rappelsEnvoyes.has('deuxieme') && joursRetard >= 15) return 'deuxieme';
  if (!rappelsEnvoyes.has('troisieme') && joursRetard >= 30) return 'troisieme';

  return null;
};

// Méthode pour ajouter un rappel
FactureSchema.methods.ajouterRappel = async function (type, status = 'sent') {
  this.rappels.push({
    type,
    date: new Date(),
    status
  });
  await this.save();
};

// Méthode utilitaire pour le formatage des montants
FactureSchema.methods.formatMontant = function () {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR'
  }).format(this.montantTTC);
};

module.exports = mongoose.model('Facture', FactureSchema);
