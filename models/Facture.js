const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const factureSchema = new Schema({
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
  prestations: [{
    type: Schema.Types.ObjectId,
    ref: 'Prestation'
  }],
  montantHT: {
    type: Number,
    required: true
  },
  taxeURSSAF: {
    type: Number,
    required: true
  },
  montantNet: {
    type: Number,
    required: true
  },
  montantTVA: {
    type: Number,
    default: 0
  },
  montantTTC: {
    type: Number,
    default: 0
  },
  nombreHeures: {
    type: Number,
    default: 0
  },
  invoiceNumber: {
    type: Number,
    required: true
  },
  year: {
    type: Number,
    required: true
  },
  month: {
    type: Number,
    required: true
  },
  dateFacture: {
    type: Date,
    default: Date.now
  },
  dateEcheance: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ['draft', 'unpaid', 'paid', 'overdue', 'cancelled'],
    default: 'draft'
  },
  statut: {
    type: String,
    enum: ['VALIDE', 'RECTIFIEE', 'ANNULEE'],
    default: 'VALIDE'
  },
  locked: {
    type: Boolean,
    default: false
  },
  // Nouveau champ pour suivre si la facture a été envoyée au client
  isSentToClient: {
    type: Boolean,
    default: false
  },
  dateSent: {
    type: Date
  },
  pdfPath: String,
  datePaiement: Date,
  methodePaiement: String,
  commentairePaiement: String,
  historiquePaiements: [{
    date: Date,
    montant: Number,
    methode: String,
    commentaire: String
  }],
  // Champs pour la gestion des rectifications
  isRectification: {
    type: Boolean,
    default: false
  },
  rectificationInfo: {
    originalFactureId: {
      type: Schema.Types.ObjectId,
      ref: 'Facture'
    },
    originalInvoiceNumber: Number,
    rectificationChain: [Schema.Types.ObjectId],
    motifLegal: String,
    detailsMotif: String,
    dateRectification: Date,
    prestationsModifiees: [Schema.Types.Mixed],
    differenceMontantHT: Number,
    differenceTaxeURSSAF: Number,
    differenceMontantNet: Number,
    differenceMontantTTC: Number
  },
  rectifications: [{
    factureId: {
      type: Schema.Types.ObjectId,
      ref: 'Facture'
    },
    date: Date,
    motifLegal: String,
    detailsMotif: String
  }],
  // Champs pour la gestion des avoirs
  avoir: {
    date: Date,
    numero: String,
    montant: Number,
    motif: String,
    remboursement: {
      type: Boolean,
      default: false
    },
    methodePaiement: String,
    dateRemboursement: Date
  },
  // Champs pour l'annulation
  annulation: {
    date: Date,
    motif: String,
    commentaire: String,
    userId: Schema.Types.ObjectId
  },
  // Versions précédentes (historique de modifications)
  versions: [Schema.Types.Mixed]
}, 
{ timestamps: true });

module.exports = mongoose.model('Facture', factureSchema);


/*
const mongoose = require('mongoose');

const PrestationModifieeSchema = new mongoose.Schema({
  prestationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Prestation',
    required: true
  },
  type: {
    type: String,
    enum: ['MODIFIEE', 'AJOUTEE', 'SUPPRIMEE'],
    required: true
  },
  anciensDetails: {
    description: String,
    billingType: String,
    hours: Number,
    hourlyRate: Number,
    fixedPrice: Number,
    duration: Number,
    durationUnit: String,
    total: Number,
    date: Date,
    quantity: Number
  },
  nouveauxDetails: {
    description: String,
    billingType: String,
    hours: Number,
    hourlyRate: Number,
    fixedPrice: Number,
    duration: Number,
    durationUnit: String,
    total: Number,
    date: Date,
    quantity: Number
  }
});

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

  // Champs pour la rectification
  isRectification: {
    type: Boolean,
    default: false
  },
  rectificationInfo: {
    originalFactureId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Facture'
    },
    originalInvoiceNumber: {  // Ajout du numéro de facture original
      type: Number,
      required: function() {
        return this.parent().isRectification === true;
      }
    },
    rectificationChain: {
      type: [mongoose.Schema.Types.ObjectId],
      default: []
    },

    motifLegal: {
      type: String,
      enum: [
        'ERREUR_MONTANT',
        'ERREUR_TVA',
        'ERREUR_CLIENT',
        'PRESTATION_MODIFIEE',
        'REMISE_EXCEPTIONNELLE',
        'AUTRE'
      ]
    },
    detailsMotif: String,
    dateRectification: {
      type: Date,
      default: Date.now
    },
    prestationsModifiees: [PrestationModifieeSchema],
    differenceMontantHT: Number,
    differenceTaxeURSSAF: Number,
    differenceMontantNet: Number,
    differenceMontantTTC: Number
  },

  rectifications: [{
    factureId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Facture'
    },
    date: {
      type: Date,
      default: Date.now
    },
    motifLegal: String,
    detailsMotif: String
  }],

  // Statut de validité
  statut: {
    type: String,
    enum: ['VALIDE', 'ANNULEE', 'RECTIFIEE'],
    default: 'VALIDE'
  },

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
    enum: ['draft','unpaid', 'paid', 'overdue', 'cancelled'],
    default: 'draft',
    index: true,
  },
  isSentToClient: {
    type: Boolean,
    default: false
  },
  annulation: {
    date: {
      type: Date
    },
    motif: {
      type: String
    },
    commentaire: {
      type: String
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
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
  locked: {
    type: Boolean,
    default: false,
  },

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
  // Définition améliorée de l'avoir avec validation
  avoir: {
    type: new mongoose.Schema({
      date: { type: Date, required: true },
      numero: { type: String, required: true },
      montant: { type: Number, required: true },
      motif: { type: String, required: true },
      remboursement: { type: Boolean, default: false },
      methodePaiement: { type: String },
      dateRemboursement: { type: Date }
    }),
    default: undefined
  },
},
{
  timestamps: true, // crée automatiquement createdAt, updatedAt
});

// Validation pour s'assurer qu'un avoir valide contient tous les champs nécessaires
FactureSchema.path('avoir').validate(function(avoir) {
  if (!avoir) return true; // L'avoir peut être null/undefined
  
  // Si l'avoir existe, il doit avoir au moins ces propriétés
  return avoir.numero && avoir.montant && avoir.date && avoir.motif;
}, 'Un avoir doit contenir numero, montant, date et motif');

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

// Ajouter une méthode pour créer une rectification
FactureSchema.methods.createRectification = async function(motifLegal, detailsMotif) {
  // Vérifier si la facture peut être rectifiée
  if (this.statut === 'ANNULEE') {
    throw new Error('Une facture annulée ne peut pas être rectifiée');
  }

  // Marquer cette facture comme rectifiée
  this.statut = 'RECTIFIEE';
  
  // Ajouter l'entrée dans le tableau des rectifications
  this.rectifications.push({
    motifLegal,
    detailsMotif,
    date: new Date()
  });

  await this.save();
  return this;
};

// Middleware pour la validation
FactureSchema.pre('save', function(next) {
  // Si c'est une rectification, certains champs sont obligatoires
  if (this.isRectification && !this.rectificationInfo.originalFactureId) {
    next(new Error('Une facture rectificative doit référencer la facture originale'));
    return;
  }

  // Si le statut change à RECTIFIEE, vérifier qu'il y a bien une rectification liée
  if (this.statut === 'RECTIFIEE' && this.rectifications.length === 0) {
    next(new Error('Une facture rectifiée doit avoir au moins une rectification'));
    return;
  }

  next();
});

// Méthode virtuelle pour obtenir le libellé du motif légal
FactureSchema.virtual('motifLegalLibelle').get(function() {
  const motifs = {
    'ERREUR_MONTANT': 'Erreur sur les montants',
    'ERREUR_TVA': 'Erreur de TVA',
    'ERREUR_CLIENT': 'Erreur sur les informations client',
    'PRESTATION_MODIFIEE': 'Modification des prestations',
    'REMISE_EXCEPTIONNELLE': 'Application d\'une remise exceptionnelle',
    'AUTRE': 'Autre motif'
  };
  
  if (this.isRectification && this.rectificationInfo.motifLegal) {
    return motifs[this.rectificationInfo.motifLegal] || this.rectificationInfo.motifLegal;
  }
  return null;
});

module.exports = mongoose.model('Facture', FactureSchema);
*/